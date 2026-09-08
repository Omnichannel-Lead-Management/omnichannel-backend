import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { Elysia } from "elysia";
import { createApp } from "../app";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";
import {
  createAppointment,
  getAppointmentById,
  updateAppointmentStatus,
} from "../services/appointment-service";
import type { AppointmentStatus } from "../types/appointment";

const appointmentInput = {
  businessId: "salon-001",
  customerName: "Nimal Perera",
  service: "Haircut",
  startTime: "2026-08-10T10:00:00.000Z",
  endTime: "2026-08-10T10:30:00.000Z",
};

const unknownAppointmentId = "550e8400-e29b-41d4-a716-446655440000";

describe("PATCH /api/appointments/:id/status", () => {
  let db: Database;
  let app: Elysia;

  beforeEach(() => {
    db = createDatabase(":memory:");
    initializeDatabase(db);
    app = createApp(db, { getBusinessProfile: async () => null, notificationClient: { sendEmail: async () => {} }, diagnostic: () => {} });
  });

  afterEach(() => {
    db.close();
  });

  test("updates pending to confirmed and persists timestamps", async () => {
    const created = createAppointment(db, appointmentInput);
    await Bun.sleep(2);

    const response = await patchStatus(app, created.id, {
      status: " CONFIRMED ",
    });
    const body = await response.json();
    const persisted = getAppointmentById(db, created.id);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("confirmed");
    expect(body.data.createdAt).toBe(created.createdAt);
    expect(body.data.updatedAt).not.toBe(created.updatedAt);
    expect(persisted?.status).toBe("confirmed");
    expect(persisted?.createdAt).toBe(created.createdAt);
    expect(persisted?.updatedAt).toBe(body.data.updatedAt);
  });

  test("updates pending to cancelled", async () => {
    const created = createAppointment(db, appointmentInput);

    const response = await patchStatus(app, created.id, {
      status: "cancelled",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("cancelled");
  });

  test("updates confirmed to completed", async () => {
    const created = createAppointment(db, appointmentInput);
    expect(
      updateAppointmentStatus(db, created.id, "confirmed").result
    ).toBe("updated");

    const response = await patchStatus(app, created.id, {
      status: "completed",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("completed");
  });

  test("updates confirmed to cancelled", async () => {
    const created = createAppointment(db, appointmentInput);
    expect(
      updateAppointmentStatus(db, created.id, "confirmed").result
    ).toBe("updated");

    const response = await patchStatus(app, created.id, {
      status: "cancelled",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("cancelled");
  });

  test("returns 400 for an invalid status", async () => {
    const created = createAppointment(db, appointmentInput);

    const response = await patchStatus(app, created.id, {
      status: "rescheduled",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Invalid appointment status request.",
      errors: ["status must be a valid appointment status."],
    });
  });

  test("returns 400 when status is missing", async () => {
    const created = createAppointment(db, appointmentInput);

    const response = await patchStatus(app, created.id, {});

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Invalid appointment status request.",
      errors: ["status is required."],
    });
  });

  for (const body of [null, [], "confirmed", { status: 1 }]) {
    test(`returns 400 for invalid status body ${JSON.stringify(body)}`, async () => {
      const created = createAppointment(db, appointmentInput);

      const response = await patchStatus(app, created.id, body);

      expect(response.status).toBe(400);
      expect((await response.json()).success).toBe(false);
    });
  }

  test("returns 400 for an invalid UUID without querying SQLite", async () => {
    db.run("DROP TABLE appointments");

    const response = await patchStatus(app, "not-a-valid-uuid", {
      status: "confirmed",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      success: false,
      message: "Invalid appointment ID.",
    });
  });

  test("returns 404 for an unknown valid UUID", async () => {
    const response = await patchStatus(app, unknownAppointmentId, {
      status: "confirmed",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      message: "Appointment not found.",
    });
  });

  test("rejects cancelled to confirmed", async () => {
    const created = createInStatus(db, "cancelled");

    const response = await patchStatus(app, created.id, {
      status: "confirmed",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      success: false,
      message: "Appointment status transition is not allowed.",
    });
  });

  test("rejects completed to cancelled", async () => {
    const created = createInStatus(db, "completed");

    const response = await patchStatus(app, created.id, {
      status: "cancelled",
    });

    expect(response.status).toBe(409);
  });

  test("rejects confirmed to pending", async () => {
    const created = createInStatus(db, "confirmed");

    const response = await patchStatus(app, created.id, {
      status: "pending",
    });

    expect(response.status).toBe(409);
  });

  test("rejects updating to the current status", async () => {
    const created = createAppointment(db, appointmentInput);

    const response = await patchStatus(app, created.id, {
      status: "pending",
    });

    expect(response.status).toBe(409);
  });

  test("existing POST, list, and detail APIs still work", async () => {
    const postResponse = await app.handle(
      new Request("http://localhost/api/appointments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(appointmentInput),
      })
    );
    const postBody = await postResponse.json();

    const listResponse = await app.handle(
      new Request(
        "http://localhost/api/appointments?businessId=salon-001"
      )
    );
    const listBody = await listResponse.json();

    const detailResponse = await app.handle(
      new Request(
        `http://localhost/api/appointments/${postBody.data.id}`
      )
    );
    const detailBody = await detailResponse.json();

    expect(postResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(listBody.data).toHaveLength(1);
    expect(detailResponse.status).toBe(200);
    expect(detailBody.data.id).toBe(postBody.data.id);
  });

  test("returns a safe 500 response when updating fails", async () => {
    const created = createAppointment(db, appointmentInput);
    db.run("DROP TABLE appointments");

    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      const response = await patchStatus(app, created.id, {
        status: "confirmed",
      });
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body).toEqual({
        success: false,
        message: "Failed to update appointment status.",
      });
      expect(JSON.stringify(body)).not.toContain("SQLite");
      expect(JSON.stringify(body)).not.toContain("appointments.db");
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

function createInStatus(db: Database, status: AppointmentStatus) {
  const appointment = createAppointment(db, appointmentInput);

  if (status === "pending") {
    return appointment;
  }

  if (status === "confirmed") {
    updateAppointmentStatus(db, appointment.id, "confirmed");
    return appointment;
  }

  if (status === "cancelled") {
    updateAppointmentStatus(db, appointment.id, "cancelled");
    return appointment;
  }

  updateAppointmentStatus(db, appointment.id, "confirmed");
  updateAppointmentStatus(db, appointment.id, "completed");
  return appointment;
}

async function patchStatus(
  app: Elysia,
  appointmentId: string,
  body: unknown
): Promise<Response> {
  return app.handle(
    new Request(
      `http://localhost/api/appointments/${appointmentId}/status`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    )
  );
}
