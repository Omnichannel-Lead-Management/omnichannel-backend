import { Elysia, t } from "elysia";
import { getDownstreamAgentNames } from "./agents/registry";
import { getAgentsHealth } from "./circuitBreaker";
import { route } from "./router";

const PORT = Number(process.env.PORT ?? 3001);

const app = new Elysia()
  .get("/health", () => {
    const agentNames = getDownstreamAgentNames();
    const agents = getAgentsHealth(agentNames);
    const status = Object.values(agents).every((value) => value === "up")
      ? "ok"
      : "degraded";

    return { status, agents };
  })
  .post(
    "/chat",
    async ({ body, headers, set }) => {
      const requestIdFromHeader = headers["x-request-id"];
      const requestId =
        body.request_id ??
        (typeof requestIdFromHeader === "string" && requestIdFromHeader.trim().length > 0
          ? requestIdFromHeader.trim()
          : crypto.randomUUID());

      try {
        return await route({
          ...body,
          image_url: body.image_url ?? undefined,
          request_id: requestId
        });
      } catch (err) {
        console.error(
          `[REQ-${requestId}] ${new Date().toISOString()} API_ERROR unhandled error:`,
          err
        );
        set.status = 500;
        return {
          success: false,
          agent: "unknown",
          response: [{ text: "Internal server error" }],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      body: t.Object({
        message: t.String({ minLength: 1, error: "message must be a non-empty string" }),
        request_id: t.Optional(t.String()),
        messenger_id: t.String({ minLength: 1, error: "messenger_id is required" }),
        platform: t.Optional(t.String()),
        image_url: t.Optional(t.Nullable(t.String())),
        language: t.Optional(
          t.Union([
            t.Literal("en"),
            t.Literal("si"),
            t.Literal("ta"),
            t.Literal("english"),
            t.Literal("sinhala"),
            t.Literal("tamil")
          ])
        ),
        language_tag: t.Optional(
          t.Union([t.Literal("english"), t.Literal("sinhala"), t.Literal("tamil")])
        ),
        history: t.Optional(
          t.Array(
            t.Object({
              is_from_user: t.Boolean(),
              text: t.String(),
              timestamp: t.String(),
            })
          )
        ),
        user_info: t.Optional(
          t.Object({
            first_name: t.Optional(t.String()),
            last_name: t.Optional(t.String()),
            username: t.Optional(t.String()),
            phone: t.Optional(t.String()),
            linked_user_id: t.Optional(t.Nullable(t.String())),
          })
        ),
        platform_capabilities: t.Optional(
          t.Object({
            quick_replies: t.Boolean(),
            url_buttons: t.Boolean(),
            lists: t.Boolean(),
            max_quick_replies: t.Union([t.Number(), t.Null()]),
          })
        ),
      }),
    }
  )
  .listen(PORT);

console.log(`Routing Service listening on http://localhost:${PORT}`);
console.log("  POST /chat  →  routes to appropriate service (chatbot, appointment, lead manager)");
console.log("  GET  /health");
