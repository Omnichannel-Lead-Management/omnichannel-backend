import type { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import type { ConfirmationEmailDependencies } from "./services/confirmation-email";
import { createAppointmentRoutes } from "./routes/appointments";
import { createChatRoute } from "./routes/chat";

export function createApp(db: Database, emailDependencies?: ConfirmationEmailDependencies): Elysia {
  return new Elysia()
    .get("/health", () => ({ status: "ok", service: "appointment" }))
    .use(createChatRoute(db))
    .use(createAppointmentRoutes(db, emailDependencies));
}
