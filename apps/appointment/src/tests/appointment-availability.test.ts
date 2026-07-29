import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { createApp } from "../app";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";
import {
  createAppointment,
  getAvailableAppointmentSlots,
  updateAppointmentStatus,
} from "../services/appointment-service";

const requestedDate = "2026-08-11";
const businessId = "salon-001";

const baseAppointment = {
  businessId,
  customerName: "Nimal Perera",
  service: "Haircut",
  startTime: `${requestedDate}T10:00:00.000Z`,
  endTime: `${requestedDate}T10:30:00.000Z`,
};

describe("GET /api/appointments/availability", () => {
  let db: Database;
  let app: Elysia;

  beforeEach(() => {
    db = createDatabase(":memory:");
    initializeDatabase(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  test("returns all 16 ordered slots from 09:00 through 17:00", async () => {
    const response = await getAvailability(app, businessId, requestedDate);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.businessId).toBe(businessId);
    expect(body.data.date).toBe(requestedDate);
    expect(body.data.slots).toHaveLength(16);
    expect(body.data.slots[0]).toEqual({
      startTime: `${requestedDate}T09:00:00.000Z`,
      endTime: `${requestedDate}T09:30:00.000Z`,
    });
    expect(body.data.slots[15]).toEqual({
      startTime: `${requestedDate}T16:30:00.000Z`,
      endTime: `${requestedDate}T17:00:00.000Z`,
    });

    const startTimes = body.data.slots.map(
      (slot: { startTime: string }) => slot.startTime
    );
    expect(startTimes).toEqual([...startTimes].sort());
  });

  test("a pending appointment removes its overlapping slot", async () => {
    createAppointment(db, baseAppointment);

    const slots = await requestSlots(app);

    expect(slots).toHaveLength(15);
    expect(hasSlot(slots, `${requestedDate}T10:00:00.000Z`)).toBe(false);
  });

  test("a confirmed appointment removes its overlapping slot", async () => {
    const appointment = createAppointment(db, baseAppointment);
    updateAppointmentStatus(db, appointment.id, "confirmed");

    const slots = await requestSlots(app);

    expect(slots).toHaveLength(15);
    expect(hasSlot(slots, `${requestedDate}T10:00:00.000Z`)).toBe(false);
  });

  test("a cancelled appointment does not remove a slot", async () => {
    const appointment = createAppointment(db, baseAppointment);
    updateAppointmentStatus(db, appointment.id, "cancelled");

    const slots = await requestSlots(app);

    expect(slots).toHaveLength(16);
    expect(hasSlot(slots, `${requestedDate}T10:00:00.000Z`)).toBe(true);
  });

  test("a completed appointment does not remove a slot", async () => {
    const appointment = createAppointment(db, baseAppointment);
    updateAppointmentStatus(db, appointment.id, "confirmed");
    updateAppointmentStatus(db, appointment.id, "completed");

    const slots = await requestSlots(app);

    expect(slots).toHaveLength(16);
    expect(hasSlot(slots, `${requestedDate}T10:00:00.000Z`)).toBe(true);
  });

  test("another business appointment does not remove a slot", async () => {
    createAppointment(db, {
      ...baseAppointment,
      businessId: "salon-002",
    });

    expect(await requestSlots(app)).toHaveLength(16);
  });

  test("an appointment on another date does not remove a slot", async () => {
    createAppointment(db, {
      ...baseAppointment,
      startTime: "2026-08-12T10:00:00.000Z",
      endTime: "2026-08-12T10:30:00.000Z",
    });

    expect(await requestSlots(app)).toHaveLength(16);
  });

  test("a partial appointment blocks every slot it overlaps", async () => {
    createAppointment(db, {
      ...baseAppointment,
      startTime: `${requestedDate}T10:15:00.000Z`,
      endTime: `${requestedDate}T10:45:00.000Z`,
    });

    const slots = await requestSlots(app);

    expect(slots).toHaveLength(14);
    expect(hasSlot(slots, `${requestedDate}T10:00:00.000Z`)).toBe(false);
    expect(hasSlot(slots, `${requestedDate}T10:30:00.000Z`)).toBe(false);
  });

  test("a slot beginning exactly when an appointment ends remains available", async () => {
    createAppointment(db, {
      ...baseAppointment,
      startTime: `${requestedDate}T09:30:00.000Z`,
      endTime: `${requestedDate}T10:00:00.000Z`,
    });

    const slots = await requestSlots(app);

    expect(hasSlot(slots, `${requestedDate}T10:00:00.000Z`)).toBe(true);
  });

  test("service returns slots with the same boundary behavior", () => {
    createAppointment(db, baseAppointment);

    const slots = getAvailableAppointmentSlots(db, businessId, requestedDate);

    expect(hasSlot(slots, `${requestedDate}T09:30:00.000Z`)).toBe(true);
    expect(hasSlot(slots, `${requestedDate}T10:00:00.000Z`)).toBe(false);
    expect(hasSlot(slots, `${requestedDate}T10:30:00.000Z`)).toBe(true);
  });

  test("returns 400 when businessId is missing", async () => {
    const response = await app.handle(
      new Request(
        `http://localhost/api/appointments/availability?date=${requestedDate}`
      )
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain(
      "businessId is required."
    );
  });

  test("returns 400 when businessId is empty", async () => {
    const response = await getAvailability(app, "", requestedDate);

    expect(response.status).toBe(400);
    expect((await response.json()).message).toBe(
      "Invalid availability request."
    );
  });

  test("returns 400 when date is missing", async () => {
    const response = await app.handle(
      new Request(
        `http://localhost/api/appointments/availability?businessId=${businessId}`
      )
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain("date is required.");
  });

  test("returns 400 for an invalid date format", async () => {
    const response = await getAvailability(app, businessId, "11-08-2026");

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain(
      "date must use YYYY-MM-DD format."
    );
  });

  test("returns 400 for an impossible calendar date", async () => {
    const response = await getAvailability(app, businessId, "2026-02-30");

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toContain(
      "date must be a valid calendar date."
    );
  });

  test("availability is matched before the dynamic ID route", async () => {
    const response = await getAvailability(app, businessId, requestedDate);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.slots).toBeArray();
  });

  test("returns a safe 500 response when availability retrieval fails", async () => {
    db.run("DROP TABLE appointments");

    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      const response = await getAvailability(app, businessId, requestedDate);

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        success: false,
        message: "Failed to retrieve appointment availability.",
      });
    } finally {
      console.error = originalConsoleError;
    }
  });

  test("uses only an in-memory SQLite database", () => {
    const databases = db
      .query<{ seq: number; name: string; file: string }, []>(
        "PRAGMA database_list"
      )
      .all();

    expect(databases).toHaveLength(1);
    expect(databases[0]?.name).toBe("main");
    expect(databases[0]?.file).toBe("");
  });
});

async function requestSlots(app: Elysia) {
  const response = await getAvailability(app, businessId, requestedDate);
  const body = await response.json();
  return body.data.slots;
}

async function getAvailability(
  app: Elysia,
  requestedBusinessId: string,
  date: string
): Promise<Response> {
  const url = new URL("http://localhost/api/appointments/availability");
  url.searchParams.set("businessId", requestedBusinessId);
  url.searchParams.set("date", date);
  return app.handle(new Request(url));
}

function hasSlot(
  slots: Array<{ startTime: string }>,
  startTime: string
): boolean {
  return slots.some((slot) => slot.startTime === startTime);
}
