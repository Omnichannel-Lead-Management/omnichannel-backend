import type { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { createAppointmentRoutes } from "./routes/appointments";

export function createApp(db: Database): Elysia {
  return new Elysia()
    .get("/health", () => ({ status: "ok", service: "appointment" }))
    .post("/chat", ({ body }) => ({
      success: true,
      messages: [
        { type: "text", text: "Appointment service — not yet implemented." },
      ],
      escalated: false,
      received: body,
    }))
    .use(createAppointmentRoutes(db));
}
