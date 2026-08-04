/**
 * Per-business opening hours, owned by the gateway.
 *
 * Opening hours used to come only from the global BUSINESS_OPEN_HOUR /
 * BUSINESS_CLOSE_HOUR env vars, which meant every tenant shared one schedule.
 * The gateway now stores a per-business `business_hours` record (edited in
 * Settings → Business profile), and this module reads it.
 *
 * A business that has never saved hours resolves to `null`, and every caller
 * then falls back to the env vars — so behaviour is unchanged until an owner
 * actually configures something.
 */

import type { BusinessHours } from "./business-hours";
import { BUSINESS_DAYS } from "./business-hours";

const GATEWAY_URL = (process.env.GATEWAY_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CACHE_TTL_MS = Number(process.env.BUSINESS_HOURS_CACHE_MS ?? 60_000);
const TIMEOUT_MS = 4000;

interface CacheEntry {
  hours: BusinessHours | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Exposed for tests; also useful after an owner saves new hours. */
export function clearBusinessHoursCache(businessId?: string): void {
  if (businessId) cache.delete(businessId);
  else cache.clear();
}

/** Seed the cache directly. Tests use this instead of standing up a gateway. */
export function primeBusinessHoursCache(businessId: string, hours: BusinessHours | null): void {
  cache.set(businessId, { hours, expiresAt: Date.now() + CACHE_TTL_MS });
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Reject anything that is not the documented shape rather than half-trusting it. */
function normalize(value: unknown): BusinessHours | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const result = {} as BusinessHours;
  let anyEnabled = false;

  for (const day of BUSINESS_DAYS) {
    const raw = source[day];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      result[day] = { enabled: false };
      continue;
    }

    const entry = raw as Record<string, unknown>;
    const open = typeof entry.open === "string" ? entry.open.trim() : "";
    const close = typeof entry.close === "string" ? entry.close.trim() : "";

    if (entry.enabled === true && TIME_RE.test(open) && TIME_RE.test(close)) {
      result[day] = { enabled: true, open, close };
      anyEnabled = true;
    } else {
      result[day] = { enabled: false };
    }
  }

  // An all-closed record is indistinguishable from "never configured" and would
  // silently block every booking, so treat it as unset.
  return anyEnabled ? result : null;
}

/**
 * Fetch this business's hours, cached briefly. Any failure resolves to null so
 * the Appointment service keeps working when the gateway is down — bookings
 * then fall back to the global env window rather than failing closed.
 */
export async function getBusinessHours(businessId: string): Promise<BusinessHours | null> {
  const cached = cache.get(businessId);
  if (cached && cached.expiresAt > Date.now()) return cached.hours;

  // Tests never reach out to a gateway; they seed the cache with
  // primeBusinessHoursCache instead. Same convention as lead-manager notify.ts.
  if (process.env.NODE_ENV === "test") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let hours: BusinessHours | null = null;

  try {
    const res = await fetch(`${GATEWAY_URL}/api/businesses/${encodeURIComponent(businessId)}`, {
      signal: controller.signal
    });
    if (res.ok) {
      const body = (await res.json()) as { business?: { business_hours?: unknown } };
      hours = normalize(body?.business?.business_hours);
    }
  } catch (err) {
    console.warn(
      `[business-hours] could not load hours for ${businessId}:`,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }

  cache.set(businessId, { hours, expiresAt: Date.now() + CACHE_TTL_MS });
  return hours;
}
