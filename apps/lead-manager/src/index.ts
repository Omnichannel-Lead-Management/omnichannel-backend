import { Elysia } from "elysia";
import { initDatabase } from "./db";
import { leadsRoutes } from "./routes/leads.routes";
import { chatRoutes } from "./routes/chat.routes";
import { healthRoutes } from "./routes/health.routes";

const PORT = Number(process.env.PORT ?? 3002);

await initDatabase();

const app = new Elysia()
  .get("/", () => ({
    name: "lead-manager",
    version: "1.0.0",
    endpoints: {
      "POST /api/leads": "Create a lead (auto-scored)",
      "GET /api/leads?businessId=": "List / filter leads for a business",
      "GET /api/leads/:id?businessId=": "Lead detail + activity trail",
      "PATCH /api/leads/:id": "Update status / score / assignment / notes",
      "POST /api/leads/:id/assign": "Assign an agent (explicit or round-robin)",
      "GET /api/leads/stream?businessId=": "Server-Sent Events of lead changes",
      "POST /chat": "Routing entry point for lead_qualification intent",
      "GET /health": "Health check"
    }
  }))
  .use(healthRoutes)
  .use(leadsRoutes)
  .use(chatRoutes)
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return { success: false, error: error.message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { success: false, error: "Not found" };
    }
    set.status = 500;
    return {
      success: false,
      error: error instanceof Error ? error.message : "Internal server error"
    };
  })
  .listen(PORT);

console.log(`🚀 Lead Manager listening on http://localhost:${PORT}`);
console.log("   POST /api/leads | GET /api/leads | PATCH /api/leads/:id | POST /chat");

export default app;
export type App = typeof app;
