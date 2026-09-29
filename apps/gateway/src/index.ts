
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { initDatabase } from "./db";
import { initializePlatforms } from "./platforms";
import { messagingRoutes } from "./routes/messaging.routes";
import { uploadRoutes } from "./routes/upload.routes";
import { telegramRoutes } from "./routes/telegram.routes";
import { whatsappRoutes } from "./routes/whatsapp.routes";
import { evolutionRoutes } from "./routes/evolution.routes";
import { businessesRoutes } from "./routes/businesses.routes";
import { websocketRoutes } from "./routes/websocket.routes";
import { agentWebsocketRoutes } from "./routes/agent.websocket.routes";
import { agentsRoutes } from "./routes/agents.routes";
import { leadsRoutes } from "./routes/leads.routes";
import { appointmentsProxyRoutes } from "./routes/appointments.proxy.routes";
import { chatbotProxyRoutes } from "./routes/chatbot.proxy.routes";
import { notificationsProxyRoutes } from "./routes/notifications.proxy.routes";
import { healthRoutes } from "./routes/health.routes";
import { authRoutes } from "./routes/auth.routes";
import { adminRoutes } from "./routes/admin.routes";
import { billingRoutes } from "./routes/billing.routes";
import { authorize } from "./middleware/requireAuth";
import { sessionAuthService } from "./services/SessionAuth";
import { adminAuthService } from "./services/AdminAuth";
import { countAdmins } from "./services/AdminRegistry";
import {
  describeAllowedCorsOrigins,
  getAllowedCorsOrigins,
  isOriginAllowed
} from "./services/SecurityConfig";

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const allowedCorsOrigins = getAllowedCorsOrigins();

/** Initialize application */
async function init() {
  console.log("🚀 Starting Messaging Orchestrator...");
  console.log(`📍 Environment: ${NODE_ENV}`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Allowed CORS origins: ${describeAllowedCorsOrigins()}`);

  if (allowedCorsOrigins.length === 0) {
    console.warn(
      "⚠️  No CORS browser origins configured. Set CORS_ALLOWED_ORIGINS for production."
    );
  }

  // Without a signing secret every `/api/` route answers 503 rather than
  // falling open, so in production this is a startup failure, not a warning.
  if (!sessionAuthService.configured) {
    const message =
      "AUTH_JWT_SECRET is not set — dashboard sessions cannot be issued or verified.";
    if (NODE_ENV === "production") throw new Error(message);
    console.warn(`⚠️  ${message}`);
  } else {
    console.log("🔐 Dashboard session authentication enabled");
  }

  // The admin console is optional infrastructure: without its own secret the
  // `/api/admin/` routes answer 503 and the rest of the gateway is unaffected.
  if (!adminAuthService.configured) {
    console.warn(
      "⚠️  ADMIN_JWT_SECRET is not set — the platform admin console is disabled."
    );
  } else {
    console.log("🛡️  Platform admin console enabled");
  }

  if (!process.env.INTERNAL_SERVICE_TOKEN?.trim()) {
    console.warn(
      "⚠️  INTERNAL_SERVICE_TOKEN is not set — chatbot, lead-manager and appointment " +
        "cannot read business profiles, so confirmation email will lose its recipient."
    );
  }

  await initDatabase();

  if (adminAuthService.configured && (await countAdmins()) === 0) {
    console.warn(
      "⚠️  No platform admin exists yet. Create one with: " +
        "bun run scripts/create-platform-admin.ts <email> --owner"
    );
  }

  await initializePlatforms();

  console.log("✅ Initialization complete");
}

const app = new Elysia()
  .use(cors({
    origin: (request) => isOriginAllowed(request.headers.get("origin")),
    credentials: true
  }))
  .use(swagger({
    documentation: {
      info: {
        title: "Messaging Orchestrator API",
        version: "1.0.0",
        description: "Pure messaging router - receives, stores, and forwards messages to external AI"
      },
      tags: [
        { name: "Messaging", description: "Core messaging endpoints" },
        { name: "Webhooks", description: "Platform webhook endpoints" },
        { name: "System", description: "System and health endpoints" }
      ]
    },
    path: "/docs"
  }))
  .get("/", () => ({
    name: "Messaging Orchestrator",
    version: "1.0.0",
    description: "Pure routing, storage, and forwarding - No AI logic",
    status: "running",
    endpoints: {
      docs: "/docs",
      health: "/api/messaging/health",
      health_all: "/api/health/all",
      receive: "POST /api/messaging/receive",
      reply: "POST /api/messaging/reply",
      history: "GET /api/messaging/history",
      upload_image: "POST /api/upload-image",
      agent_status: "GET /api/agents/status",
      businesses: "POST /api/businesses",
      login: "POST /api/auth/login",
      session: "GET /api/auth/me",
      billing: "GET /api/businesses/:id/billing",
      admin_login: "POST /api/admin/auth/login",
      admin_overview: "GET /api/admin/overview",
      telegram_webhook: "POST /webhook/telegram",
      telegram_webhook_multi_tenant: "POST /webhook/telegram/:business_id",
      whatsapp_webhook: "POST /webhook/whatsapp",
      evolution_webhook_multi_tenant: "POST /webhook/evolution/:business_id",
      websocket: "WS /ws/chat",
      agent_websocket: "WS /ws/agents"
    }
  }))
  // onRequest runs before route matching, so this covers every route on the
  // app — including those merged in by `.use()` below — without depending on
  // Elysia's per-instance hook scoping. A security gate must not be able to
  // miss a route because of where it was mounted.
  .onRequest(async ({ request, set }) => {
    const decision = await authorize(request);
    if (decision.allow) return;

    set.status = decision.status ?? 401;
    return { success: false, error: decision.error ?? "Authentication required" };
  })
  .use(authRoutes)
  .use(adminRoutes)
  .use(messagingRoutes)
  .use(uploadRoutes)
  .use(agentsRoutes)
  .use(leadsRoutes)
  .use(appointmentsProxyRoutes)
  .use(chatbotProxyRoutes)
  .use(notificationsProxyRoutes)
  .use(billingRoutes)
  .use(businessesRoutes)
  .use(healthRoutes)
  .use(telegramRoutes)
  .use(whatsappRoutes)
  .use(evolutionRoutes)
  .use(websocketRoutes)
  .use(agentWebsocketRoutes)
  .onError(({ code, error, set }) => {
    console.error(`❌ Error [${code}]:`, error);

    if (code === "VALIDATION") {
      set.status = 400;
      return {
        success: false,
        error: "Validation error",
        details: error.message
      };
    }

    if (code === "NOT_FOUND") {
      set.status = 404;
      return {
        success: false,
        error: "Endpoint not found"
      };
    }

    set.status = 500;
    return {
      success: false,
      error: "Internal server error"
    };
  })
  .listen(PORT);

await init();

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🚀 Messaging Orchestrator is running!             ║
║                                                            ║
║   📡 Server:     http://localhost:${PORT}                     ║
║   📚 Docs:       http://localhost:${PORT}/docs                ║
║   🌐 WebSocket:  ws://localhost:${PORT}/ws/chat               ║
║   👥 Agents WS:  ws://localhost:${PORT}/ws/agents             ║
║                                                            ║
║   ✅ Database initialized                                  ║
║   ✅ Platform adapters ready                               ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

export default app;
export type App = typeof app;
