import { Elysia } from "elysia";

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
  .get("/stream", ({ query, set }) => {
    const businessId = typeof query.businessId === "string" ? query.businessId : "";
    if (!businessId) {
      set.status = 400;
      return { success: false, error: "businessId query param is required" };
    }

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
