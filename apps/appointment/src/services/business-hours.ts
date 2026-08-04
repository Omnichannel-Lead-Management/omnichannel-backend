/**
 * Business-local time handling.
 *
 * Appointments are stored as UTC ISO strings, but customers say "3pm" meaning
 * *their* 3pm. BUSINESS_UTC_OFFSET_MINUTES converts between the two.
 *
 * The defaults (offset 0, 09:00–17:00) preserve the stored-UTC behaviour the
 * availability logic originally assumed. Deployments in a real timezone set
 * them — Sri Lanka is 330 (UTC+05:30).
 *
 * Every value is read from the environment on each call rather than captured at
 * module load, so behaviour never depends on when this module was first
 * imported.
 */

const MINUTE_MS = 60 * 1000;

function readNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function businessUtcOffsetMinutes(): number {
  return readNumber("BUSINESS_UTC_OFFSET_MINUTES", 0);
}

export function defaultAppointmentMinutes(): number {
  return readNumber("APPOINTMENT_DEFAULT_MINUTES", 30);
}

/** Opening hours in business-local time, inclusive of open, exclusive of close. */
export function openHourLocal(): number {
  return readNumber("BUSINESS_OPEN_HOUR", 9);
}

export function closeHourLocal(): number {
  return readNumber("BUSINESS_CLOSE_HOUR", 17);
}

/** "2026-07-31" + "15:00" in business-local time -> UTC Date. */
export function localDateTimeToUtc(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!timeMatch) return null;

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (hour > 23 || minute > 59) return null;

  const asUtc = Date.parse(
    `${date}T${String(hour).padStart(2, "0")}:${timeMatch[2]}:00.000Z`
  );
  if (Number.isNaN(asUtc)) return null;

  // Reject shape-valid but impossible dates such as 2026-02-31.
  if (new Date(asUtc).toISOString().slice(0, 10) !== date) return null;

  return new Date(asUtc - businessUtcOffsetMinutes() * MINUTE_MS);
}

/** UTC instant -> business-local calendar date, "YYYY-MM-DD". */
export function utcToLocalDate(instant: Date): string {
  return new Date(instant.getTime() + businessUtcOffsetMinutes() * MINUTE_MS)
    .toISOString()
    .slice(0, 10);
}

/** UTC instant -> business-local "3:00 PM" for display back to the customer. */
export function formatLocalTime(instant: Date): string {
  const shifted = new Date(instant.getTime() + businessUtcOffsetMinutes() * MINUTE_MS);
  const hour24 = shifted.getUTCHours();
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${minute} ${suffix}`;
}

// ---- per-business opening hours -----------------------------------------
/**
 * Per-business hours are stored on the gateway and fetched by
 * business-hours-provider.ts. Everything below takes an optional resolved
 * window; passing nothing keeps the original global-env behaviour, so a tenant
 * that has never configured hours is unaffected.
 */

export const BUSINESS_DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

export type BusinessDay = (typeof BUSINESS_DAYS)[number];

export interface DayHours {
  enabled: boolean;
  open?: string;
  close?: string;
}

export type BusinessHours = Record<BusinessDay, DayHours>;

/** Opening window for one calendar day, in business-local minutes from midnight. */
export interface DayWindow {
  openMinutes: number;
  closeMinutes: number;
}

function parseTimeToMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function envWindow(): DayWindow {
  return { openMinutes: openHourLocal() * 60, closeMinutes: closeHourLocal() * 60 };
}

/** Business-local "YYYY-MM-DD" -> the day name used by the hours record. */
export function localDateToDay(date: string): BusinessDay | null {
  const parsed = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  return BUSINESS_DAYS[new Date(parsed).getUTCDay()];
}

/**
 * Resolve the opening window for a business-local date.
 * - no configured hours -> the global env window (unchanged behaviour)
 * - configured but closed that day -> null (nothing bookable)
 */
export function resolveDayWindow(
  hours: BusinessHours | null | undefined,
  localDate: string
): DayWindow | null {
  if (!hours) return envWindow();

  const day = localDateToDay(localDate);
  if (!day) return null;

  const entry = hours[day];
  if (!entry?.enabled || !entry.open || !entry.close) return null;

  const openMinutes = parseTimeToMinutes(entry.open);
  const closeMinutes = parseTimeToMinutes(entry.close);
  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) return null;

  return { openMinutes, closeMinutes };
}

/**
 * True when the whole appointment falls inside business-local opening hours.
 * `window` defaults to the global env window when omitted.
 */
export function isWithinOpeningHours(
  startUtc: Date,
  endUtc: Date,
  window: DayWindow | null = envWindow()
): boolean {
  if (!window) return false;

  const offset = businessUtcOffsetMinutes() * MINUTE_MS;
  const startLocal = new Date(startUtc.getTime() + offset);
  const endLocal = new Date(endUtc.getTime() + offset);

  // An appointment may not straddle midnight or run past closing.
  if (startLocal.toISOString().slice(0, 10) !== endLocal.toISOString().slice(0, 10)) {
    return false;
  }

  const startMinutes = startLocal.getUTCHours() * 60 + startLocal.getUTCMinutes();
  const endMinutes = endLocal.getUTCHours() * 60 + endLocal.getUTCMinutes();

  return startMinutes >= window.openMinutes && endMinutes <= window.closeMinutes;
}

export function openingHoursLabel(window: DayWindow | null = envWindow()): string {
  if (!window) return "closed today";

  const label = (minutes: number) => {
    const hour24 = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return minute === 0
      ? `${hour12} ${suffix}`
      : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
  };

  return `${label(window.openMinutes)} – ${label(window.closeMinutes)}`;
}
