import { describe, expect, test } from "bun:test";
import type { SmtpConfig } from "../config";
import type { EmailMessage } from "../email-provider";
import {
  SmtpEmailProvider,
  type SmtpTransport
} from "../email/providers/smtp-email-provider";

const smtpConfig: SmtpConfig = {
  host: "smtp.example.test",
  port: 2525,
  user: "fake-user",
  pass: "fake-password",
  from: "Notifications <notifications@example.test>"
};

const message: EmailMessage = {
  recipientEmail: " owner@example.com ",
  subject: "New lead received",
  text: "A new lead was created.",
  html: "<p>A new lead was created.</p>"
};

class FakeTransport implements SmtpTransport {
  calls: Parameters<SmtpTransport["sendMail"]>[0][] = [];

  constructor(
    private readonly response: { messageId?: string } | Error = { messageId: "provider-id-123" }
  ) {}

  async sendMail(options: Parameters<SmtpTransport["sendMail"]>[0]) {
    this.calls.push(options);
    if (this.response instanceof Error) throw this.response;
    return this.response;
  }
}

describe("SMTP email provider", () => {
  test("returns success and the provider message ID", async () => {
    const provider = new SmtpEmailProvider(smtpConfig, new FakeTransport());

    expect(await provider.sendEmail(message)).toEqual({
      success: true,
      messageId: "provider-id-123"
    });
  });

  test("rejects an invalid recipient without invoking the transport", async () => {
    const transport = new FakeTransport();
    const provider = new SmtpEmailProvider(smtpConfig, transport);

    expect(await provider.sendEmail({ ...message, recipientEmail: "not-an-email" })).toEqual({
      success: false,
      error: {
        code: "INVALID_RECIPIENT",
        message: "The recipient email address is invalid"
      }
    });
    expect(transport.calls).toHaveLength(0);
  });

  test("maps authentication failures safely", async () => {
    const authenticationError = Object.assign(new Error("535 fake-password rejected"), {
      code: "EAUTH"
    });
    const provider = new SmtpEmailProvider(smtpConfig, new FakeTransport(authenticationError));
    const result = await provider.sendEmail(message);

    expect(result).toEqual({
      success: false,
      error: { code: "SMTP_DELIVERY_FAILED", message: "Email delivery failed" }
    });
    expect(JSON.stringify(result)).not.toContain(smtpConfig.user);
    expect(JSON.stringify(result)).not.toContain(smtpConfig.pass);
  });

  test("maps timeout errors safely", async () => {
    const timeout = Object.assign(new Error("connection exposed fake-password"), {
      code: "ETIMEDOUT"
    });
    const provider = new SmtpEmailProvider(smtpConfig, new FakeTransport(timeout));
    const result = await provider.sendEmail(message);

    expect(result).toEqual({
      success: false,
      error: { code: "SMTP_TIMEOUT", message: "Email delivery timed out" }
    });
    expect(JSON.stringify(result)).not.toContain(smtpConfig.pass);
  });

  test("maps generic failures safely without exposing SMTP credentials", async () => {
    const provider = new SmtpEmailProvider(
      smtpConfig,
      new FakeTransport(new Error(`Authentication failed for ${smtpConfig.pass}`))
    );
    const result = await provider.sendEmail(message);

    expect(result).toEqual({
      success: false,
      error: { code: "SMTP_DELIVERY_FAILED", message: "Email delivery failed" }
    });
    expect(JSON.stringify(result)).not.toContain(smtpConfig.user);
    expect(JSON.stringify(result)).not.toContain(smtpConfig.pass);
  });

  test("allows the HTML body to be omitted", async () => {
    const transport = new FakeTransport();
    const provider = new SmtpEmailProvider(smtpConfig, transport);

    await provider.sendEmail({
      recipientEmail: "owner@example.com",
      subject: "Plain text",
      text: "Plain-text body"
    });

    expect(transport.calls[0]).not.toHaveProperty("html");
  });

  test("passes the configured sender and prepared message to the transport", async () => {
    const transport = new FakeTransport();
    const provider = new SmtpEmailProvider(smtpConfig, transport);

    await provider.sendEmail(message);

    expect(transport.calls).toEqual([
      {
        from: smtpConfig.from,
        to: "owner@example.com",
        subject: message.subject,
        text: message.text,
        html: message.html
      }
    ]);
  });
});
