import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

/**
 * The chatbot and notification proxies own paths under /api/businesses/:id, the
 * same prefix businessesRoutes owns. Mounting them together must not let one
 * shadow the other, and every parameter at that position must share one name —
 * Elysia's router throws at request time otherwise, which would take the whole
 * gateway down on its first call.
 *
 * Imported under distinct specifiers so this file gets its own module instances
 * and cannot disturb the CHATBOT_SERVICE_URL the proxy tests configure.
 * Upstreams are irrelevant here: this asserts routing, so "anything but 404".
 */
const { chatbotProxyRoutes } = await import("./chatbot.proxy.routes?composition");
const { notificationsProxyRoutes } = await import("./notifications.proxy.routes?composition");
const { businessesRoutes } = await import("./businesses.routes?composition");

// Same order as index.ts.
const app = new Elysia()
  .use(chatbotProxyRoutes)
  .use(notificationsProxyRoutes)
  .use(businessesRoutes);

const status = async (path: string, init?: RequestInit) =>
  (await app.handle(new Request(`http://localhost${path}`, init))).status;

describe("route composition under /api/businesses", () => {
  test("mounting all three modules together does not throw", async () => {
    // A router parameter-name clash surfaces on the first request, not at
    // registration — so an actual call is the only way to catch it.
    expect(await status("/api/businesses/biz_a/faqs")).not.toBe(404);
  });

  test("an unknown sub-path is still a 404, not a silent proxy", async () => {
    expect(await status("/api/businesses/biz_a/not-a-real-thing")).toBe(404);
  });

  test("every route the dashboard calls is registered", async () => {
    const paths: Array<[string, RequestInit | undefined]> = [
      ["/api/businesses/biz_a/faqs", undefined],
      ["/api/businesses/biz_a/faqs", { method: "POST", body: "{}" }],
      ["/api/faqs/faq_1", { method: "DELETE" }],
      ["/api/businesses/biz_a/config", undefined],
      ["/api/templates", undefined],
      ["/api/flows?businessId=biz_a", undefined],
      ["/api/flows/flow_1", undefined],
      ["/api/businesses/biz_a/attach-template", { method: "POST", body: "{}" }],
      ["/api/businesses/biz_a/notifications", undefined],
      ["/api/businesses/biz_a/notifications/ntf_1/read", { method: "PATCH" }],
      ["/api/businesses/biz_a/notifications/read-all", { method: "POST" }]
    ];

    for (const [path, init] of paths) {
      expect(await status(path, init)).not.toBe(404);
    }
  });
});
