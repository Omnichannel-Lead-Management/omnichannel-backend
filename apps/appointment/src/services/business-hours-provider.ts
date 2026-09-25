
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

/** Seed the cache directly. */
export function primeBusinessHoursCache(businessId: string, hours: BusinessHours | null): void {
  cache.set(businessId, { hours, expiresAt: Date.now() + CACHE_TTL_MS });
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The gateway requires a credential on `/api/` routes. Sibling services have no
 * user session, so they present the shared internal token instead.
 */
function internalAuthHeaders(): Record<string, string> {
  const token = process.env.INTERNAL_SERVICE_TOKEN?.trim();
  return token ? { "X-Internal-Token": token } : {};
}


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

  return anyEnabled ? result : null;
}

/** Fetch this business's hours, cached briefly. */
export async function getBusinessHours(businessId: string): Promise<BusinessHours | null> {
  const cached = cache.get(businessId);
  if (cached && cached.expiresAt > Date.now()) return cached.hours;

  if (process.env.NODE_ENV === "test") return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let hours: BusinessHours | null = null;

  try {
    const res = await fetch(`${GATEWAY_URL}/api/businesses/${encodeURIComponent(businessId)}`, {
      headers: internalAuthHeaders(),
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
