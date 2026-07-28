import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { createApp } from "../app";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";
import {
  createAppointment,
  getAppointmentById,
} from "../services/appointment-service";

const appointmentInput = {
  businessId: "salon-001",
  customerName: "Nimal Perera",
  service: "Haircut",
  startTime: "2026-08-10T10:00:00.000Z",
  endTime: "2026-08-10T10:30:00.000Z",
};

const unknownAppointmentId = "550e8400-e29b-41d4-a716-446655440000";

describe("GET /api/appointments/:id", () => {
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

  test("retrieves a saved appointment by ID with camelCase fields", async () => {
    const created = createAppointment(db, {
      ...appointmentInput,
      customerEmail: "nimal@example.com",
      customerPhone: "+94770000000",
      notes: "First visit",
    });

    const response = await getAppointment(app, created.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(created.id);
    expect(body.data.businessId).toBe(appointmentInput.businessId);
    expect(body.data.customerName).toBe(appointmentInput.customerName);
    expect(body.data.customerEmail).toBe("nimal@example.com");
    expect(body.data.customerPhone).toBe("+94770000000");
    expect(body.data.service).toBe(appointmentInput.service);
    expect(body.data.startTime).toBe(appointmentInput.startTime);
    expect(body.data.endTime).toBe(appointmentInput.endTime);
    expect(body.data.status).toBe("pending");
    expect(body.data.notes).toBe("First visit");
    expect(body.data.createdAt).toBe(created.createdAt);
    expect(body.data.updatedAt).toBe(created.updatedAt);
    expect("business_id" in body.data).toBe(false);
    expect("customer_name" in body.data).toBe(false);
    expect("start_time" in body.data).toBe(false);
    expect("created_at" in body.data).toBe(false);
  });

  test("preserves nullable fields as null", async () => {
    const created = createAppointment(db, appointmentInput);

    const response = await getAppointment(app, created.id);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.customerEmail).toBeNull();
    expect(body.data.customerPhone).toBeNull();
    expect(body.data.notes).toBeNull();
  });

  test("returns 404 for an unknown valid UUID", async () => {
    const response = await getAppointment(app, unknownAppointmentId);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      message: "Appointment not found.",
    });
  });

  for (const id of ["not-a-valid-uuid", "%20", "550e8400-e29b-01d4-a716-446655440000"]) {
    test(`returns 400 for malformed appointment ID ${id}`, async () => {
      const response = await getAppointment(app, id);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        success: false,
        message: "Invalid appointment ID.",
      });
    });
  }

  test("accepts UUIDs case-insensitively", async () => {
    const created = createAppointment(db, appointmentInput);

    const response = await getAppointment(app, created.id.toUpperCase());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.id).toBe(created.id);
  });

  test("service returns null when no appointment matches", () => {
    expect(getAppointmentById(db, unknownAppointmentId)).toBeNull();
  });

  test("existing list route still matches and works", async () => {
    const created = createAppointment(db, appointmentInput);

    const response = await app.handle(
      new Request(
        "http://localhost/api/appointments?businessId=salon-001"
      )
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.map((appointment: { id: string }) => appointment.id)).toEqual([
      created.id,
    ]);
  });

  test("existing POST route still creates an appointment", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/appointments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(appointmentInput),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeString();
  });

  test("returns a safe 500 response when retrieval fails", async () => {
    db.run("DROP TABLE appointments");

    const response = await getAppointment(app, unknownAppointmentId);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      message: "Failed to retrieve appointment.",
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

async function getAppointment(app: Elysia, id: string): Promise<Response> {
  return app.handle(
    new Request(`http://localhost/api/appointments/${id}`)
  );
}
