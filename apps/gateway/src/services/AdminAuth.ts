/**
 * Platform-admin session authentication.
 *
 * Admins are the people who run the platform, not the people who run a
 * business on it. They are a separate table, a separate login endpoint, a
 * separate signing secret and a separate token issuer, so the two session
 * systems cannot be crossed:
 *
 *  - a business-owner token is rejected on every `/api/admin/` route, and
 *  - an admin token is rejected on every other `/api/` route.
 *
 * The second half is the important one: it is what keeps an admin out of
 * tenants' inboxes. Admins are billing staff, so they see counts, never
 * message content.
 */

import { HmacSigner, ttlSecondsFromEnv } from "./Jwt";
import { hashPassword, verifyPassword } from "./SessionAuth";

const DEFAULT_TTL_HOURS = 8;
export const ADMIN_TOKEN_ISSUER = "omnichannel-admin";

export type AdminRole = "owner" | "staff";

export interface AdminIdentity {
  admin_id: string;
  email: string;
  role: AdminRole;
}

export function isAdminRole(value: unknown): value is AdminRole {
  return value === "owner" || value === "staff";
}

export class AdminAuthService {
  private readonly secret: string;
  private readonly ttlSeconds: number;
  private readonly signer: HmacSigner;

  constructor(env: Record<string, string | undefined> = process.env) {
    // Deliberately its own secret. Sharing AUTH_JWT_SECRET would mean a leak of
    // the tenant secret also mints admin sessions.
    this.secret = env.ADMIN_JWT_SECRET?.trim() ?? "";
    this.ttlSeconds = ttlSecondsFromEnv(env.ADMIN_SESSION_TTL_HOURS, DEFAULT_TTL_HOURS);
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

  async issue(identity: AdminIdentity): Promise<{ token: string; expires_at: string }> {
    if (!this.configured) throw new Error("ADMIN_JWT_SECRET is not configured");

    return await this.signer.sign(
      { sub: identity.admin_id, email: identity.email, role: identity.role },
      { issuer: ADMIN_TOKEN_ISSUER, ttlSeconds: this.ttlSeconds }
    );
  }

  /** Returns the admin identity for a valid token, or null. Never throws. */
  async verify(token: string): Promise<AdminIdentity | null> {
    if (!this.configured) return null;

    const claims = await this.signer.verify(token, ADMIN_TOKEN_ISSUER);
    if (!claims) return null;

    const adminId = typeof claims.sub === "string" ? claims.sub.trim() : "";
    const email = typeof claims.email === "string" ? claims.email.trim() : "";
    if (!adminId) return null;

    // An unknown role is not "assume the weakest" — it means the token was not
    // minted by a version of this service we understand, so reject it.
    if (!isAdminRole(claims.role)) return null;

    return { admin_id: adminId, email, role: claims.role };
  }
}

export const adminAuthService = new AdminAuthService();
