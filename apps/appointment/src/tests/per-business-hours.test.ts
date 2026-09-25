import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { createApp } from "../app";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";
import type { BusinessHours } from "../services/business-hours";
import {
  clearBusinessHoursCache,
  primeBusinessHoursCache,
} from "../services/business-hours-provider";

const tuesday = "2026-08-11";
const wednesday = "2026-08-12";
const businessId = "salon-001";

function hours(overrides: Partial<Record<string, unknown>> = {}): BusinessHours {
  const closed = { enabled: false };
  return {
    sunday: closed,
    monday: closed,
    tuesday: { enabled: true, open: "10:00", close: "14:00" },
    wednesday: closed,
    thursday: closed,
    friday: closed,
    saturday: closed,
    ...overrides,
  } as BusinessHours;
}

function getAvailability(app: Elysia, id: string, date: string): Promise<Response> {
  return app.handle(
    new Request(
      `http://localhost/api/appointments/availability?businessId=${encodeURIComponent(
        id
      )}&date=${date}`
    )
  );
}

function book(app: Elysia, startTime: string, endTime: string): Promise<Response> {
  return app.handle(
    new Request("http://localhost/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId,
        customerName: "Nimal Perera",
        service: "Haircut",
        startTime,
        endTime,
      }),
    })
  );
}

describe("per-business opening hours", () => {
  let db: Database;
  let app: Elysia;

  beforeEach(() => {
    db = createDatabase(":memory:");
    initializeDatabase(db);
    app = createApp(db);
    clearBusinessHoursCache();
  });

  afterEach(() => {
    db.close();
    clearBusinessHoursCache();
  });

  test("a business with no saved hours keeps the global 09:00–17:00 window", async () => {
    const body = await (await getAvailability(app, businessId, tuesday)).json();

    expect(body.data.closed).toBe(false);
    expect(body.data.slots).toHaveLength(16);
    expect(body.data.slots[0].startTime).toBe(`${tuesday}T09:00:00.000Z`);
  });

  test("saved hours narrow the offered slots to that day's window", async () => {
    primeBusinessHoursCache(businessId, hours());

    const body = await (await getAvailability(app, businessId, tuesday)).json();

    expect(body.data.slots).toHaveLength(8);
    expect(body.data.slots[0].startTime).toBe(`${tuesday}T10:00:00.000Z`);
    expect(body.data.slots.at(-1).endTime).toBe(`${tuesday}T14:00:00.000Z`);
    expect(body.data.openingHours).toBe("10 AM – 2 PM");
  });

  test("a day marked closed offers nothing", async () => {
    primeBusinessHoursCache(businessId, hours());

    const body = await (await getAvailability(app, businessId, wednesday)).json();

    expect(body.data.closed).toBe(true);
    expect(body.data.slots).toEqual([]);
  });

  test("one tenant's hours do not leak into another's", async () => {
    primeBusinessHoursCache(businessId, hours());
    primeBusinessHoursCache("other-tenant", null);

    const scoped = await (await getAvailability(app, businessId, tuesday)).json();
    const other = await (await getAvailability(app, "other-tenant", tuesday)).json();

    expect(scoped.data.slots).toHaveLength(8);
    expect(other.data.slots).toHaveLength(16);
  });

  test("booking outside the saved window is rejected with 422", async () => {
    primeBusinessHoursCache(businessId, hours());

    const response = await book(app, `${tuesday}T15:00:00.000Z`, `${tuesday}T15:30:00.000Z`);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.message).toContain("10 AM – 2 PM");
  });

  test("booking on a closed day is rejected", async () => {
    primeBusinessHoursCache(businessId, hours());

    const response = await book(app, `${wednesday}T11:00:00.000Z`, `${wednesday}T11:30:00.000Z`);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.message).toBe("The business is closed on that day.");
  });

  test("booking inside the saved window still succeeds", async () => {
    primeBusinessHoursCache(businessId, hours());

    const response = await book(app, `${tuesday}T11:00:00.000Z`, `${tuesday}T11:30:00.000Z`);

    expect(response.status).toBe(201);
  });

  test("with no saved hours the booking path is unchanged (no hours enforcement)", async () => {
    const response = await book(app, `${tuesday}T20:00:00.000Z`, `${tuesday}T20:30:00.000Z`);

    expect(response.status).toBe(201);
  });
});
