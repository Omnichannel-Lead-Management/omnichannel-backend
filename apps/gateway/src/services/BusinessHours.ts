
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

/** Validate and normalize an incoming hours object. */
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
    if (toMinutes(close) <= toMinutes(open)) {
      throw new BusinessHoursError(`${day} close time must be after its open time`);
    }

    result[day] = { enabled: true, open, close };
  }

  return result;
}

/** Read hours off a stored JSON string. */
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
