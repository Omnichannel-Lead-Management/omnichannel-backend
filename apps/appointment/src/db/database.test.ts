import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createDatabase } from "./database";
import { initializeDatabase } from "./initialize";

interface TableInfo {
  name: string;
  notnull: number;
  pk: number;
}

const validAppointment = [
  "appointment-1",
  "business-1",
  "Customer Name",
  "customer@example.com",
  "+94770000000",
  "Haircut",
  "2026-08-01T09:00:00.000Z",
  "2026-08-01T10:00:00.000Z",
  "pending",
  null,
  "2026-07-28T12:00:00.000Z",
  "2026-07-28T12:00:00.000Z",
] as const;

describe("appointment database initialization", () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  test("creates the appointments table and required columns", () => {
    initializeDatabase(db);

    const table = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'appointments'"
      )
      .get();
    const columns = db
      .query<TableInfo, []>("PRAGMA table_info(appointments)")
      .all();
    const byName = new Map(columns.map((column) => [column.name, column]));

    expect(table?.name).toBe("appointments");
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "business_id",
      "customer_name",
      "customer_email",
      "customer_phone",
      "service",
      "start_time",
      "end_time",
      "status",
      "notes",
      "created_at",
      "updated_at",
    ]);
    expect(byName.get("id")?.pk).toBe(1);

    for (const requiredColumn of [
      "business_id",
      "customer_name",
      "service",
      "start_time",
      "end_time",
      "status",
      "created_at",
      "updated_at",
    ]) {
      expect(byName.get(requiredColumn)?.notnull).toBe(1);
    }
  });

  test("can initialize the database twice", () => {
    initializeDatabase(db);
    expect(() => initializeDatabase(db)).not.toThrow();
  });

  test("rejects unsupported appointment statuses", () => {
    initializeDatabase(db);

    expect(() =>
      insertAppointment(db, [
        ...validAppointment.slice(0, 8),
        "unsupported",
        ...validAppointment.slice(9),
      ])
    ).toThrow();
  });

  test("rejects an end time that is not after the start time", () => {
    initializeDatabase(db);

    expect(() =>
      insertAppointment(db, [
        ...validAppointment.slice(0, 7),
        validAppointment[6],
        ...validAppointment.slice(8),
      ])
    ).toThrow();
  });

  test("inserts a valid appointment row", () => {
    initializeDatabase(db);

    insertAppointment(db, validAppointment);

    const row = db
      .query<{ id: string; status: string }, []>(
        "SELECT id, status FROM appointments WHERE id = 'appointment-1'"
      )
      .get();

    expect(row).toEqual({ id: "appointment-1", status: "pending" });
  });
});

function insertAppointment(
  db: Database,
  values: readonly unknown[]
): void {
  db.query(`
    INSERT INTO appointments (
      id,
      business_id,
      customer_name,
      customer_email,
      customer_phone,
      service,
      start_time,
      end_time,
      status,
      notes,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...values);
}
