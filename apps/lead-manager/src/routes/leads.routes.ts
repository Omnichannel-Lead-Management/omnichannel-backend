import { Elysia, t } from "elysia";
import type { Lead } from "../db/schema";
import {
  createLead,
  findLeadByMessenger,
  getLead,
  getActivities,
  listLeads,
  updateLead,
  pickAgent,
  parseTags
} from "../services/leads";
import { subscribe } from "../services/events";
import type { LeadStatus } from "../types";

const statusSchema = t.Union([
  t.Literal("new"),
  t.Literal("contacted"),
  t.Literal("qualified"),
  t.Literal("converted"),
  t.Literal("lost")
]);

/** Convert a DB row into the API shape (tags parsed to an array). */
function toDto(lead: Lead) {
  const { tags: _tags, ...rest } = lead;
  return { ...rest, tags: parseTags(lead) };
}

export const leadsRoutes = new Elysia({ prefix: "/api/leads" })
  .post(
    "/",
    ({ body, set }) => {
      // A lead is a person, not a message. The chatbot now captures on every
      // enquiry it answers, so without this one customer asking three
      // questions would become three leads.
      const existing = findLeadByMessenger(body.business_id, body.messenger_id);
      if (existing) {
        set.status = 200;
        return { success: true, lead: toDto(existing), deduplicated: true };
      }

      const lead = createLead(body);
      set.status = 201;
      return { success: true, lead: toDto(lead) };
    },
    {
      body: t.Object({
        business_id: t.String({ minLength: 1, error: "business_id is required" }),
        messenger_id: t.String({ minLength: 1, error: "messenger_id is required" }),
        platform: t.String({ minLength: 1, error: "platform is required" }),
        source: t.String({ minLength: 1, error: "source is required" }),
        channel_source: t.Optional(t.String()),
        service_interest: t.Optional(t.String()),
        budget_range: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        notes: t.Optional(t.String()),
        assigned_agent_id: t.Optional(t.String()),
        premium_interest: t.Optional(t.Boolean()),
        appointment_booked: t.Optional(t.Boolean()),
        autoAssign: t.Optional(t.Boolean())
      })
    }
  )

  .get(
    "/stream",
    ({ query }) => {
      const businessId = query.businessId;
      const encoder = new TextEncoder();
      let unsubscribe: () => void = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(`event: connected\ndata: ${JSON.stringify({ businessId })}\n\n`)
          );
          unsubscribe = subscribe(businessId, (event) => {
            try {
              controller.enqueue(
                encoder.encode(
                  `event: ${event.type}\ndata: ${JSON.stringify(toDto(event.lead))}\n\n`
                )
              );
            } catch {
            }
          });
          heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: ping\n\n`));
            } catch {
            }
          }, 25000);
        },
        cancel() {
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe();
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        }
      });
    },
    {
      query: t.Object({
        businessId: t.String({ minLength: 1, error: "businessId query param is required" })
      })
    }
  )

  .get(
    "/",
    ({ query }) => {
      const items = listLeads({
        businessId: query.businessId,
        status: query.status as LeadStatus | undefined,
        assignedAgentId: query.assignedAgentId
      });
      return { success: true, count: items.length, leads: items.map(toDto) };
    },
    {
      query: t.Object({
        businessId: t.String({ minLength: 1, error: "businessId query param is required" }),
        status: t.Optional(statusSchema),
        assignedAgentId: t.Optional(t.String())
      })
    }
  )

  .get(
    "/:id",
    ({ params, query, set }) => {
      const lead = getLead(params.id, query.businessId);
      if (!lead) {
        set.status = 404;
        return { success: false, error: "Lead not found" };
      }
      return {
        success: true,
        lead: toDto(lead),
        activities: getActivities(params.id, query.businessId)
      };
    },
    {
      query: t.Object({
        businessId: t.String({ minLength: 1, error: "businessId query param is required" })
      })
    }
  )

  .patch(
    "/:id",
    ({ params, body, set }) => {
      const { business_id, ...changes } = body;
      const result = updateLead(params.id, business_id, changes);
      if (!result.ok) {
        set.status = result.code;
        return { success: false, error: result.error };
      }
      return { success: true, lead: toDto(result.lead) };
    },
    {
      body: t.Object({
        business_id: t.String({ minLength: 1, error: "business_id is required" }),
        status: t.Optional(statusSchema),
        score: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        assigned_agent_id: t.Optional(t.Nullable(t.String())),
        notes: t.Optional(t.String()),
        tags: t.Optional(t.Array(t.String())),
        service_interest: t.Optional(t.String()),
        budget_range: t.Optional(t.String()),
        conversion_value: t.Optional(t.Number()),
        performed_by: t.Optional(t.String())
      })
    }
  )

  .post(
    "/:id/assign",
    ({ params, body, set }) => {
      const agentId = body.agent_id ?? pickAgent(body.business_id);
      if (!agentId) {
        set.status = 400;
        return { success: false, error: "No agent available to assign" };
      }
      const result = updateLead(params.id, body.business_id, {
        assigned_agent_id: agentId,
        performed_by: body.performed_by ?? "system"
      });
      if (!result.ok) {
        set.status = result.code;
        return { success: false, error: result.error };
      }
      return { success: true, lead: toDto(result.lead), assigned_agent_id: agentId };
    },
    {
      body: t.Object({
        business_id: t.String({ minLength: 1, error: "business_id is required" }),
        agent_id: t.Optional(t.String()),
        performed_by: t.Optional(t.String())
      })
    }
  );
