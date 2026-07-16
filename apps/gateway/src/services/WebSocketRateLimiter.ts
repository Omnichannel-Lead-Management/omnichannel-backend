interface SocketLike {
  remoteAddress?: string;
  raw?: {
    remoteAddress?: string;
  };
  data?: unknown;
}

interface RateLimitWindow {
  startedAt: number;
  count: number;
  lastSeenAt: number;
}

export interface WebSocketRateLimiterOptions {
  keyPrefix: string;
  maxMessages: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export class WebSocketRateLimiter {
  private windows = new Map<string, RateLimitWindow>();
  private operations = 0;

  constructor(private readonly options: WebSocketRateLimiterOptions) {}

  consume(socket: SocketLike): RateLimitDecision {
    const now = Date.now();
    const key = this.resolveKey(socket);
    const current = this.windows.get(key);

    if (!current || now - current.startedAt >= this.options.windowMs) {
      this.windows.set(key, {
        startedAt: now,
        count: 1,
        lastSeenAt: now
      });
      this.sweep(now);
      return { allowed: true, retryAfterMs: 0 };
    }

    current.lastSeenAt = now;
    if (current.count >= this.options.maxMessages) {
      this.sweep(now);
      return {
        allowed: false,
        retryAfterMs: Math.max(0, this.options.windowMs - (now - current.startedAt))
      };
    }

    current.count += 1;
    this.sweep(now);
    return { allowed: true, retryAfterMs: 0 };
  }

  private resolveKey(socket: SocketLike): string {
    const forwardedIp = this.extractForwardedIp(socket.data);
    const remoteAddress =
      forwardedIp ||
      socket.raw?.remoteAddress ||
      socket.remoteAddress ||
      "unknown";

    return `${this.options.keyPrefix}:${remoteAddress}`;
  }

  private extractForwardedIp(data: unknown): string | null {
    if (!data || typeof data !== "object") return null;

    const record = data as Record<string, unknown>;
    const headersRaw = record.headers;
    if (!headersRaw || typeof headersRaw !== "object") return null;

    const headers = headersRaw as Record<string, unknown>;

    const xForwardedFor =
      (typeof headers["x-forwarded-for"] === "string" && headers["x-forwarded-for"]) ||
      (typeof headers["X-Forwarded-For"] === "string" && headers["X-Forwarded-For"]) ||
      "";

    const firstIp = xForwardedFor
      .split(",")
      .map((part) => part.trim())
      .find(Boolean);

    return firstIp || null;
  }

  private sweep(now: number): void {
    this.operations += 1;
    if (this.operations % 512 !== 0) return;

    const retentionMs = this.options.windowMs * 2;

    for (const [key, window] of this.windows) {
      if (now - window.lastSeenAt > retentionMs) {
        this.windows.delete(key);
      }
    }
  }
}
