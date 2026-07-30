import { Elysia, t } from "elysia";
import { upsertLeadFromMessage } from "../services/leads";
import { notifyLeadEvent } from "../services/notify";
import type { ChatResponse } from "../types";

const DEFAULT_BUSINESS_ID = process.env.DEFAULT_BUSINESS_ID ?? "biz_demo_salon";

/**
 * POST /chat — called by the Routing service for the `lead_qualification`
 * intent. We capture/enrich the lead from the message and hand the customer to
 * a human (escalated: true). The routing body carries no business_id yet, so we
 * resolve it from body.business_id then fall back to DEFAULT_BUSINESS_ID.
 */
export const chatRoutes = new Elysia().post(
  "/chat",
  ({ body, headers }): ChatResponse => {
    const requestId =
      body.request_id ??
      (typeof headers["x-request-id"] === "string" && headers["x-request-id"]
        ? headers["x-request-id"]
        : crypto.randomUUID());

    const businessId = body.business_id ?? DEFAULT_BUSINESS_ID;
    const platform = body.platform ?? "web";

    try {
      const lead = upsertLeadFromMessage({
        business_id: businessId,
        messenger_id: body.messenger_id,
        platform,
        message: body.message
      });

      void notifyLeadEvent("escalated_lead", lead);

      return {
        success: true,
        messages: [
          {
            type: "text",
            text: "Thanks for reaching out! I've noted your details and a team member will follow up with you shortly."
          }
        ],
        escalated: true,
        leadId: lead.id,
        leadScore: lead.score
      };
    } catch (err) {
      console.error(
        `[REQ-${requestId}] ${new Date().toISOString()} CHAT_ERROR`,
        err instanceof Error ? err.message : err
      );
      return {
        success: false,
        messages: [{ type: "text", text: "Let me connect you with a team member." }],
        escalated: true,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  },
  {
    body: t.Object({
      message: t.String({ minLength: 1, error: "message must be a non-empty string" }),
      messenger_id: t.String({ minLength: 1, error: "messenger_id is required" }),
      request_id: t.Optional(t.String()),
      platform: t.Optional(t.String()),
      business_id: t.Optional(t.String()),
      language: t.Optional(t.String()),
      language_tag: t.Optional(t.String()),
      platform_capabilities: t.Optional(
        t.Object({
          quick_replies: t.Boolean(),
          url_buttons: t.Boolean(),
          lists: t.Boolean(),
          max_quick_replies: t.Union([t.Number(), t.Null()])
        })
      )
    })
  }
);
