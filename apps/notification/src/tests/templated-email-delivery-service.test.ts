import { describe, expect, test } from "bun:test";
import type {
  EmailDeliveryResult,
  EmailMessage,
  EmailProvider
} from "../email-provider";
import {
  TemplatedEmailService,
  type SendTemplatedEmailInput
} from "../email/services";

class FakeEmailProvider implements EmailProvider {
  readonly messages: EmailMessage[] = [];

  constructor(private readonly result: EmailDeliveryResult) {}

  async sendEmail(message: EmailMessage): Promise<EmailDeliveryResult> {
    this.messages.push(message);
    return this.result;
  }
}

const successResult: EmailDeliveryResult = {
  success: true,
  messageId: "provider-message-123"
};

describe("templated email delivery service", () => {
  test("renders new-lead data and sends the expected provider message once", async () => {
    const provider = new FakeEmailProvider(successResult);
    const service = new TemplatedEmailService(provider);

    await service.send({
      recipient_email: "owner@example.com",
      template: "new_lead",
      data: {
        lead_id: "lead_123",
        business_name: "Pathirana Salon",
        service_interest: "Bridal package",
        platform: "telegram",
        score: 82
      }
    });

    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]).toMatchObject({ recipientEmail: "owner@example.com", subject: "New lead received" });
    expect(provider.messages[0]?.text).toContain("Service interest: Bridal package");
    expect(provider.messages[0]?.text).toContain("Lead score: 82");
    expect(provider.messages[0]?.html).toContain("You have a new lead</h1>");
    expect(provider.messages[0]?.html).toContain("Pathirana Salon");
  });

  test("renders appointment data and forwards recipient, subject, text, and HTML", async () => {
    const provider = new FakeEmailProvider(successResult);
    const service = new TemplatedEmailService(provider);

    await service.send({
      recipient_email: "appointments@example.com",
      template: "appointment_confirmed",
      data: {
        appointment_id: "apt_123",
        business_name: "Pathirana Salon",
        customer_name: "Amaya Silva",
        service: "Hair styling",
        start_time: "2026-09-03T09:00:00+05:30",
        end_time: "2026-09-03T10:00:00+05:30"
      }
    });

    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]?.recipientEmail).toBe("appointments@example.com");
    expect(provider.messages[0]?.subject).toBe("Appointment confirmed");
    expect(provider.messages[0]?.text).toContain("Appointment ID: apt_123");
    expect(provider.messages[0]?.text).toContain("Customer: Amaya Silva");
    expect(provider.messages[0]?.html).toContain("Hair styling");
    expect(provider.messages[0]?.html).toContain("Appointment confirmed</h1>");
  });

  test("returns the provider success result unchanged", async () => {
    const provider = new FakeEmailProvider(successResult);
    const service = new TemplatedEmailService(provider);
    const result = await service.send({
      recipient_email: "owner@example.com",
      template: "new_lead",
      data: { lead_id: "lead_456", business_name: "Pathirana Salon" }
    });

    expect(result).toBe(successResult);
  });

  test("returns the provider failure result unchanged", async () => {
    const failureResult: EmailDeliveryResult = {
      success: false,
      error: { code: "SMTP_TIMEOUT", message: "Email delivery timed out" }
    };
    const provider = new FakeEmailProvider(failureResult);
    const service = new TemplatedEmailService(provider);
    const result = await service.send({
      recipient_email: "owner@example.com",
      template: "new_lead",
      data: { lead_id: "lead_789", business_name: "Pathirana Salon" }
    });

    expect(result).toBe(failureResult);
    expect(provider.messages).toHaveLength(1);
  });

  test("preserves escaped template HTML", async () => {
    const provider = new FakeEmailProvider(successResult);
    const service = new TemplatedEmailService(provider);
    const script = `<script>alert("x")</script>`;

    await service.send({
      recipient_email: "owner@example.com",
      template: "new_lead",
      data: { lead_id: "lead_999", business_name: script }
    });

    expect(provider.messages[0]?.html).not.toContain("<script>");
    expect(provider.messages[0]?.html).toContain(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  test("does not mutate its input", async () => {
    const provider = new FakeEmailProvider(successResult);
    const service = new TemplatedEmailService(provider);
    const input: SendTemplatedEmailInput = {
      recipient_email: "owner@example.com",
      template: "new_lead",
      data: {
        lead_id: "lead_abc",
        business_name: "A & B",
        service_interest: null,
        platform: "web",
        score: 0
      }
    };
    const before = structuredClone(input);

    await service.send(input);

    expect(input).toEqual(before);
    expect(provider.messages[0]?.text).not.toContain("Service interest:");
    expect(provider.messages[0]?.html).not.toContain("null");
  });
});
