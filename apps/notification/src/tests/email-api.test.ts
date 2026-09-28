import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createApp } from "../app";
import { createDatabase, initializeDatabase } from "../db";
import type { EmailDeliveryResult, EmailMessage, EmailProvider } from "../email-provider";
import { TemplatedEmailService } from "../email/services";

class FakeEmailProvider implements EmailProvider {
  readonly messages: EmailMessage[] = [];
  statusesAtSend: string[] = [];

  constructor(
    private readonly db: Database,
    private readonly result: EmailDeliveryResult
  ) {}

  async sendEmail(message: EmailMessage): Promise<EmailDeliveryResult> {
    this.messages.push(message);
    const row = this.db
      .query("SELECT status FROM email_deliveries ORDER BY created_at DESC, id DESC LIMIT 1")
      .get() as { status: string } | null;
    this.statusesAtSend.push(row?.status ?? "missing");
    return this.result;
  }
}

function post(app: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
  return app.handle(
    new Request("http://localhost/api/notifications/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

const newLeadRequest = {
  business_id: "biz_test",
  recipient_email: "owner@example.test",
  template: "new_lead",
  data: {
    lead_id: "lead_test",
    business_name: "Test Salon",
    service_interest: "Hair styling",
    platform: "web",
    score: 75
  }
};

const appointmentRequest = {
  business_id: "biz_test",
  recipient_email: "appointments@example.test",
  template: "appointment_confirmed",
  data: {
    appointment_id: "appointment_test",
    business_name: "Test Salon",
    customer_name: "Test Customer",
    service: "Hair styling",
    start_time: "2026-09-06T09:00:00+05:30",
    end_time: "2026-09-06T10:00:00+05:30"
  }
};

describe("notification email API", () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase(":memory:");
    initializeDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  test("sends a rendered new-lead email after creating a pending delivery", async () => {
    const provider = new FakeEmailProvider(db, {
      success: true,
      messageId: "provider-new-lead"
    });
    const app = createApp(db, {
      notificationsEnabled: true,
      emailService: new TemplatedEmailService(provider)
    });

    const response = await post(app, newLeadRequest);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(provider.statusesAtSend).toEqual(["pending"]);
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]).toMatchObject({
      recipientEmail: "owner@example.test",
      subject: "New lead received"
    });
    expect(provider.messages[0]?.text).toContain("Lead ID: lead_test");
    expect(provider.messages[0]?.html).toContain("A new lead has been received for Test Salon.");
    expect(body.success).toBe(true);
    expect(body.stored).toBe(true);
    expect(body.email_sent).toBe(true);
    expect(body.delivery).toMatchObject({
      business_id: "biz_test",
      status: "sent",
      provider_message_id: "provider-new-lead",
      attempt_count: 1
    });
    expect(body.delivery.sent_at).toBeString();
  });

  test("sends a rendered appointment-confirmation email", async () => {
    const provider = new FakeEmailProvider(db, {
      success: true,
      messageId: "provider-appointment"
    });
    const app = createApp(db, {
      notificationsEnabled: true,
      emailService: new TemplatedEmailService(provider)
    });

    const response = await post(app, appointmentRequest);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]).toMatchObject({
      recipientEmail: "appointments@example.test",
      subject: "Appointment confirmed"
    });
    expect(provider.messages[0]?.text).toContain("Appointment ID: appointment_test");
    expect(provider.messages[0]?.html).toContain("Test Customer");
    expect(body.stored).toBe(false);
    expect(body.delivery.status).toBe("sent");
  });

  test("records a safe provider failure without exposing raw error details", async () => {
    const provider = new FakeEmailProvider(db, {
      success: false,
      error: { code: "SMTP_DELIVERY_FAILED", message: "raw smtp detail with a credential" }
    });
    const app = createApp(db, {
      notificationsEnabled: true,
      emailService: new TemplatedEmailService(provider)
    });

    const response = await post(app, newLeadRequest);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(provider.messages).toHaveLength(1);
    expect(body).toMatchObject({
      success: false,
      email_sent: false,
      error: "SMTP_DELIVERY_FAILED",
      message: "Email delivery failed"
    });
    expect(body.delivery).toMatchObject({
      status: "failed",
      failure_reason: "Email delivery failed",
      provider_message_id: null,
      attempt_count: 1,
      sent_at: null
    });
    expect(JSON.stringify(body)).not.toContain("raw smtp detail");
  });

  test.each([
    [null, "business_id is required"],
    [{ ...newLeadRequest, recipient_email: "invalid" }, "recipient_email is invalid"],
    [{ ...newLeadRequest, recipient_email: undefined }, "recipient_email is required"],
    [{ ...newLeadRequest, business_id: undefined }, "business_id is required"],
    [{ ...newLeadRequest, template: "password_reset" }, "template must be"],
    [{ ...newLeadRequest, data: undefined }, "data is required"],
    [
      { ...newLeadRequest, data: { ...newLeadRequest.data, lead_id: undefined } },
      "lead_id is required"
    ],
    [
      {
        ...appointmentRequest,
        data: { ...appointmentRequest.data, start_time: undefined }
      },
      "start_time is required"
    ]
  ])("rejects invalid requests without sending or creating a delivery", async (request, error) => {
    const provider = new FakeEmailProvider(db, {
      success: true,
      messageId: "must-not-send"
    });
    const app = createApp(db, {
      notificationsEnabled: true,
      emailService: new TemplatedEmailService(provider)
    });

    const response = await post(app, request);
    const body = await response.json();
    const count = db.query("SELECT COUNT(*) AS count FROM email_deliveries").get() as {
      count: number;
    };

    expect(response.status).toBe(400);
    expect(body.error).toContain(error);
    expect(provider.messages).toHaveLength(0);
    expect(count.count).toBe(0);
  });

  test("does not create or send a delivery when notifications are disabled", async () => {
    const provider = new FakeEmailProvider(db, {
      success: true,
      messageId: "must-not-send"
    });
    const app = createApp(db, {
      notificationsEnabled: false,
      emailService: new TemplatedEmailService(provider)
    });

    const response = await post(app, appointmentRequest);
    const body = await response.json();
    const count = db.query("SELECT COUNT(*) AS count FROM email_deliveries").get() as {
      count: number;
    };

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      success: false,
      stored: false,
      email_sent: false,
      error: "Email notifications are disabled"
    });
    expect(provider.messages).toHaveLength(0);
    expect(count.count).toBe(0);
  });
});
