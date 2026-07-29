import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { createApp } from "../app";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";

interface AppointmentRow {
  id: string;
  business_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  service: string;
  start_time: string;
  end_time: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const validInput = {
  businessId: "salon-001",
  customerName: "Nimal Perera",
  customerEmail: "nimal@example.com",
  customerPhone: "+94770000000",
  service: "Haircut",
  startTime: "2026-08-10T10:00:00.000Z",
  endTime: "2026-08-10T10:30:00.000Z",
  notes: "First visit",
};

describe("POST /api/appointments", () => {
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

  test("creates and persists a valid appointment", async () => {
    const response = await postAppointment(app, validInput);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.success).toBe(true);
    expect(body.data.id).toBeString();
    expect(body.data.id.length).toBeGreaterThan(0);
    expect(body.data.status).toBe("pending");
    expect(body.data.createdAt).toBeString();
    expect(body.data.updatedAt).toBe(body.data.createdAt);
    expect(Number.isNaN(Date.parse(body.data.createdAt))).toBe(false);

    const row = db
      .query<AppointmentRow, [string]>(
        "SELECT * FROM appointments WHERE id = ?"
      )
      .get(body.data.id);

    expect(row).not.toBeNull();
    expect(row?.business_id).toBe(validInput.businessId);
    expect(row?.customer_name).toBe(validInput.customerName);
    expect(row?.customer_email).toBe(validInput.customerEmail);
    expect(row?.customer_phone).toBe(validInput.customerPhone);
    expect(row?.service).toBe(validInput.service);
    expect(row?.start_time).toBe(validInput.startTime);
    expect(row?.end_time).toBe(validInput.endTime);
    expect(row?.status).toBe("pending");
    expect(row?.notes).toBe(validInput.notes);
    expect(row?.created_at).toBe(body.data.createdAt);
    expect(row?.updated_at).toBe(body.data.updatedAt);
  });

  for (const field of [
    "businessId",
    "customerName",
    "service",
    "startTime",
    "endTime",
  ] as const) {
    test(`returns 400 when ${field} is missing`, async () => {
      const input: Record<string, unknown> = { ...validInput };
      delete input[field];

      const response = await postAppointment(app, input);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.errors).toContain(`${field} is required.`);
    });
  }

  test("returns 400 for an invalid startTime", async () => {
    const response = await postAppointment(app, {
      ...validInput,
      startTime: "not-a-date",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "startTime must be a valid ISO date-time string."
    );
  });

  test("returns 400 for an invalid endTime", async () => {
    const response = await postAppointment(app, {
      ...validInput,
      endTime: "2026-08-10",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "endTime must be a valid ISO date-time string."
    );
  });

  test("returns 400 when endTime equals startTime", async () => {
    const response = await postAppointment(app, {
      ...validInput,
      endTime: validInput.startTime,
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors).toContain("endTime must be later than startTime.");
  });

  test("returns 400 when endTime is before startTime", async () => {
    const response = await postAppointment(app, {
      ...validInput,
      endTime: "2026-08-10T09:30:00.000Z",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors).toContain("endTime must be later than startTime.");
  });

  test("returns 400 for an invalid optional email", async () => {
    const response = await postAppointment(app, {
      ...validInput,
      customerEmail: "invalid-email",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errors).toContain(
      "customerEmail must be a valid email address."
    );
  });

  for (const field of ["businessId", "customerName", "service"] as const) {
    test(`returns 400 when ${field} contains only whitespace`, async () => {
      const response = await postAppointment(app, {
        ...validInput,
        [field]: "   ",
      });
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.errors).toContain(`${field} is required.`);
    });
  }

  test("stores omitted optional values as null", async () => {
    const response = await postAppointment(app, {
      businessId: validInput.businessId,
      customerName: validInput.customerName,
      service: validInput.service,
      startTime: validInput.startTime,
      endTime: validInput.endTime,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.customerEmail).toBeNull();
    expect(body.data.customerPhone).toBeNull();
    expect(body.data.notes).toBeNull();

    const row = db
      .query<
        Pick<
          AppointmentRow,
          "customer_email" | "customer_phone" | "notes"
        >,
        [string]
      >(
        "SELECT customer_email, customer_phone, notes FROM appointments WHERE id = ?"
      )
      .get(body.data.id);

    expect(row).toEqual({
      customer_email: null,
      customer_phone: null,
      notes: null,
    });
  });

  test("normalizes text and date-time input", async () => {
    const response = await postAppointment(app, {
      ...validInput,
      businessId: " salon-001 ",
      customerName: " Nimal Perera ",
      customerEmail: " nimal@example.com ",
      customerPhone: " +94770000000 ",
      service: " Haircut ",
      startTime: " 2026-08-10T15:30:00+05:30 ",
      endTime: " 2026-08-10T16:00:00+05:30 ",
      notes: " First visit ",
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.businessId).toBe("salon-001");
    expect(body.data.customerName).toBe("Nimal Perera");
    expect(body.data.customerEmail).toBe("nimal@example.com");
    expect(body.data.customerPhone).toBe("+94770000000");
    expect(body.data.service).toBe("Haircut");
    expect(body.data.startTime).toBe("2026-08-10T10:00:00.000Z");
    expect(body.data.endTime).toBe("2026-08-10T10:30:00.000Z");
    expect(body.data.notes).toBe("First visit");
  });

  test("returns 500 without exposing SQLite details when insertion fails", async () => {
    db.run("DROP TABLE appointments");

    const response = await postAppointment(app, validInput);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      message: "Failed to create appointment.",
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

async function postAppointment(
  app: Elysia,
  body: unknown
): Promise<Response> {
  return app.handle(
    new Request("http://localhost/api/appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
  );
}
