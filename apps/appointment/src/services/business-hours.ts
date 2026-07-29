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

/** True when the whole appointment falls inside business-local opening hours. */
export function isWithinOpeningHours(startUtc: Date, endUtc: Date): boolean {
  const offset = businessUtcOffsetMinutes() * MINUTE_MS;
  const startLocal = new Date(startUtc.getTime() + offset);
  const endLocal = new Date(endUtc.getTime() + offset);

  // An appointment may not straddle midnight or run past closing.
  if (startLocal.toISOString().slice(0, 10) !== endLocal.toISOString().slice(0, 10)) {
    return false;
  }

  const startMinutes = startLocal.getUTCHours() * 60 + startLocal.getUTCMinutes();
  const endMinutes = endLocal.getUTCHours() * 60 + endLocal.getUTCMinutes();

  return startMinutes >= openHourLocal() * 60 && endMinutes <= closeHourLocal() * 60;
}

export function openingHoursLabel(): string {
  const label = (hour: number) => {
    const suffix = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12} ${suffix}`;
  };
  return `${label(openHourLocal())} – ${label(closeHourLocal())}`;
}
