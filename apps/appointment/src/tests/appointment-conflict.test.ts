import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { createApp } from "../app";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";
import {
  createAppointment,
  createAppointmentIfAvailable,
  hasAppointmentConflict,
  updateAppointmentStatus,
} from "../services/appointment-service";

const existingAppointmentInput = {
  businessId: "salon-001",
  customerName: "Existing Customer",
  service: "Haircut",
  startTime: "2026-08-10T10:00:00.000Z",
  endTime: "2026-08-10T10:30:00.000Z",
};

describe("appointment conflict prevention", () => {
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

  test("creates a non-overlapping appointment", async () => {
    createAppointment(db, existingAppointmentInput);

    const response = await postAppointment(app, {
      startTime: "2026-08-10T11:00:00.000Z",
      endTime: "2026-08-10T11:30:00.000Z",
    });

    expect(response.status).toBe(201);
    expect((await response.json()).success).toBe(true);
  });

  for (const conflict of [
    {
      name: "an exact duplicate interval",
      startTime: "2026-08-10T10:00:00.000Z",
      endTime: "2026-08-10T10:30:00.000Z",
    },
    {
      name: "a partial overlap at the beginning",
      startTime: "2026-08-10T09:45:00.000Z",
      endTime: "2026-08-10T10:15:00.000Z",
    },
    {
      name: "a partial overlap at the end",
      startTime: "2026-08-10T10:15:00.000Z",
      endTime: "2026-08-10T10:45:00.000Z",
    },
    {
      name: "an interval contained inside another",
      startTime: "2026-08-10T10:05:00.000Z",
      endTime: "2026-08-10T10:25:00.000Z",
    },
    {
      name: "an interval surrounding another",
      startTime: "2026-08-10T09:30:00.000Z",
      endTime: "2026-08-10T11:00:00.000Z",
    },
  ]) {
    test(`returns 409 for ${conflict.name}`, async () => {
      createAppointment(db, existingAppointmentInput);

      const response = await postAppointment(app, conflict);

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        success: false,
        message: "The requested appointment time is not available.",
      });
    });
  }

  test("allows an appointment beginning when another ends", async () => {
    createAppointment(db, existingAppointmentInput);

    const response = await postAppointment(app, {
      startTime: "2026-08-10T10:30:00.000Z",
      endTime: "2026-08-10T11:00:00.000Z",
    });

    expect(response.status).toBe(201);
  });

  test("allows an appointment ending when another begins", async () => {
    createAppointment(db, existingAppointmentInput);

    const response = await postAppointment(app, {
      startTime: "2026-08-10T09:30:00.000Z",
      endTime: "2026-08-10T10:00:00.000Z",
    });

    expect(response.status).toBe(201);
  });

  test("allows the same time for a different business", async () => {
    createAppointment(db, existingAppointmentInput);

    const response = await postAppointment(app, {
      businessId: "salon-002",
      startTime: existingAppointmentInput.startTime,
      endTime: existingAppointmentInput.endTime,
    });

    expect(response.status).toBe(201);
  });

  test("a pending appointment blocks the time", () => {
    createAppointment(db, existingAppointmentInput);

    expect(
      hasAppointmentConflict(
        db,
        existingAppointmentInput.businessId,
        existingAppointmentInput.startTime,
        existingAppointmentInput.endTime
      )
    ).toBe(true);
  });

  test("a confirmed appointment blocks the time", async () => {
    const existing = createAppointment(db, existingAppointmentInput);
    updateAppointmentStatus(db, existing.id, "confirmed");

    const response = await postAppointment(app, {});

    expect(response.status).toBe(409);
  });

  test("a cancelled appointment does not block the time", async () => {
    const existing = createAppointment(db, existingAppointmentInput);
    updateAppointmentStatus(db, existing.id, "cancelled");

    const response = await postAppointment(app, {});

    expect(response.status).toBe(201);
  });

  test("a completed appointment does not block the time", async () => {
    const existing = createAppointment(db, existingAppointmentInput);
    updateAppointmentStatus(db, existing.id, "confirmed");
    updateAppointmentStatus(db, existing.id, "completed");

    const response = await postAppointment(app, {});

    expect(response.status).toBe(201);
  });

  test("a rejected conflict does not insert another row", async () => {
    createAppointment(db, existingAppointmentInput);

    const response = await postAppointment(app, {});
    const rowCount = db
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM appointments"
      )
      .get();

    expect(response.status).toBe(409);
    expect(rowCount?.count).toBe(1);
  });

  test("transactional service returns created or conflict results", () => {
    const first = createAppointmentIfAvailable(db, existingAppointmentInput);
    const second = createAppointmentIfAvailable(db, existingAppointmentInput);

    expect(first.result).toBe("created");
    expect(second).toEqual({ result: "conflict" });
  });

  test("existing GET and PATCH APIs still work", async () => {
    const createdResponse = await postAppointment(app, {});
    const createdBody = await createdResponse.json();

    const listResponse = await app.handle(
      new Request(
        "http://localhost/api/appointments?businessId=salon-001"
      )
    );
    const detailResponse = await app.handle(
      new Request(
        `http://localhost/api/appointments/${createdBody.data.id}`
      )
    );
    const patchResponse = await app.handle(
      new Request(
        `http://localhost/api/appointments/${createdBody.data.id}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ status: "confirmed" }),
        }
      )
    );

    expect(createdResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(patchResponse.status).toBe(200);
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
  overrides: Record<string, unknown>
): Promise<Response> {
  return app.handle(
    new Request("http://localhost/api/appointments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...existingAppointmentInput,
        customerName: "New Customer",
        ...overrides,
      }),
    })
  );
}
