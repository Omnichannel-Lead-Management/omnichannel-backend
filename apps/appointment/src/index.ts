import { Elysia } from "elysia";
import { createDatabase } from "./db/database";
import { initializeDatabase } from "./db/initialize";

const PORT = Number(process.env.PORT ?? 3005);

const db = createDatabase();
initializeDatabase(db);

const app = new Elysia()
  .get("/health", () => ({ status: "ok", service: "appointment" }))
  .post("/chat", ({ body }) => ({
    success: true,
    messages: [{ type: "text", text: "Appointment service — not yet implemented." }],
    escalated: false,
    received: body,
  }))
  .listen(PORT);

console.log(`Appointment Service listening on http://localhost:${PORT}`);
