import nodemailer from "nodemailer";
import type { SmtpConfig } from "../../config";
import type {
  EmailDeliveryResult,
  EmailMessage,
  EmailProvider
} from "../../email-provider";

export interface SmtpMailOptions {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SmtpTransport {
  sendMail(options: SmtpMailOptions): Promise<{ messageId?: string }>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function failure(
  code: "INVALID_RECIPIENT" | "SMTP_TIMEOUT" | "SMTP_DELIVERY_FAILED"
): EmailDeliveryResult {
  const messages = {
    INVALID_RECIPIENT: "The recipient email address is invalid",
    SMTP_TIMEOUT: "Email delivery timed out",
    SMTP_DELIVERY_FAILED: "Email delivery failed"
  } as const;

  return { success: false, error: { code, message: messages[code] } };
}

function providerErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String(error.code).toUpperCase();
}

export function createSmtpTransport(config: SmtpConfig): SmtpTransport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: DEFAULT_TIMEOUT_MS,
    greetingTimeout: DEFAULT_TIMEOUT_MS,
    socketTimeout: DEFAULT_TIMEOUT_MS
  });
}

export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: SmtpTransport;

  constructor(
    private readonly config: SmtpConfig,
    transport?: SmtpTransport,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS
  ) {
    this.transport = transport ?? createSmtpTransport(config);
  }

  async sendEmail(message: EmailMessage): Promise<EmailDeliveryResult> {
    const recipientEmail = message.recipientEmail.trim();
    if (!EMAIL_ADDRESS.test(recipientEmail)) return failure("INVALID_RECIPIENT");

    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const delivery = await Promise.race([
        this.transport.sendMail({
          from: this.config.from,
          to: recipientEmail,
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html })
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject({ code: "ETIMEDOUT" }), this.timeoutMs);
        })
      ]);

      return { success: true, messageId: delivery.messageId ?? "" };
    } catch (error) {
      const code = providerErrorCode(error);
      const timedOut = code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT";

      // Authentication and other provider failures deliberately share one
      // generic result so raw SMTP details and credentials cannot escape.
      return failure(timedOut ? "SMTP_TIMEOUT" : "SMTP_DELIVERY_FAILED");
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
