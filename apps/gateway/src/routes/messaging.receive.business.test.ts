import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { incomingMessageBody } from "./messaging.routes";

/**
 * `business_id` reaching the handler is what decides which tenant's FAQs, flow
 * and lead capture a message is evaluated against. Elysia strips any body
 * property the schema does not declare, so leaving it out routed every message
 * to biz_default — accepted with 200, replied to, and never turned into a lead.
 *
 * This drives the real exported schema through Elysia rather than mocking the
 * orchestrator: module mocks in bun's runner are global and leak into the
 * MessageOrchestrator suites.
 */
const app = new Elysia().post("/receive", ({ body }) => body, {
  body: incomingMessageBody
});

function post(body: unknown) {
  return app.handle(
    new Request("http://localhost/receive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

describe("POST /api/messaging/receive tenant targeting", () => {
  test("business_id survives validation and reaches the handler", async () => {
    const response = await post({
      platform: "web",
      business_id: "biz_real_tenant",
      messenger_id: "cust_1",
      message: "How much is a bridal package?"
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ business_id: "biz_real_tenant" });
  });

  test("omitting it is allowed, leaving the default to the orchestrator", async () => {
    const response = await post({
      platform: "web",
      messenger_id: "cust_2",
      message: "Hello"
    });

    expect(response.status).toBe(200);
    expect((await response.json()).business_id).toBeUndefined();
  });

  test("the required fields are still enforced", async () => {
    const response = await post({ platform: "web", business_id: "biz_real_tenant" });
    expect(response.status).toBe(422);
  });
});
