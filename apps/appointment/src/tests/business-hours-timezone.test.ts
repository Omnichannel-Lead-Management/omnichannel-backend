import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeDatabase } from "../db/initialize";
import { getAvailableAppointmentSlots } from "../services/appointment-service";
import {
  formatLocalTime,
  isWithinOpeningHours,
  localDateTimeToUtc,
  utcToLocalDate
} from "../services/business-hours";

const ORIGINAL = {
  offset: process.env.BUSINESS_UTC_OFFSET_MINUTES,
  open: process.env.BUSINESS_OPEN_HOUR,
  close: process.env.BUSINESS_CLOSE_HOUR
};

beforeEach(() => {
  process.env.BUSINESS_UTC_OFFSET_MINUTES = "330";
  process.env.BUSINESS_OPEN_HOUR = "9";
  process.env.BUSINESS_CLOSE_HOUR = "18";
});

afterEach(() => {
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  restore("BUSINESS_UTC_OFFSET_MINUTES", ORIGINAL.offset);
  restore("BUSINESS_OPEN_HOUR", ORIGINAL.open);
  restore("BUSINESS_CLOSE_HOUR", ORIGINAL.close);
});

describe("business hours at UTC+05:30", () => {
  test("3 PM Colombo is stored as 09:30 UTC", () => {
    expect(localDateTimeToUtc("2026-07-31", "15:00")?.toISOString()).toBe(
      "2026-07-31T09:30:00.000Z"
    );
  });

  test("a UTC instant maps back to the local calendar date", () => {
    expect(utcToLocalDate(new Date("2026-07-29T19:17:00.000Z"))).toBe("2026-07-30");
  });

  test("formats a stored UTC time back in local 12-hour form", () => {
    expect(formatLocalTime(new Date("2026-07-31T09:30:00.000Z"))).toBe("3:00 PM");
  });

  test("rejects a shape-valid but impossible date", () => {
    expect(localDateTimeToUtc("2026-02-31", "10:00")).toBeNull();
  });

  test("accepts the last booking before local closing time", () => {
    expect(
      isWithinOpeningHours(
        new Date("2026-07-31T12:00:00.000Z"),
        new Date("2026-07-31T12:30:00.000Z")
      )
    ).toBe(true);
  });

  test("rejects a booking that would end after local closing time", () => {
    expect(
      isWithinOpeningHours(
        new Date("2026-07-31T12:30:00.000Z"),
        new Date("2026-07-31T13:00:00.000Z")
      )
    ).toBe(false);
  });

  test("rejects a booking before local opening time", () => {
    expect(
      isWithinOpeningHours(
        new Date("2026-07-31T02:30:00.000Z"),
        new Date("2026-07-31T03:00:00.000Z")
      )
    ).toBe(false);
  });

  test("suggested slots stay inside local opening hours", () => {
    const db = new Database(":memory:");
    initializeDatabase(db);

    const slots = getAvailableAppointmentSlots(db, "biz_tz", "2026-07-31");
    db.close();

    expect(slots.length).toBeGreaterThan(0);
    expect(formatLocalTime(new Date(slots[0]!.startTime))).toBe("9:00 AM");
    expect(formatLocalTime(new Date(slots[slots.length - 1]!.endTime))).toBe("6:00 PM");
  });
});
