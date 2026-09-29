/**
 * Emails an invoice to a business owner through the notification service,
 * which owns the SMTP credentials and the delivery log.
 *
 * Delivery is best-effort on purpose. SMTP is optional in this deployment, so
 * "the email did not go out" must not mean "the invoice was never issued" —
 * the owner can always read the bill in their own dashboard. The caller gets
 * the failure reason back and stores it on the invoice so an admin can see
 * exactly why nothing arrived.
 */

import type { InvoiceWithLines } from "./BillingService";

const NOTIFICATION_SERVICE_URL = (
  process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3004"
).replace(/\/$/, "");
const TIMEOUT_MS = 8000;

export interface InvoiceEmailResult {
  sent: boolean;
  error?: string;
}

function money(amount: number, currency: string): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export async function sendInvoiceEmail(
  invoice: InvoiceWithLines,
  options: { businessName: string; recipientEmail: string }
): Promise<InvoiceEmailResult> {
  const recipient = options.recipientEmail.trim();
  if (!recipient) {
    return { sent: false, error: "This business has no owner email address on file" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${NOTIFICATION_SERVICE_URL}/api/notifications/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        business_id: invoice.business_id,
        recipient_email: recipient,
        template: "invoice_issued",
        data: {
          invoice_number: invoice.number,
          business_name: options.businessName,
          period_start: invoice.period_start,
          period_end: invoice.period_end,
          currency: invoice.currency,
          total: invoice.total,
          due_date: invoice.due_date,
          line_items: invoice.line_items.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            amount: line.amount
          }))
        }
      })
    });

    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; email_sent?: boolean; error?: string; message?: string }
      | null;

    // `email_sent` is the authoritative signal, not the status code. The
    // notification service answers 500 when the mail went out but recording it
    // afterwards failed; reading that as "not sent" would have an admin resend
    // and bill the customer's inbox twice.
    if (body?.email_sent) return { sent: true };

    if (res.status === 503) {
      return {
        sent: false,
        error:
          "Email delivery is not configured on this deployment, so nothing was emailed. " +
          "The invoice is visible to the owner in their dashboard."
      };
    }

    // `message` is the human-readable reason; `error` is a provider code like
    // SMTP_DELIVERY_FAILED. Admins read this text, so prefer the sentence.
    return {
      sent: false,
      error: body?.message || body?.error || `Notification service responded ${res.status}`
    };
  } catch (err) {
    return {
      sent: false,
      error: `Notification service unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Plain-text rendering used by the admin's "preview" and by tests. */
export function renderInvoiceText(invoice: InvoiceWithLines, businessName: string): string {
  const lines = [
    `Invoice ${invoice.number}`,
    `For: ${businessName}`,
    `Period: ${invoice.period_start} to ${invoice.period_end}`,
    invoice.due_date ? `Due: ${invoice.due_date}` : "",
    "",
    ...invoice.line_items.map(
      (line) =>
        `${line.description} — ${line.quantity} × ${money(line.unit_price, invoice.currency)} = ${money(
          line.amount,
          invoice.currency
        )}`
    ),
    "",
    `Subtotal: ${money(invoice.subtotal, invoice.currency)}`,
    invoice.tax_percent > 0
      ? `Tax (${invoice.tax_percent}%): ${money(invoice.tax, invoice.currency)}`
      : "",
    `Total: ${money(invoice.total, invoice.currency)}`,
    invoice.notes ? `\n${invoice.notes}` : ""
  ];

  return lines.filter((line) => line !== "").join("\n");
}
