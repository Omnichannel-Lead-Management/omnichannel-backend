/**
 * Per-business opening hours.
 *
 * Stored on the business row as a JSON string and served as a plain object, so
 * the dashboard and the Appointment service both read the same shape:
 *
 *   { "monday": { "enabled": true, "open": "09:00", "close": "17:00" }, ... }
 *
 * The Appointment service used to gate availability on the global
 * BUSINESS_OPEN_HOUR / BUSINESS_CLOSE_HOUR env vars, which meant every tenant
 * shared one schedule. It now reads this per-business record and only falls back
 * to those env vars when a business has never saved any hours.
 */

export const BUSINESS_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday"
] as const;

export type BusinessDay = (typeof BUSINESS_DAYS)[number];

export interface DayHours {
  enabled: boolean;
  open?: string;
  close?: string;
}

export type BusinessHours = Record<BusinessDay, DayHours>;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function toMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export class BusinessHoursError extends Error {}

/**
 * Validate and normalize an incoming hours object. Throws BusinessHoursError
 * with a field-level message the dashboard can show verbatim.
 */
export function parseBusinessHoursInput(value: unknown): BusinessHours {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BusinessHoursError("business_hours must be an object keyed by day name");
  }

  const source = value as Record<string, unknown>;
  const result = {} as BusinessHours;

  for (const day of BUSINESS_DAYS) {
    const raw = source[day];

    if (raw === undefined || raw === null) {
      result[day] = { enabled: false };
      continue;
    }
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new BusinessHoursError(`${day} must be an object`);
    }

    const entry = raw as Record<string, unknown>;
    if (entry.enabled !== true) {
      result[day] = { enabled: false };
      continue;
    }

    const open = typeof entry.open === "string" ? entry.open.trim() : "";
    const close = typeof entry.close === "string" ? entry.close.trim() : "";

    if (!TIME_RE.test(open) || !TIME_RE.test(close)) {
      throw new BusinessHoursError(`${day} needs an open and close time in HH:MM`);
    }
    // Overnight hours are out of scope: the availability walker assumes a slot
    // starts and ends on the same local calendar day.
    if (toMinutes(close) <= toMinutes(open)) {
      throw new BusinessHoursError(`${day} close time must be after its open time`);
    }

    result[day] = { enabled: true, open, close };
  }

  return result;
}

/** Read hours off a stored JSON string. Malformed data reads as "not set". */
export function parseStoredBusinessHours(stored: string | null | undefined): BusinessHours | null {
  if (!stored) return null;
  try {
    return parseBusinessHoursInput(JSON.parse(stored));
  } catch {
    return null;
  }
}

export function serializeBusinessHours(hours: BusinessHours): string {
  return JSON.stringify(hours);
}
