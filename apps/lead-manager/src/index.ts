import { Elysia } from "elysia";

const PORT = Number(process.env.PORT ?? 3002);

const app = new Elysia()
  .get("/health", () => ({ status: "ok", service: "lead-manager" }))
  .post("/chat", ({ body }) => ({
    success: true,
    messages: [{ type: "text", text: "Lead manager service — not yet implemented." }],
    escalated: true,
    received: body,
  }))
  .listen(PORT);

console.log(`Lead Manager listening on http://localhost:${PORT}`);
