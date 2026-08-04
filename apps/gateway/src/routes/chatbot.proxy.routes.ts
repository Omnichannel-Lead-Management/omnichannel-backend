import { Elysia } from "elysia";
import { mirrorChatbotEnabled } from "../services/BusinessRegistry";

/**
 * Thin proxy from the public origin to the Chatbot Builder service, for the same
 * reason as leads.routes.ts and appointments.proxy.routes.ts: the edge only
 * exposes /api/ on this gateway, so the dashboard — which knows exactly one base
 * URL — cannot reach port 3003 directly. Without this file the FAQ, flow and
 * chatbot-config screens are unreachable from a browser.
 *
 * Named *.proxy.routes.ts because chatbot-builder owns the real faqs.routes.ts /
 * flows.routes.ts — this file must not grow chatbot logic of its own.
 */
const CHATBOT_SERVICE_URL = process.env.CHATBOT_SERVICE_URL ?? "http://localhost:3003";
const TIMEOUT_MS = 8000;

async function forward(
  path: string,
  init: RequestInit & { set: { status?: number | string } }
): Promise<unknown> {
  const { set, ...options } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${CHATBOT_SERVICE_URL}${path}`, {
      ...options,
      signal: controller.signal
    });
    set.status = res.status;
    // 204 and other empty-body replies would throw on .json().
    if (res.status === 204) return { success: true };
    return await res.json();
  } catch (err) {
    set.status = 503;
    return {
      success: false,
      error: `Chatbot service unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`
    };
  } finally {
    clearTimeout(timer);
  }
}

const json = { "Content-Type": "application/json" } as const;

/**
 * Mounted without a prefix because the upstream paths are not under a single
 * segment (/api/businesses/:id/faqs, /api/faqs/:id, /api/flows, /api/templates).
 * Each route below mirrors its chatbot-builder counterpart verbatim.
 *
 * The business parameter MUST be named `:id` here: businesses.routes.ts already
 * registers /api/businesses/:id, and Elysia's router refuses two different
 * parameter names at the same path position — the gateway throws on its first
 * request if these disagree. See route-composition.test.ts.
 */
export const chatbotProxyRoutes = new Elysia()
  // ── FAQs ──
  .get("/api/businesses/:id/faqs", ({ params, set }) =>
    forward(`/api/businesses/${encodeURIComponent(params.id)}/faqs`, { set })
  )

  .post("/api/businesses/:id/faqs", ({ params, body, set }) =>
    forward(`/api/businesses/${encodeURIComponent(params.id)}/faqs`, {
      set,
      method: "POST",
      headers: json,
      body: JSON.stringify(body)
    })
  )

  .put("/api/businesses/:id/faqs", ({ params, body, set }) =>
    forward(`/api/businesses/${encodeURIComponent(params.id)}/faqs`, {
      set,
      method: "PUT",
      headers: json,
      body: JSON.stringify(body)
    })
  )

  .patch("/api/faqs/:id", ({ params, body, set }) =>
    forward(`/api/faqs/${encodeURIComponent(params.id)}`, {
      set,
      method: "PATCH",
      headers: json,
      body: JSON.stringify(body)
    })
  )

  .delete("/api/faqs/:id", ({ params, set }) =>
    forward(`/api/faqs/${encodeURIComponent(params.id)}`, { set, method: "DELETE" })
  )

  // ── Chatbot config (welcome/escalation copy + the enabled switch) ──
  .get("/api/businesses/:id/config", ({ params, set }) =>
    forward(`/api/businesses/${encodeURIComponent(params.id)}/config`, { set })
  )

  .patch("/api/businesses/:id/config", async ({ params, body, set }) => {
    const result = await forward(
      `/api/businesses/${encodeURIComponent(params.id)}/config`,
      { set, method: "PATCH", headers: json, body: JSON.stringify(body) }
    );

    // chatbot-builder owns chatbot_enabled. Refresh the gateway's display copy
    // so GET /api/businesses/:id does not report a stale toggle state.
    const enabled = (result as { config?: { chatbot_enabled?: unknown } })?.config?.chatbot_enabled;
    if (typeof enabled === "boolean") {
      await mirrorChatbotEnabled(params.id, enabled);
    }

    return result;
  })

  // ── Sector templates + flows ──
  .get("/api/templates", ({ set }) => forward("/api/templates", { set }))

  .post("/api/businesses/:id/attach-template", ({ params, body, set }) =>
    forward(`/api/businesses/${encodeURIComponent(params.id)}/attach-template`, {
      set,
      method: "POST",
      headers: json,
      body: JSON.stringify(body)
    })
  )

  .get("/api/flows", ({ query, set }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" && value) params.set(key, value);
    }
    return forward(`/api/flows?${params}`, { set });
  })

  .post("/api/flows", ({ body, set }) =>
    forward("/api/flows", { set, method: "POST", headers: json, body: JSON.stringify(body) })
  )

  .get("/api/flows/:id", ({ params, set }) =>
    forward(`/api/flows/${encodeURIComponent(params.id)}`, { set })
  )

  .patch("/api/flows/:id", ({ params, body, set }) =>
    forward(`/api/flows/${encodeURIComponent(params.id)}`, {
      set,
      method: "PATCH",
      headers: json,
      body: JSON.stringify(body)
    })
  )

  .delete("/api/flows/:id", ({ params, set }) =>
    forward(`/api/flows/${encodeURIComponent(params.id)}`, { set, method: "DELETE" })
  );
