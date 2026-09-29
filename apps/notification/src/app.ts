import type { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";
import {
  createEmailDelivery,
  markEmailDeliveryFailed,
  markEmailDeliverySent
} from "./email-delivery-store";
import type { EmailDeliveryResult } from "./email-provider";
import type { SendTemplatedEmailInput } from "./email/services";
import type {
  AppointmentConfirmedTemplateData,
  EmailTemplateInput,
  InvoiceIssuedTemplateData,
  InvoiceLineItemData,
  NewLeadTemplateData
} from "./email/templates";
import {
  countUnread,
  createNotification,
  listNotifications,
  markAllRead,
  markRead,
  type NotificationType
} from "./store";

interface TemplatedEmailSender {
  send(input: SendTemplatedEmailInput): Promise<EmailDeliveryResult>;
}

export interface NotificationAppDependencies {
  notificationsEnabled: boolean;
  emailService?: TemplatedEmailSender;
}

const DISABLED_DEPENDENCIES: NotificationAppDependencies = {
  notificationsEnabled: false
};

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  object: Record<string, unknown>,
  field: string
): { value: string } | { error: string } {
  const value = object[field];
  if (typeof value !== "string" || !value.trim()) return { error: `${field} is required` };
  return { value: value.trim() };
}

function optionalStringOrNull(
  object: Record<string, unknown>,
  field: string
): { value?: string | null } | { error: string } {
  const value = object[field];
  if (value === undefined) return {};
  if (value === null) return { value: null };
  if (typeof value !== "string") return { error: `${field} must be a string or null` };
  return { value: value.trim() };
}

function parseNewLeadData(data: Record<string, unknown>): NewLeadTemplateData | string {
  const leadId = requiredString(data, "lead_id");
  if ("error" in leadId) return leadId.error;
  const businessName = requiredString(data, "business_name");
  if ("error" in businessName) return businessName.error;
  const serviceInterest = optionalStringOrNull(data, "service_interest");
  if ("error" in serviceInterest) return serviceInterest.error;
  const platform = optionalStringOrNull(data, "platform");
  if ("error" in platform) return platform.error;
  const score = data.score;
  if (
    score !== undefined &&
    score !== null &&
    (typeof score !== "number" || !Number.isFinite(score))
  ) {
    return "score must be a number or null";
  }

  return {
    lead_id: leadId.value,
    business_name: businessName.value,
    ...(serviceInterest.value === undefined ? {} : { service_interest: serviceInterest.value }),
    ...(platform.value === undefined ? {} : { platform: platform.value }),
    ...(score === undefined ? {} : { score })
  };
}

function safeProviderFailure(result: Extract<EmailDeliveryResult, { success: false }>): string {
  switch (result.error.code) {
    case "INVALID_RECIPIENT":
      return "The recipient email address is invalid";
    case "SMTP_TIMEOUT":
      return "Email delivery timed out";
    case "SMTP_DELIVERY_FAILED":
      return "Email delivery failed";
  }
}

function parseAppointmentData(
  data: Record<string, unknown>
): AppointmentConfirmedTemplateData | string {
  const fields = [
    "appointment_id",
    "business_name",
    "customer_name",
    "service",
    "start_time",
    "end_time"
  ] as const;
  const values: Record<(typeof fields)[number], string> = {
    appointment_id: "",
    business_name: "",
    customer_name: "",
    service: "",
    start_time: "",
    end_time: ""
  };

  for (const field of fields) {
    const parsed = requiredString(data, field);
    if ("error" in parsed) return parsed.error;
    values[field] = parsed.value;
  }
  return values;
}

/** Line items are display-only, so anything malformed is dropped, not rejected. */
function parseInvoiceLineItems(value: unknown): InvoiceLineItemData[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    const quantity = typeof entry.quantity === "number" ? entry.quantity : 0;
    const amount = typeof entry.amount === "number" ? entry.amount : 0;
    if (!description) return [];
    return [{ description, quantity, amount }];
  });
}

function parseInvoiceData(data: Record<string, unknown>): InvoiceIssuedTemplateData | string {
  const fields = ["invoice_number", "business_name", "period_start", "period_end"] as const;
  const values: Record<(typeof fields)[number], string> = {
    invoice_number: "",
    business_name: "",
    period_start: "",
    period_end: ""
  };

  for (const field of fields) {
    const parsed = requiredString(data, field);
    if ("error" in parsed) return parsed.error;
    values[field] = parsed.value;
  }

  if (typeof data.total !== "number" || !Number.isFinite(data.total)) {
    return "total must be a number";
  }
  const currency = typeof data.currency === "string" && data.currency.trim() ? data.currency.trim() : "";
  if (!currency) return "currency is required";

  const dueDate = optionalStringOrNull(data, "due_date");
  if ("error" in dueDate) return dueDate.error;

  return {
    ...values,
    currency,
    total: data.total,
    ...(dueDate.value === undefined ? {} : { due_date: dueDate.value }),
    line_items: parseInvoiceLineItems(data.line_items)
  };
}

function parseTemplateInput(
  payload: Record<string, unknown>
): EmailTemplateInput | string {
  if (
    payload.template !== "new_lead" &&
    payload.template !== "appointment_confirmed" &&
    payload.template !== "invoice_issued"
  ) {
    return "template must be new_lead, appointment_confirmed or invoice_issued";
  }
  if (!isRecord(payload.data)) return "data is required";

  if (payload.template === "new_lead") {
    const data = parseNewLeadData(payload.data);
    return typeof data === "string" ? data : { template: "new_lead", data };
  }

  if (payload.template === "invoice_issued") {
    const data = parseInvoiceData(payload.data);
    return typeof data === "string" ? data : { template: "invoice_issued", data };
  }

  const data = parseAppointmentData(payload.data);
  return typeof data === "string" ? data : { template: "appointment_confirmed", data };
}

/** Lead-manager posts lead events here (services/notify.ts). */
function fromLeadEvent(body: Record<string, unknown>): {
  type: NotificationType;
  title: string;
  text: string;
  action_url: string | null;
} | null {
  const reason = typeof body.type === "string" ? body.type : "";
  const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
  const interest =
    typeof body.service_interest === "string" && body.service_interest.trim()
      ? body.service_interest.trim()
      : "";
  const score = typeof body.score === "number" ? body.score : null;
  const platform = typeof body.platform === "string" ? body.platform : "a channel";
  const action_url = leadId ? `/leads/${leadId}` : "/leads";

  if (reason === "new_lead") {
    const scoreLabel = score === null ? "" : ` · score ${score}`;
    return {
      type: "lead",
      title: "New lead",
      text: `${interest || "A new enquiry"} via ${platform}${scoreLabel}`,
      action_url
    };
  }

  if (reason === "escalated_lead") {
    return {
      type: "lead",
      title: "Lead escalated",
      text: `${interest || "A conversation"} on ${platform} needs an agent`,
      action_url
    };
  }

  return null;
}

export function createApp(
  db: Database,
  dependencies: NotificationAppDependencies = DISABLED_DEPENDENCIES
) {
  return (
    new Elysia()
      .get("/health", () => ({ status: "ok", service: "notification" }))

      .post(
        "/api/notifications/email",
        async ({ body, set }) => {
          const payload = isRecord(body) ? body : {};
          const business_id =
            typeof payload.business_id === "string" ? payload.business_id.trim() : "";

          if (!business_id) {
            set.status = 400;
            return { success: false, error: "business_id is required" };
          }

          const emailRequest =
            "template" in payload || "recipient_email" in payload || "data" in payload;
          let templateInput: EmailTemplateInput | null = null;
          let recipientEmail = "";

          if (emailRequest) {
            recipientEmail =
              typeof payload.recipient_email === "string" ? payload.recipient_email.trim() : "";
            if (!recipientEmail) {
              set.status = 400;
              return { success: false, email_sent: false, error: "recipient_email is required" };
            }
            if (!EMAIL_ADDRESS.test(recipientEmail)) {
              set.status = 400;
              return { success: false, email_sent: false, error: "recipient_email is invalid" };
            }

            const parsed = parseTemplateInput(payload);
            if (typeof parsed === "string") {
              set.status = 400;
              return { success: false, email_sent: false, error: parsed };
            }
            templateInput = parsed;
          }

          const eventPayload =
            templateInput?.template === "new_lead" && typeof payload.type !== "string"
              ? { ...payload, ...templateInput.data, type: "new_lead" }
              : payload;
          const event = fromLeadEvent(eventPayload);
          if (!event) {
            if (
              templateInput?.template === "appointment_confirmed" ||
              templateInput?.template === "invoice_issued"
            ) {
              // Neither appointment nor invoice emails create lead-shaped
              // in-app notifications; they are delivered as email only.
            } else {
              set.status = 202;
              return {
                success: true,
                stored: false,
                email_sent: false,
                message: "Unrecognised event type — nothing stored."
              };
            }
          }

          const notification = event
            ? createNotification(db, {
                business_id,
                type: event.type,
                title: event.title,
                body: event.text,
                action_url: event.action_url,
                metadata: {
                  lead_id: eventPayload.lead_id ?? null,
                  messenger_id: eventPayload.messenger_id ?? null,
                  platform: eventPayload.platform ?? null,
                  score: eventPayload.score ?? null,
                  status: eventPayload.status ?? null
                }
              })
            : null;

          if (!templateInput) {
            set.status = 201;
            return {
              success: true,
              stored: true,
              email_sent: false,
              message: "Stored as an in-app notification. Email delivery is not implemented.",
              notification
            };
          }

          if (!dependencies.notificationsEnabled || !dependencies.emailService) {
            set.status = 503;
            return {
              success: false,
              stored: notification !== null,
              email_sent: false,
              error: "Email notifications are disabled",
              notification
            };
          }

          let delivery;
          try {
            delivery = createEmailDelivery(db, {
              business_id,
              recipient_email: recipientEmail,
              template: templateInput.template,
              payload: templateInput.data
            });
          } catch {
            set.status = 500;
            return {
              success: false,
              stored: notification !== null,
              email_sent: false,
              error: "Email delivery could not be recorded",
              notification
            };
          }

          try {
            const result = await dependencies.emailService.send({
              recipient_email: recipientEmail,
              ...templateInput
            });

            if (!result.success) {
              const failureReason = safeProviderFailure(result);
              const failedDelivery = markEmailDeliveryFailed(db, {
                id: delivery.id,
                business_id,
                failure_reason: failureReason
              });
              set.status = 502;
              return {
                success: false,
                stored: notification !== null,
                email_sent: false,
                error: result.error.code,
                message: failureReason,
                notification,
                delivery: failedDelivery
              };
            }

            try {
              const sentDelivery = markEmailDeliverySent(db, {
                id: delivery.id,
                business_id,
                provider_message_id: result.messageId
              });
              if (!sentDelivery) throw new Error("Delivery record not found");

              set.status = 201;
              return {
                success: true,
                stored: notification !== null,
                email_sent: true,
                notification,
                delivery: sentDelivery
              };
            } catch {
              console.error("[notification] email sent but final delivery state was not recorded");
              set.status = 500;
              return {
                success: false,
                stored: notification !== null,
                email_sent: true,
                error: "Email sent but delivery state was not recorded",
                notification,
                delivery
              };
            }
          } catch {
            try {
              const failedDelivery = markEmailDeliveryFailed(db, {
                id: delivery.id,
                business_id,
                failure_reason: "Email delivery failed"
              });
              set.status = 502;
              return {
                success: false,
                stored: notification !== null,
                email_sent: false,
                error: "SMTP_DELIVERY_FAILED",
                message: "Email delivery failed",
                notification,
                delivery: failedDelivery
              };
            } catch {
              console.error("[notification] email delivery failure state was not recorded");
              set.status = 500;
              return {
                success: false,
                stored: notification !== null,
                email_sent: false,
                error: "Email delivery state could not be recorded",
                notification,
                delivery
              };
            }
          }
        },
        { body: t.Any() }
      )

      .get(
        "/api/businesses/:businessId/notifications",
        ({ params, query }) => {
          const unread =
            query.unread === undefined ? undefined : query.unread === "true" || query.unread === "1";

          const notifications = listNotifications(db, params.businessId, {
            unread,
            type: typeof query.type === "string" && query.type ? query.type : undefined,
            limit: query.limit ? Number(query.limit) : undefined
          });

          return {
            success: true,
            notifications,
            unread_count: countUnread(db, params.businessId)
          };
        },
        {
          query: t.Object({
            unread: t.Optional(t.String()),
            type: t.Optional(t.String()),
            limit: t.Optional(t.String())
          })
        }
      )

      .patch("/api/businesses/:businessId/notifications/:id/read", ({ params, set }) => {
        const notification = markRead(db, params.businessId, params.id);
        if (!notification) {
          set.status = 404;
          return { success: false, error: "Notification not found" };
        }
        return {
          success: true,
          notification,
          unread_count: countUnread(db, params.businessId)
        };
      })

      .post("/api/businesses/:businessId/notifications/read-all", ({ params }) => ({
        success: true,
        marked_read: markAllRead(db, params.businessId),
        unread_count: 0
      }))
  );
}
