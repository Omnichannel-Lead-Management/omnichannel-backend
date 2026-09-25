import { Elysia } from "elysia";
import {
  CORRELATION_ID_HEADER,
  generateCorrelationId,
  logWithCorrelation
} from "../middleware/correlationId";

type ServiceKey =
  | "routing_agent"
  | "product_agent"
  | "ordering_system"
  | "complaint_agent"
  | "photo_agent"
  | "recommender"
  | "ml_prediction"
  | "analytics_service"
  | "notification_svc"
  | "mcp_server";

type ServiceStatus = "ok" | "degraded" | "down";

interface ServiceHealthSummary {
  status: ServiceStatus;
  latency_ms: number;
}

interface ServiceHealthTarget {
  key: ServiceKey;
  url: string;
  critical: boolean;
}

const HEALTH_TIMEOUT_MS = 3_000;

function ensureHealthUrl(rawUrl: string, fallbackPath: string): string {
  try {
    const parsed = new URL(rawUrl);
    const path = parsed.pathname.replace(/\/+$/, "");

    if (path.endsWith("/health") || path.endsWith("/analytics/health")) {
      parsed.search = "";
      return parsed.toString();
    }

    parsed.pathname = fallbackPath;
    parsed.search = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function getRoutingHealthUrl(): string {
  const explicit = process.env.ROUTING_AGENT_HEALTH_URL?.trim();
  if (explicit) {
    return ensureHealthUrl(explicit, "/health");
  }

  const routingChatUrl = process.env.ROUTING_AGENT_URL?.trim() || "http://routing-agent:3000/chat";
  return ensureHealthUrl(routingChatUrl, "/health");
}

function getHealthTargets(): ServiceHealthTarget[] {
  return [
    { key: "routing_agent", url: getRoutingHealthUrl(), critical: true },
    {
      key: "product_agent",
      url: ensureHealthUrl(
        process.env.PRODUCT_AGENT_URL?.trim() || "http://product-agent:3000",
        "/health"
      ),
      critical: false
    },
    {
      key: "ordering_system",
      url: ensureHealthUrl(
        process.env.ORDERING_SYSTEM_URL?.trim() || "http://ordering-agent:3000",
        "/health"
      ),
      critical: false
    },
    {
      key: "complaint_agent",
      url: ensureHealthUrl(
        process.env.COMPLAINT_AGENT_URL?.trim() || "http://complaint-agent:3000",
        "/health"
      ),
      critical: false
    },
    {
      key: "photo_agent",
      url: ensureHealthUrl(
        process.env.PHOTO_AGENT_URL?.trim() || "http://photo-agent:3000",
        "/health"
      ),
      critical: false
    },
    {
      key: "recommender",
      url: ensureHealthUrl(
        process.env.RECOMMENDER_URL?.trim() || "http://recommender-service:8002",
        "/health"
      ),
      critical: false
    },
    {
      key: "ml_prediction",
      url: ensureHealthUrl(
        process.env.ML_PREDICTION_URL?.trim() || "http://recommendation-deploy:8004",
        "/health"
      ),
      critical: false
    },
    {
      key: "analytics_service",
      url: ensureHealthUrl(
        process.env.ANALYTICS_SERVICE_URL?.trim() || "http://analytics-service:8008/analytics/health",
        "/analytics/health"
      ),
      critical: false
    },
    {
      key: "notification_svc",
      url: ensureHealthUrl(
        process.env.NOTIFICATION_SERVICE_URL?.trim() || "http://notification-service:8007",
        "/health"
      ),
      critical: false
    },
    {
      key: "mcp_server",
      url: ensureHealthUrl(
        process.env.MCP_SERVER_URL?.trim() || "http://product-mcp:8001",
        "/health"
      ),
      critical: false
    }
  ];
}

function normalizeHealthStatus(payload: unknown): ServiceStatus {
  if (!payload || typeof payload !== "object") {
    return "ok";
  }

  const statusRaw = (payload as { status?: unknown }).status;
  if (typeof statusRaw !== "string") {
    return "ok";
  }

  const status = statusRaw.trim().toLowerCase();
  if (status === "ok" || status === "healthy" || status === "up" || status === "running") {
    return "ok";
  }
  if (status === "degraded" || status === "warning") {
    return "degraded";
  }

  return "degraded";
}

async function probeHealth(
  target: ServiceHealthTarget,
  requestId: string
): Promise<ServiceHealthSummary> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const response = await fetch(target.url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        [CORRELATION_ID_HEADER]: requestId
      }
    });

    const latencyMs = Math.round(performance.now() - startedAt);

    if (!response.ok) {
      logWithCorrelation(
        requestId,
        "HEALTH_PROBE_DOWN",
        `${target.key} status=${response.status} latency_ms=${latencyMs}`,
        "warn"
      );
      return { status: "down", latency_ms: latencyMs };
    }

    let status: ServiceStatus = "ok";
    try {
      const payload = await response.json();
      status = normalizeHealthStatus(payload);
    } catch {
      status = "ok";
    }

    if (status !== "ok") {
      logWithCorrelation(
        requestId,
        "HEALTH_PROBE_DEGRADED",
        `${target.key} latency_ms=${latencyMs}`,
        "warn"
      );
    }

    return { status, latency_ms: latencyMs };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const errorText = error instanceof Error ? error.message : String(error);
    logWithCorrelation(
      requestId,
      "HEALTH_PROBE_DOWN",
      `${target.key} error=${errorText} latency_ms=${latencyMs}`,
      "warn"
    );
    return { status: "down", latency_ms: latencyMs };
  } finally {
    clearTimeout(timeout);
  }
}

export const healthRoutes = new Elysia({ prefix: "/api/health" }).get(
  "/all",
  async ({ set, headers }) => {
    const headerRequestId = headers[CORRELATION_ID_HEADER] ?? headers[CORRELATION_ID_HEADER.toLowerCase()];
    const requestId =
      typeof headerRequestId === "string" && headerRequestId.trim().length > 0
        ? headerRequestId.trim()
        : generateCorrelationId();
    set.headers[CORRELATION_ID_HEADER] = requestId;

    try {
      const targets = getHealthTargets();
      const results = await Promise.all(
        targets.map(async (target) => ({
          key: target.key,
          critical: target.critical,
          summary: await probeHealth(target, requestId)
        }))
      );

      const services: Record<ServiceKey, ServiceHealthSummary> = {
        routing_agent: { status: "down", latency_ms: 0 },
        product_agent: { status: "down", latency_ms: 0 },
        ordering_system: { status: "down", latency_ms: 0 },
        complaint_agent: { status: "down", latency_ms: 0 },
        photo_agent: { status: "down", latency_ms: 0 },
        recommender: { status: "down", latency_ms: 0 },
        ml_prediction: { status: "down", latency_ms: 0 },
        analytics_service: { status: "down", latency_ms: 0 },
        notification_svc: { status: "down", latency_ms: 0 },
        mcp_server: { status: "down", latency_ms: 0 }
      };

      for (const result of results) {
        services[result.key] = result.summary;
      }

      const hasCriticalDown = results.some(
        (result) => result.critical && result.summary.status === "down"
      );
      const hasAnyIssue = results.some((result) => result.summary.status !== "ok");

      const overall: "ok" | "degraded" | "down" = hasCriticalDown
        ? "down"
        : hasAnyIssue
          ? "degraded"
          : "ok";

      logWithCorrelation(
        requestId,
        "HEALTH_AGGREGATED",
        `overall=${overall} targets=${results.length}`
      );

      return {
        overall,
        timestamp: new Date().toISOString(),
        services
      };
    } catch (error) {
      set.status = 500;
      const errorText = error instanceof Error ? error.message : String(error);
      logWithCorrelation(
        requestId,
        "HEALTH_AGGREGATION_ERROR",
        errorText,
        "error"
      );
      return {
        overall: "down",
        timestamp: new Date().toISOString(),
        services: {},
        error: "Failed to aggregate health checks"
      };
    }
  },
  {
    detail: {
      summary: "Aggregate service health checks",
      description:
        "Checks all OmniSense services with a 3-second timeout per service and returns overall health.",
      tags: ["System"]
    }
  }
);
