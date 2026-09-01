import type { EmailDeliveryResult, EmailProvider } from "../../email-provider";
import {
  renderEmailTemplate,
  type EmailTemplateInput
} from "../templates";

export type SendTemplatedEmailInput = EmailTemplateInput & {
  recipient_email: string;
};

export class TemplatedEmailService {
  constructor(private readonly emailProvider: EmailProvider) {}

  async send(input: SendTemplatedEmailInput): Promise<EmailDeliveryResult> {
    const rendered = renderEmailTemplate(input);

    return this.emailProvider.sendEmail({
      recipientEmail: input.recipient_email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html
    });
  }
}
