import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { createApp } from "../app";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";
import { createAppointment } from "../services/appointment-service";

const baseInput = {
  businessId: "salon-001",
  customerName: "Nimal Perera",
  service: "Haircut",
  startTime: "2026-08-10T10:00:00.000Z",
  endTime: "2026-08-10T10:30:00.000Z",
};

describe("GET /api/appointments", () => {
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

  test("returns only the business appointments ordered by startTime", async () => {
    const later = createAppointment(db, {
      ...baseInput,
      customerName: "Later Customer",
      startTime: "2026-08-10T12:00:00.000Z",
      endTime: "2026-08-10T12:30:00.000Z",
    });
    const earlier = createAppointment(db, {
      ...baseInput,
      customerName: "Earlier Customer",
      customerEmail: "earlier@example.com",
      customerPhone: "+94771111111",
      notes: "Morning visit",
      startTime: "2026-08-10T08:00:00.000Z",
      endTime: "2026-08-10T08:30:00.000Z",
    });
    createAppointment(db, {
      ...baseInput,
      businessId: "salon-002",
      customerName: "Other Business Customer",
    });

    const response = await getAppointments(app, "salon-001");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data.map((appointment: { id: string }) => appointment.id)).toEqual([
      earlier.id,
      later.id,
    ]);
    expect(
      body.data.every(
        (appointment: { businessId: string }) =>
          appointment.businessId === "salon-001"
      )
    ).toBe(true);
  });

  test("maps database rows to camelCase and preserves null values", async () => {
    createAppointment(db, baseInput);

    const response = await getAppointments(app, " salon-001 ");
    const body = await response.json();
    const appointment = body.data[0];

    expect(response.status).toBe(200);
    expect(appointment).toEqual({
      id: expect.any(String),
      businessId: "salon-001",
      customerName: "Nimal Perera",
      customerEmail: null,
      customerPhone: null,
      service: "Haircut",
      startTime: "2026-08-10T10:00:00.000Z",
      endTime: "2026-08-10T10:30:00.000Z",
      status: "pending",
      notes: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect("business_id" in appointment).toBe(false);
    expect("start_time" in appointment).toBe(false);
    expect("created_at" in appointment).toBe(false);
  });

  test("returns 200 with an empty array for an unknown business", async () => {
    const response = await getAppointments(app, "unknown-business");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      data: [],
    });
  });

  test("returns 400 when businessId is missing", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/appointments")
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "businessId is required.",
    });
  });

  for (const businessId of ["", "   "]) {
    test(`returns 400 when businessId is ${businessId ? "whitespace" : "empty"}`, async () => {
      const response = await getAppointments(app, businessId);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        success: false,
        message: "businessId is required.",
      });
    });
  }

  test("returns a safe 500 response when retrieval fails", async () => {
    db.run("DROP TABLE appointments");

    const response = await getAppointments(app, "salon-001");
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      message: "Failed to retrieve appointments.",
    });
    expect(JSON.stringify(body)).not.toContain("SQLite");
    expect(JSON.stringify(body)).not.toContain("appointments.db");
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

async function getAppointments(
  app: Elysia,
  businessId: string
): Promise<Response> {
  const url = new URL("http://localhost/api/appointments");
  url.searchParams.set("businessId", businessId);

  return app.handle(new Request(url));
}
