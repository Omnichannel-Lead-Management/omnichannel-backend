import { Elysia, t } from "elysia";
import {
  getBusinessById,
  getBusinessByOwnerEmail,
  setBusinessPassword
} from "../services/BusinessRegistry";
import { MIN_PASSWORD_LENGTH, sessionAuthService } from "../services/SessionAuth";
import { toPublicBusiness } from "./businesses.routes";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface AttemptRecord {
  failures: number;
  blockedUntil: number;
}

/**
 * In-memory brute-force throttle, keyed by email. Single gateway process, so a
 * map is enough; it resets on restart, which is acceptable for a lockout this
 * short. Anything stronger belongs in Redis alongside a real rate limiter.
 */
const attempts = new Map<string, AttemptRecord>();

function attemptKey(email: string): string {
  return email.trim().toLowerCase();
}

function isLockedOut(email: string): number {
  const record = attempts.get(attemptKey(email));
  if (!record) return 0;

  const remaining = record.blockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function recordFailure(email: string): void {
  const key = attemptKey(email);
  const record = attempts.get(key) ?? { failures: 0, blockedUntil: 0 };
  record.failures += 1;

  if (record.failures >= MAX_FAILED_ATTEMPTS) {
    record.blockedUntil = Date.now() + LOCKOUT_MS;
    record.failures = 0;
  }

  attempts.set(key, record);
}

function clearFailures(email: string): void {
  attempts.delete(attemptKey(email));
}

function bearerToken(headers: Record<string, string | undefined>): string {
  const raw = headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1]!.trim() : "";
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .post(
    "/login",
    async ({ body, set }) => {
      const email = body.owner_email.trim();
      const password = body.password;

      if (!sessionAuthService.configured) {
        set.status = 503;
        return { success: false, error: "Authentication is not configured on this server" };
      }

      const lockedFor = isLockedOut(email);
      if (lockedFor > 0) {
        set.status = 429;
        return {
          success: false,
          error: "Too many failed attempts. Try again later.",
          retry_after_seconds: lockedFor
        };
      }

      const business = await getBusinessByOwnerEmail(email);
      const passwordValid = await sessionAuthService.verifyPassword(
        password,
        business?.password_hash
      );

      // One message for "no such owner", "no password set" and "wrong password"
      // so the endpoint cannot be used to enumerate registered owners.
      if (!business || !passwordValid) {
        recordFailure(email);
        set.status = 401;
        return { success: false, error: "Invalid email or password" };
      }

      clearFailures(email);
      const { token, expires_at } = await sessionAuthService.issue({
        business_id: business.id,
        email: business.owner_email ?? email
      });

      return {
        success: true,
        token,
        expires_at,
        business: toPublicBusiness(business)
      };
    },
    {
      body: t.Object({
        owner_email: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 })
      }),
      detail: { summary: "Sign in as a business owner", tags: ["Auth"] }
    }
  )

  .get(
    "/me",
    async ({ headers, set }) => {
      const identity = await sessionAuthService.verify(bearerToken(headers));
      if (!identity) {
        set.status = 401;
        return { success: false, error: "Session is invalid or has expired" };
      }

      const business = await getBusinessById(identity.business_id);
      if (!business) {
        set.status = 404;
        return { success: false, error: "Business not found" };
      }

      return { success: true, business: toPublicBusiness(business) };
    },
    { detail: { summary: "Current session's business", tags: ["Auth"] } }
  )

  .post(
    "/change-password",
    async ({ headers, body, set }) => {
      const identity = await sessionAuthService.verify(bearerToken(headers));
      if (!identity) {
        set.status = 401;
        return { success: false, error: "Session is invalid or has expired" };
      }

      if (body.new_password.length < MIN_PASSWORD_LENGTH) {
        set.status = 400;
        return {
          success: false,
          error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters`
        };
      }

      const business = await getBusinessById(identity.business_id);
      if (!business) {
        set.status = 404;
        return { success: false, error: "Business not found" };
      }

      const currentValid = await sessionAuthService.verifyPassword(
        body.current_password,
        business.password_hash
      );
      if (!currentValid) {
        set.status = 401;
        return { success: false, error: "Current password is incorrect" };
      }

      await setBusinessPassword(business.id, await sessionAuthService.hashPassword(body.new_password));
      return { success: true };
    },
    {
      body: t.Object({
        current_password: t.String({ minLength: 1 }),
        new_password: t.String({ minLength: 1 })
      }),
      detail: { summary: "Change the signed-in owner's password", tags: ["Auth"] }
    }
  );
