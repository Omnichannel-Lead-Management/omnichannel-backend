import { Elysia } from "elysia";

/**
 * Thin proxy from the public origin to the Lead Manager service.
 *
 * The edge only routes /api/ to this gateway, so lead-manager (3002) is not
 * reachable from a browser on its own. Rather than publish another origin and
 * widen CORS, the dashboard talks to /api/leads here and we forward.
 *
 * Deliberately dumb: no reshaping of payloads, so lead-manager stays the single
 * owner of the lead contract. Status codes and bodies pass through unchanged,
 * which is what the dashboard's error handling already expects.
 */
const LEAD_MANAGER_URL = process.env.LEAD_MANAGER_URL ?? "http://localhost:3002";
const TIMEOUT_MS = 8000;

async function forward(
  path: string,
  init: RequestInit & { set: { status?: number | string } }
): Promise<unknown> {
  const { set, ...options } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${LEAD_MANAGER_URL}${path}`, {
      ...options,
      signal: controller.signal
    });
    set.status = res.status;
    return await res.json();
  } catch (err) {
    // A dead lead-manager must not read as an empty lead list — the agent would
    // think there is no work rather than that the screen is broken.
    set.status = 502;
    return {
      success: false,
      error: `Lead Manager unreachable: ${err instanceof Error ? err.message : String(err)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

const json = { "Content-Type": "application/json" } as const;

export const leadsRoutes = new Elysia({ prefix: "/api/leads" })
  // Declared before "/:id" so the literal path is not captured as an id.
  .get("/stream", ({ query, set }) => {
    const businessId = typeof query.businessId === "string" ? query.businessId : "";
    if (!businessId) {
      set.status = 400;
      return { success: false, error: "businessId query param is required" };
    }

    // SSE cannot go through `forward` — the body has to stay an open stream, so
    // hand the upstream Response body straight back to the client.
    return fetch(
      `${LEAD_MANAGER_URL}/api/leads/stream?businessId=${encodeURIComponent(businessId)}`,
      { headers: { Accept: "text/event-stream" } }
    ).then(
      (upstream) =>
        new Response(upstream.body, {
          status: upstream.status,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            // Without this the edge buffers the stream and events arrive in bursts.
            "X-Accel-Buffering": "no"
          }
        }),
      () => new Response("event: error\ndata: {}\n\n", { status: 502 })
    );
  })

  .get("/", ({ query, set }) => {
    const params = new URLSearchParams();
    for (const key of ["businessId", "status", "assignedAgentId"]) {
      const value = query[key as keyof typeof query];
      if (typeof value === "string" && value) params.set(key, value);
    }
    return forward(`/api/leads?${params}`, { set });
  })

  .get("/:id", ({ params, query, set }) => {
    const businessId = typeof query.businessId === "string" ? query.businessId : "";
    return forward(
      `/api/leads/${encodeURIComponent(params.id)}?businessId=${encodeURIComponent(businessId)}`,
      { set }
    );
  })

  .post("/", ({ body, set }) =>
    forward("/api/leads", { set, method: "POST", headers: json, body: JSON.stringify(body) })
  )

  .patch("/:id", ({ params, body, set }) =>
    forward(`/api/leads/${encodeURIComponent(params.id)}`, {
      set,
      method: "PATCH",
      headers: json,
      body: JSON.stringify(body)
    })
  )

  .post("/:id/assign", ({ params, body, set }) =>
    forward(`/api/leads/${encodeURIComponent(params.id)}/assign`, {
      set,
      method: "POST",
      headers: json,
      body: JSON.stringify(body)
    })
  );
