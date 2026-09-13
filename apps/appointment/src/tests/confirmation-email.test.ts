import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createApp } from "../app";
import { createDatabase } from "../db/database";
import { initializeDatabase } from "../db/initialize";
import { createAppointment, getAppointmentById } from "../services/appointment-service";
import { createBusinessEmailProfileProvider, type ConfirmationEmailDependencies } from "../services/confirmation-email";
import { createNotificationClient, type AppointmentEmailRequest } from "../services/notification-client";

let db: Database;
let sent: AppointmentEmailRequest[];
let lookedUp: string[];
let diagnostics: string[];
let deps: ConfirmationEmailDependencies;
const input = { businessId: "salon-a", customerName: "Customer A", customerEmail: "customer@example.test", service: "Haircut", startTime: "2026-10-01T10:00:00.000Z", endTime: "2026-10-01T10:30:00.000Z" };
beforeEach(() => {
  db = createDatabase(":memory:"); initializeDatabase(db);
  sent = []; lookedUp = []; diagnostics = [];
  deps = {
    getBusinessProfile: async id => { lookedUp.push(id); return { id, name: `Name ${id}`, owner_email: `${id}@example.test` }; },
    notificationClient: createNotificationClient({ fetcher: async (url, init) => {
      expect(url).toBe("http://localhost:3004/api/notifications/email");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "application/json" });
      sent.push(JSON.parse(String(init?.body)));
      return Response.json({ success: true, email_sent: true });
    }, url: "http://localhost:3004/" }),
    diagnostic: reason => { diagnostics.push(reason); },
  };
});
afterEach(() => db.close());
function patch(id: string, status: string, extra = {}) {
  return createApp(db, deps).handle(new Request(`http://localhost/api/appointments/${id}/status`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, ...extra }),
  }));
}

test("concurrent and repeated confirmations send exact persisted, business-scoped data once", async () => {
  const a = createAppointment(db, input);
  const responses = await Promise.all([patch(a.id, "confirmed", { businessId: "salon-b", customerName: "Spoof" }), patch(a.id, "confirmed")]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect((await patch(a.id, "confirmed")).status).toBe(409);
  expect(lookedUp).toEqual(["salon-a"]);
  expect(sent).toEqual([{
    business_id: "salon-a", recipient_email: "salon-a@example.test", template: "appointment_confirmed",
    data: { appointment_id: a.id, business_name: "Name salon-a", customer_name: input.customerName, service: input.service, start_time: input.startTime, end_time: input.endTime },
  }]);
  const b = createAppointment(db, { ...input, businessId: "salon-b", customerName: "Customer B" });
  expect((await patch(b.id, "confirmed")).status).toBe(200);
  expect(sent[1]?.business_id).toBe("salon-b");
  expect(sent[1]?.recipient_email).toBe("salon-b@example.test");
  expect(sent[1]?.data.customer_name).toBe("Customer B");
});

test("creation, booking conflicts, cancellation, completion, invalid requests and transitions do not send", async () => {
  const app = createApp(db, deps);
  const post = () => app.handle(new Request("http://localhost/api/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }));
  const response = await post(); expect(response.status).toBe(201);
  const { data } = await response.json(); expect(data.status).toBe("pending");
  expect((await post()).status).toBe(409);
  expect((await patch(data.id, "completed")).status).toBe(409);
  expect((await patch(data.id, "garbage")).status).toBe(400);
  expect((await patch("invalid", "confirmed")).status).toBe(400);
  expect((await patch(crypto.randomUUID(), "confirmed")).status).toBe(404);
  expect((await patch(data.id, "cancelled")).status).toBe(200);
  expect((await patch(data.id, "confirmed")).status).toBe(409);
  const b = createAppointment(db, { ...input, businessId: "b" });
  db.run("UPDATE appointments SET status = 'confirmed' WHERE id = ?", [b.id]);
  expect((await patch(b.id, "completed")).status).toBe(200);
  expect(sent).toEqual([]); expect(lookedUp).toEqual([]);
});

test("a database update that changes no row cannot trigger email", async () => {
  const a = createAppointment(db, input);
  db.run("CREATE TRIGGER ignore_update BEFORE UPDATE ON appointments BEGIN SELECT RAISE(IGNORE); END");
  expect((await patch(a.id, "confirmed")).status).toBe(409);
  expect(getAppointmentById(db, a.id)?.status).toBe("pending");
  expect(sent).toEqual([]); expect(lookedUp).toEqual([]);
});

for (const scenario of ["missing", "mismatch", "profile-error", "smtp-error", "timeout"]) {
  test(`${scenario} preserves successful confirmation without customer fallback`, async () => {
    const a = createAppointment(db, input);
    if (scenario === "missing") deps.getBusinessProfile = async id => ({ id, name: "Salon", owner_email: " " });
    if (scenario === "mismatch") deps.getBusinessProfile = async () => ({ id: "other", name: "Other", owner_email: "other@example.test" });
    if (scenario === "profile-error") deps.getBusinessProfile = async () => { throw new Error("private details"); };
    let attempts = 0;
    if (scenario === "smtp-error" || scenario === "timeout") deps.notificationClient = createNotificationClient({ timeoutMs: 5, fetcher: async () => {
      attempts++;
      if (scenario === "smtp-error") return Response.json({ error: "SMTP_DELIVERY_FAILED" }, { status: 502 });
      return new Promise(() => {});
    } });
    expect((await patch(a.id, "confirmed")).status).toBe(200);
    expect(getAppointmentById(db, a.id)?.status).toBe("confirmed");
    expect((await patch(a.id, "confirmed")).status).toBe(409);
    expect(sent).toEqual([]);
    expect(attempts).toBe(scenario === "smtp-error" || scenario === "timeout" ? 1 : 0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics.join()).not.toContain("@");
    expect(diagnostics.join()).not.toContain("private details");
  });
}

test("business profile provider uses encoded tenant path and rejects cross-business responses", async () => {
  const provider = createBusinessEmailProfileProvider({ url: "http://gateway:3000/", fetcher: async url => {
    expect(url).toBe("http://gateway:3000/api/businesses/salon%2Fa");
    return Response.json({ business: { id: "different", name: "Wrong", owner_email: "wrong@example.test" } });
  } });
  expect(await provider("salon/a")).toBeNull();
});

test("database write failure sends nothing", async () => {
  const a = createAppointment(db, input);
  db.run("CREATE TRIGGER fail_update BEFORE UPDATE ON appointments BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  expect((await patch(a.id, "confirmed")).status).toBe(500);
  expect(getAppointmentById(db, a.id)?.status).toBe("pending");
  expect(sent).toEqual([]); expect(lookedUp).toEqual([]);
});

test("unavailable notification service does not fail confirmation or retry", async () => {
  let attempts = 0;
  deps.notificationClient = createNotificationClient({ fetcher: async () => {
    attempts++; throw new Error("connection refused");
  } });
  const a = createAppointment(db, input);
  expect((await patch(a.id, "confirmed")).status).toBe(200);
  expect(getAppointmentById(db, a.id)?.status).toBe("confirmed");
  expect(attempts).toBe(1);
});

test("profile timeout is bounded and does not fail confirmation", async () => {
  let signal: AbortSignal | null | undefined;
  deps.getBusinessProfile = createBusinessEmailProfileProvider({ timeoutMs: 5, fetcher: async (_, init) => {
    signal = init?.signal;
    return new Promise(() => {});
  } });
  const a = createAppointment(db, input);
  expect((await patch(a.id, "confirmed")).status).toBe(200);
  expect(signal?.aborted).toBe(true);
  expect(sent).toEqual([]);
});

test("real profile provider contract feeds the correct owner into the notification client", async () => {
  deps.getBusinessProfile = createBusinessEmailProfileProvider({ fetcher: async () => Response.json({
    success: true, business: { id: input.businessId, name: "Persisted Salon", owner_email: " owner@example.test " },
  }) });
  const a = createAppointment(db, input);
  expect((await patch(a.id, "confirmed")).status).toBe(200);
  expect(sent[0]?.recipient_email).toBe("owner@example.test");
  expect(sent[0]?.data.business_name).toBe("Persisted Salon");
});
