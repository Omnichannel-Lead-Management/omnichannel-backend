import { Elysia } from "elysia";

const PORT = Number(process.env.PORT ?? 3004);

const app = new Elysia()
  .get("/health", () => ({ status: "ok", service: "notification" }))
  .post("/api/notifications/email", ({ body }) => ({
    success: true,
    message: "Notification service — not yet implemented.",
    received: body,
  }))
  .listen(PORT);

console.log(`Notification Service listening on http://localhost:${PORT}`);
