import { Elysia } from "elysia";

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3004";
const TIMEOUT_MS = 8000;

async function forward(
  path: string,
  init: RequestInit & { set: { status?: number | string } }
): Promise<unknown> {
  const { set, ...options } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${NOTIFICATION_SERVICE_URL}${path}`, {
      ...options,
      signal: controller.signal
    });
    set.status = res.status;
    if (res.status === 204) return { success: true };
    return await res.json();
  } catch (err) {
    set.status = 503;
    return {
      success: false,
      error: `Notification service unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`
    };
  } finally {
    clearTimeout(timer);
  }
}

export const notificationsProxyRoutes = new Elysia()
  .get("/api/businesses/:id/notifications", ({ params, query, set }) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" && value) search.set(key, value);
    }
    const suffix = search.size ? `?${search}` : "";
    return forward(
      `/api/businesses/${encodeURIComponent(params.id)}/notifications${suffix}`,
      { set }
    );
  })

  .patch("/api/businesses/:id/notifications/:notificationId/read", ({ params, set }) =>
    forward(
      `/api/businesses/${encodeURIComponent(params.id)}/notifications/${encodeURIComponent(
        params.notificationId
      )}/read`,
      { set, method: "PATCH" }
    )
  )

  .post("/api/businesses/:id/notifications/read-all", ({ params, set }) =>
    forward(
      `/api/businesses/${encodeURIComponent(params.id)}/notifications/read-all`,
      { set, method: "POST" }
    )
  );
