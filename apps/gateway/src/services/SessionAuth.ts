/**
 * Dashboard session authentication: password verification and HS256 session
 * tokens for business owners.
 *
 * This is separate from AgentAuth (which guards only the agent WebSocket
 * handshake and has its own none/static/jwt mode). Sessions issued here are
 * what the dashboard sends on every `/api/` request.
 */

/** Minimum that still lets owners choose something memorable. */
export const MIN_PASSWORD_LENGTH = 8;

const DEFAULT_TTL_HOURS = 12;
const ISSUER = "omnichannel-gateway";

export interface SessionClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  iss: string;
}

export interface SessionIdentity {
  business_id: string;
  email: string;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(segment: string): Uint8Array {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(Buffer.from(padded, "base64"));
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Constant-time comparison. Token and secret comparisons must not leak length
 * or prefix information through early returns.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

export class SessionAuthService {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.secret = env.AUTH_JWT_SECRET?.trim() ?? "";

    const rawTtl = Number(env.AUTH_SESSION_TTL_HOURS ?? DEFAULT_TTL_HOURS);
    this.ttlSeconds =
      Number.isFinite(rawTtl) && rawTtl > 0
        ? Math.floor(rawTtl * 3600)
        : DEFAULT_TTL_HOURS * 3600;
  }

  get configured(): boolean {
    return this.secret.length > 0;
  }

  private async getKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      );
    }
    return await this.keyPromise;
  }

  /** Argon2id via Bun's built-in password hashing — no external dependency. */
  async hashPassword(password: string): Promise<string> {
    return await Bun.password.hash(password, { algorithm: "argon2id" });
  }

  /**
   * Verifies a password against a stored hash. A row with no password set must
   * not be loggable-into, and a malformed hash must fail closed rather than throw.
   */
  async verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) return false;
    try {
      return await Bun.password.verify(password, hash);
    } catch {
      return false;
    }
  }

  async issue(identity: SessionIdentity): Promise<{ token: string; expires_at: string }> {
    if (!this.configured) throw new Error("AUTH_JWT_SECRET is not configured");

    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + this.ttlSeconds;

    const header = encodeJson({ alg: "HS256", typ: "JWT" });
    const payload = encodeJson({
      sub: identity.business_id,
      email: identity.email,
      iat: issuedAt,
      exp: expiresAt,
      iss: ISSUER
    } satisfies SessionClaims);

    const signingInput = `${header}.${payload}`;
    const signature = await crypto.subtle.sign(
      "HMAC",
      await this.getKey(),
      new TextEncoder().encode(signingInput)
    );

    return {
      token: `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`,
      expires_at: new Date(expiresAt * 1000).toISOString()
    };
  }

  /** Returns the identity for a valid token, or null. Never throws on bad input. */
  async verify(token: string): Promise<SessionIdentity | null> {
    if (!this.configured) return null;

    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart)));
      claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadPart)));
    } catch {
      return null;
    }

    // Pinning the algorithm rejects "alg": "none" and RS/HS confusion attempts.
    if (header.alg !== "HS256") return null;

    let valid = false;
    try {
      valid = await crypto.subtle.verify(
        "HMAC",
        await this.getKey(),
        base64UrlDecode(signaturePart),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`)
      );
    } catch {
      return null;
    }
    if (!valid) return null;

    if (claims.iss !== ISSUER) return null;

    const exp = typeof claims.exp === "number" ? claims.exp : 0;
    if (Math.floor(Date.now() / 1000) >= exp) return null;

    const businessId = typeof claims.sub === "string" ? claims.sub.trim() : "";
    const email = typeof claims.email === "string" ? claims.email.trim() : "";
    if (!businessId) return null;

    return { business_id: businessId, email };
  }
}

export const sessionAuthService = new SessionAuthService();
