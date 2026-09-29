/**
 * Dashboard session authentication: password verification and HS256 session
 * tokens for business owners.
 *
 * This is separate from AgentAuth (which guards only the agent WebSocket
 * handshake and has its own none/static/jwt mode) and from AdminAuth (platform
 * staff, a different issuer and a different secret). Sessions issued here are
 * what the dashboard sends on every `/api/` request.
 */

import { HmacSigner, timingSafeEqual, ttlSecondsFromEnv } from "./Jwt";

/** Minimum that still lets owners choose something memorable. */
export const MIN_PASSWORD_LENGTH = 8;

const DEFAULT_TTL_HOURS = 12;
export const BUSINESS_TOKEN_ISSUER = "omnichannel-gateway";

export { timingSafeEqual };

export interface SessionIdentity {
  business_id: string;
  email: string;
}

/** Argon2id via Bun's built-in password hashing — no external dependency. */
export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: "argon2id" });
}

/**
 * Verifies a password against a stored hash. A row with no password set must
 * not be loggable-into, and a malformed hash must fail closed rather than throw.
 */
export async function verifyPassword(
  password: string,
  hash: string | null | undefined
): Promise<boolean> {
  if (!hash) return false;
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

export class SessionAuthService {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  private readonly signer: HmacSigner;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.secret = env.AUTH_JWT_SECRET?.trim() ?? "";
    this.ttlSeconds = ttlSecondsFromEnv(env.AUTH_SESSION_TTL_HOURS, DEFAULT_TTL_HOURS);
    this.signer = new HmacSigner(this.secret);
  }

  get configured(): boolean {
    return this.secret.length > 0;
  }

  async hashPassword(password: string): Promise<string> {
    return await hashPassword(password);
  }

  async verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
    return await verifyPassword(password, hash);
  }

  async issue(identity: SessionIdentity): Promise<{ token: string; expires_at: string }> {
    if (!this.configured) throw new Error("AUTH_JWT_SECRET is not configured");

    return await this.signer.sign(
      { sub: identity.business_id, email: identity.email },
      { issuer: BUSINESS_TOKEN_ISSUER, ttlSeconds: this.ttlSeconds }
    );
  }

  /** Returns the identity for a valid token, or null. Never throws on bad input. */
  async verify(token: string): Promise<SessionIdentity | null> {
    if (!this.configured) return null;

    const claims = await this.signer.verify(token, BUSINESS_TOKEN_ISSUER);
    if (!claims) return null;

    const businessId = typeof claims.sub === "string" ? claims.sub.trim() : "";
    const email = typeof claims.email === "string" ? claims.email.trim() : "";
    if (!businessId) return null;

    return { business_id: businessId, email };
  }
}

export const sessionAuthService = new SessionAuthService();
