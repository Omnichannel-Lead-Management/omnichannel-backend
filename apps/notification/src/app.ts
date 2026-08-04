import type { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";
import {
  countUnread,
  createNotification,
  listNotifications,
  markAllRead,
  markRead,
  type NotificationType
} from "./store";

/**
 * Lead-manager posts lead events here (services/notify.ts). Map them onto the
 * in-app notification shape the dashboard renders. action_url must stay within
 * the dashboard's allow-listed routes or the client drops it.
 */
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

// The return type is inferred: annotating it `: Elysia` erases the route table
// and trips Elysia's generic variance check.
export function createApp(db: Database) {
  return (
    new Elysia()
      .get("/health", () => ({ status: "ok", service: "notification" }))

      /**
       * Kept at the original path so lead-manager needs no change. The event is
       * now persisted as an in-app notification. Email delivery itself is still
       * not implemented — the response says so rather than implying a send.
       */
      .post(
        "/api/notifications/email",
        ({ body, set }) => {
          const payload = (body ?? {}) as Record<string, unknown>;
          const business_id =
            typeof payload.business_id === "string" ? payload.business_id.trim() : "";

          if (!business_id) {
            set.status = 400;
            return { success: false, error: "business_id is required" };
          }

          const event = fromLeadEvent(payload);
          if (!event) {
            set.status = 202;
            return {
              success: true,
              stored: false,
              email_sent: false,
              message: "Unrecognised event type — nothing stored."
            };
          }

          const notification = createNotification(db, {
            business_id,
            type: event.type,
            title: event.title,
            body: event.text,
            action_url: event.action_url,
            metadata: {
              lead_id: payload.lead_id ?? null,
              messenger_id: payload.messenger_id ?? null,
              platform: payload.platform ?? null,
              score: payload.score ?? null,
              status: payload.status ?? null
            }
          });

          set.status = 201;
          return {
            success: true,
            stored: true,
            email_sent: false,
            message: "Stored as an in-app notification. Email delivery is not implemented.",
            notification
          };
        },
        { body: t.Any() }
      )

      // ── In-app notification centre (proxied by the gateway) ──
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
