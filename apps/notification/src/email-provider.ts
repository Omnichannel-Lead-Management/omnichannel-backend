export interface EmailMessage {
  recipientEmail: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailDeliveryResult =
  | { success: true; messageId: string }
  | {
      success: false;
      error: {
        code: "INVALID_RECIPIENT" | "SMTP_TIMEOUT" | "SMTP_DELIVERY_FAILED";
        message: string;
      };
    };

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<EmailDeliveryResult>;
}
