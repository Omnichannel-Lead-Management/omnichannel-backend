import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createApp } from "../../../notification/src/app";
import { createDatabase, initializeDatabase } from "../../../notification/src/db";
import { listNotifications } from "../../../notification/src/store";
import { TemplatedEmailService } from "../../../notification/src/email/services";
import type { EmailMessage } from "../../../notification/src/email-provider";
import type { Lead } from "../db/schema";
import { getBusinessProfile } from "./business-profile";
import { notifyLeadEvent } from "./notify";

const lead: Lead = {
  id: "lead_persisted", business_id: "biz_persisted", messenger_id: "customer",
  platform: "web", status: "new", score: 75, source: "web",
  service_interest: "Styling", channel_source: null, assigned_agent_id: "agent_1",
  tags: null, notes: null, budget_range: null, created_at: 1, updated_at: 1,
  last_contact_at: 1, converted_at: null, conversion_value: null
};
const profile = { success: true, business: { id: lead.business_id, name: " Salon ", owner_email: " owner@example.test " } };
const originalEnv = { NODE_ENV: process.env.NODE_ENV, NOTIFICATIONS_ENABLED: process.env.NOTIFICATIONS_ENABLED,
  GATEWAY_SERVICE_URL: process.env.GATEWAY_SERVICE_URL };
const originalFetch = globalThis.fetch;
let db: ReturnType<typeof createDatabase>;
let gatewayResponse: () => Response;
let requests: Array<{ url: string; init?: RequestInit }>;
let messages: EmailMessage[];
let smtpFails: boolean;
let emailEnabled: boolean;
let notificationFailure: "network" | "http" | undefined;
let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  process.env.NODE_ENV = "development";
  delete process.env.NOTIFICATIONS_ENABLED;
  process.env.GATEWAY_SERVICE_URL = "http://gateway.test";
  db = createDatabase(":memory:");
  initializeDatabase(db);
  requests = []; messages = []; smtpFails = false; emailEnabled = true;
  notificationFailure = undefined;
  gatewayResponse = () => Response.json(profile);
  warn = spyOn(console, "warn").mockImplementation(() => {});
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).startsWith("http://gateway.test")) return gatewayResponse();
    if (notificationFailure === "network") throw new Error("offline");
    if (notificationFailure === "http") return new Response("unavailable", { status: 503 });
    const app = createApp(db, {
      notificationsEnabled: emailEnabled,
      emailService: new TemplatedEmailService({ sendEmail: async message => {
        messages.push(message);
        return smtpFails
          ? { success: false, error: { code: "SMTP_DELIVERY_FAILED", message: "failed" } }
          : { success: true, messageId: "fake-id" };
      } })
    });
    return app.handle(new Request(String(url), init));
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  warn.mockRestore();
  db.close();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("parses the nested Gateway profile and trims email/name", async () => {
  expect(await getBusinessProfile(lead.business_id)).toEqual({ id: lead.business_id, name: "Salon", owner_email: "owner@example.test" });
  expect(requests[0].url).toBe("http://gateway.test/api/businesses/biz_persisted");
  expect(requests[0].init?.method).toBe("GET");
});

test("combined new-lead contract stores exactly one alert and sends one email", async () => {
  await notifyLeadEvent("new_lead", lead);
  expect(requests).toHaveLength(2);
  expect(requests[1].init?.method).toBe("POST");
  expect(new URL(requests[1].url).pathname).toBe("/api/notifications/email");
  expect(JSON.parse(String(requests[1].init?.body))).toEqual({
    type: "new_lead", business_id: lead.business_id, lead_id: lead.id,
    messenger_id: lead.messenger_id, platform: "web", score: 75, status: "new",
    service_interest: "Styling", template: "new_lead", recipient_email: "owner@example.test",
    data: { lead_id: lead.id, business_name: "Salon", service_interest: "Styling", platform: "web", score: 75 }
  });
  const alerts = listNotifications(db, lead.business_id);
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatchObject({ title: "New lead", action_url: `/leads/${lead.id}`, metadata: { messenger_id: lead.messenger_id, status: "new" } });
  expect(messages).toHaveLength(1);
  expect(messages[0].recipientEmail).toBe("owner@example.test");
});

test.each([
  { ...profile.business, owner_email: null },
  { ...profile.business, owner_email: "invalid" },
  { id: lead.business_id, name: "Salon" },
  { ...profile.business, id: "wrong-business" },
  { ...profile.business, name: " " },
  null
])("invalid/missing profile falls back to one legacy alert: %j", async business => {
  gatewayResponse = () => Response.json({ success: true, business });
  await notifyLeadEvent("new_lead", lead);
  expect(requests).toHaveLength(2);
  expect(JSON.parse(String(requests[1].init?.body)).template).toBeUndefined();
  expect(listNotifications(db, lead.business_id)).toHaveLength(1);
  expect(messages).toHaveLength(0);
});

test.each(["network", "404", "invalid-json", "unsuccessful"])("Gateway %s falls back to legacy", async failure => {
  gatewayResponse = () => {
    if (failure === "network") throw new Error("offline");
    if (failure === "404") return new Response("missing", { status: 404 });
    if (failure === "invalid-json") return new Response("not json");
    return Response.json({ ...profile, success: false });
  };
  await notifyLeadEvent("new_lead", lead);
  expect(requests).toHaveLength(2);
  expect(listNotifications(db, lead.business_id)).toHaveLength(1);
  expect(messages).toHaveLength(0);
});

test.each(["network", "http"] as const)("Notification %s failure is swallowed without redispatch", async failure => {
  notificationFailure = failure;
  await expect(notifyLeadEvent("new_lead", lead)).resolves.toBeUndefined();
  expect(requests).toHaveLength(2);
});

test.each(["smtp", "disabled"])("%s email preserves one in-app alert without retry", async failure => {
  smtpFails = failure === "smtp";
  emailEnabled = failure !== "disabled";
  await expect(notifyLeadEvent("new_lead", lead)).resolves.toBeUndefined();
  expect(requests).toHaveLength(2);
  expect(listNotifications(db, lead.business_id)).toHaveLength(1);
  expect(messages).toHaveLength(emailEnabled ? 1 : 0);
});

test("escalation bypasses Gateway and remains in-app only", async () => {
  await notifyLeadEvent("escalated_lead", lead);
  expect(requests).toHaveLength(1);
  expect(JSON.parse(String(requests[0].init?.body)).template).toBeUndefined();
  expect(listNotifications(db, lead.business_id)[0].title).toBe("Lead escalated");
  expect(messages).toHaveLength(0);
});

test("new chat lead's two distinct events do not duplicate the new-lead alert", async () => {
  await Promise.all([notifyLeadEvent("new_lead", lead), notifyLeadEvent("escalated_lead", lead)]);
  expect(listNotifications(db, lead.business_id).map(alert => alert.title).sort()).toEqual(["Lead escalated", "New lead"]);
  expect(messages).toHaveLength(1);
});

test.each(["test", "disabled"])("%s caller makes no network calls", async mode => {
  if (mode === "test") process.env.NODE_ENV = "test";
  else process.env.NOTIFICATIONS_ENABLED = "false";
  await notifyLeadEvent("new_lead", lead);
  expect(requests).toHaveLength(0);
});
