import { Elysia } from "elysia";

export const CORRELATION_ID_HEADER = "X-Request-ID";

type LogLevel = "info" | "warn" | "error";

export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

export function formatCorrelationLog(
  correlationId: string,
  event: string,
  detail: string
): string {
  return `[REQ-${correlationId}] ${new Date().toISOString()} ${event} ${detail}`;
}

export function logWithCorrelation(
  correlationId: string,
  event: string,
  detail: string,
  level: LogLevel = "info"
): void {
  const line = formatCorrelationLog(correlationId, event, detail);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function extractRequestId(
  metadata?: Record<string, unknown>
): string | undefined {
  const candidate = metadata?.request_id;
  if (typeof candidate !== "string") {
    return undefined;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const correlationIdMiddleware = new Elysia({
  name: "correlation-id-middleware"
}).derive(({ set }) => {
  const correlationId = generateCorrelationId();
  set.headers[CORRELATION_ID_HEADER] = correlationId;
  return { correlationId };
});
