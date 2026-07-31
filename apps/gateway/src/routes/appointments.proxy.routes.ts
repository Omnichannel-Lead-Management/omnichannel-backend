import { Elysia } from "elysia";

/**
 * Thin proxy from the public origin to the Appointment service, for the same
 * reason as leads.routes.ts: the edge only exposes /api/ on this gateway, so
 * the dashboard cannot reach port 3005 directly.
 *
 * Named *.proxy.routes.ts because apps/appointment owns the real
 * appointments.ts — this file must not grow booking logic of its own.
 */
const APPOINTMENT_SERVICE_URL =
  process.env.APPOINTMENT_SERVICE_URL ?? "http://localhost:3005";
const TIMEOUT_MS = 8000;

async function forward(
  path: string,
  init: RequestInit & { set: { status?: number | string } }
): Promise<unknown> {
  const { set, ...options } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${APPOINTMENT_SERVICE_URL}${path}`, {
      ...options,
      signal: controller.signal
    });
    set.status = res.status;
    return await res.json();
  } catch (err) {
    set.status = 502;
    return {
      success: false,
      message: `Appointment service unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`
    };
  } finally {
    clearTimeout(timer);
  }
}

const json = { "Content-Type": "application/json" } as const;

export const appointmentsProxyRoutes = new Elysia({ prefix: "/api/appointments" })
  // Before "/:id" so "availability" is not read as an appointment id.
  .get("/availability", ({ query, set }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" && value) params.set(key, value);
    }
    return forward(`/api/appointments/availability?${params}`, { set });
  })

  .get("/", ({ query, set }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" && value) params.set(key, value);
    }
    return forward(`/api/appointments?${params}`, { set });
  })

  .get("/:id", ({ params, query, set }) => {
    const businessId = typeof query.businessId === "string" ? query.businessId : "";
    return forward(
      `/api/appointments/${encodeURIComponent(params.id)}?businessId=${encodeURIComponent(
        businessId
      )}`,
      { set }
    );
  })

  .post("/", ({ body, set }) =>
    forward("/api/appointments", {
      set,
      method: "POST",
      headers: json,
      body: JSON.stringify(body)
    })
  )

  .patch("/:id/status", ({ params, body, set }) =>
    forward(`/api/appointments/${encodeURIComponent(params.id)}/status`, {
      set,
      method: "PATCH",
      headers: json,
      body: JSON.stringify(body)
    })
  );
