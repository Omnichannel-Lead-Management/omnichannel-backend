import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";
import { createAppointment } from "../services/appointment-service";

/**
 * Covers the conversational booking path (POST /chat) that the routing service
 * calls. Gemini extraction is mocked so these stay deterministic and offline —
 * the extractor's own contract is that it returns validated fields or nulls.
 */

const BUSINESS_ID = "biz_test_salon";

let db: Database;
let extraction: Record<string, unknown>;

mock.module("../services/booking-parser", () => ({
  extractBookingDetails: async () => extraction
}));

// Imported after the mock so the route picks up the stub.
const { createApp } = await import("../app");

/** A date far enough ahead that "already passed" never trips. */
function futureDate(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function chat(app: ReturnType<typeof createApp>, body: Record<string, unknown>) {
  return app.handle(
    new Request("http://localhost/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "book me in", business_id: BUSINESS_ID, ...body })
    })
  );
}

beforeEach(() => {
  db = createDatabase(":memory:");
  initializeDatabase(db);
  extraction = {
    date: futureDate(),
    time: "10:00",
    service: "Haircut",
    customerName: "Nimal",
    intent: "book"
  };
});

afterEach(() => {
  db.close();
});

describe("POST /chat booking flow", () => {
  test("creates an appointment and confirms it", async () => {
    const app = createApp(db);
    const response = await chat(app, {});
    const payload = (await response.json()) as {
      success: boolean;
      messages: { text: string }[];
    };

    expect(payload.success).toBe(true);
    expect(payload.messages[0]?.text).toContain("Booked");
    expect(payload.messages[0]?.text).toContain("Haircut");

    const rows = db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM appointments")
      .get();
    expect(rows?.count).toBe(1);
  });

  test("asks for a time when only a date was given", async () => {
    extraction = { ...extraction, time: null };
    const app = createApp(db);
    const payload = (await (await chat(app, {})).json()) as { messages: { text: string }[] };

    expect(payload.messages[0]?.text).toContain("What time");
  });

  test("asks for the day when nothing was given", async () => {
    extraction = { ...extraction, date: null, time: null };
    const app = createApp(db);
    const payload = (await (await chat(app, {})).json()) as { messages: { text: string }[] };

    expect(payload.messages[0]?.text).toContain("which day and time");
  });

  test("rejects a time in the past", async () => {
    extraction = { ...extraction, date: "2020-01-01", time: "10:00" };
    const app = createApp(db);
    const payload = (await (await chat(app, {})).json()) as { messages: { text: string }[] };

    expect(payload.messages[0]?.text).toContain("already passed");
  });

  test("rejects a time outside opening hours", async () => {
    extraction = { ...extraction, time: "23:00" };
    const app = createApp(db);
    const payload = (await (await chat(app, {})).json()) as { messages: { text: string }[] };

    expect(payload.messages[0]?.text).toContain("only open");
  });

  test("offers free slots when the requested time is taken", async () => {
    const date = futureDate();
    createAppointment(db, {
      businessId: BUSINESS_ID,
      customerName: "Existing",
      service: "Colour",
      startTime: `${date}T10:00:00.000Z`,
      endTime: `${date}T10:30:00.000Z`
    });

    const app = createApp(db);
    const payload = (await (await chat(app, {})).json()) as {
      messages: { text: string; quick_replies?: { label: string }[] }[];
    };

    expect(payload.messages[0]?.text).toContain("already taken");
    expect(payload.messages[0]?.quick_replies).toBeUndefined();
  });

  test("returns slots as quick replies when the platform supports them", async () => {
    const date = futureDate();
    createAppointment(db, {
      businessId: BUSINESS_ID,
      customerName: "Existing",
      service: "Colour",
      startTime: `${date}T10:00:00.000Z`,
      endTime: `${date}T10:30:00.000Z`
    });

    const app = createApp(db);
    const payload = (await (
      await chat(app, {
        platform_capabilities: { quick_replies: true, max_quick_replies: 2 }
      })
    ).json()) as { messages: { type: string; quick_replies?: { label: string }[] }[] };

    expect(payload.messages[0]?.type).toBe("interactive");
    expect(payload.messages[0]?.quick_replies?.length).toBe(2);
  });

  test("falls back to the platform's first name when no name was given", async () => {
    extraction = { ...extraction, customerName: null };
    const app = createApp(db);
    await chat(app, { user_info: { first_name: "Kalana" } });

    const row = db
      .query<{ customer_name: string }, []>("SELECT customer_name FROM appointments")
      .get();
    expect(row?.customer_name).toBe("Kalana");
  });

  test("books against the tenant in business_id, not a default", async () => {
    const app = createApp(db);
    await chat(app, { business_id: "biz_other_tenant" });

    const row = db
      .query<{ business_id: string }, []>("SELECT business_id FROM appointments")
      .get();
    expect(row?.business_id).toBe("biz_other_tenant");
  });

  test("hands off to a human for cancellations", async () => {
    extraction = { ...extraction, intent: "other" };
    const app = createApp(db);
    const payload = (await (await chat(app, {})).json()) as {
      escalated: boolean;
      messages: { text: string }[];
    };

    expect(payload.escalated).toBe(true);
    expect(payload.messages[0]?.text).toContain("connect you");
  });
});
