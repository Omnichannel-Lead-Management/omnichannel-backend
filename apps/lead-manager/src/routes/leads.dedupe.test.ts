import { describe, expect, test, beforeAll } from "bun:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.AGENT_POOL = "agentX,agentY";

const { initDatabase } = await import("../db");
const { leadsRoutes } = await import("./leads.routes");

beforeAll(async () => {
  await initDatabase();
});

/**
 * The chatbot now captures a lead on every enquiry it answers, including FAQ
 * replies. Without dedupe one customer asking three questions would become
 * three leads, so POST is idempotent per (business_id, messenger_id).
 */
function post(body: unknown) {
  return leadsRoutes.handle(
    new Request("http://localhost/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

const enquiry = (message: string) => ({
  business_id: "biz_dedupe",
  messenger_id: "tg_same_person",
  platform: "telegram",
  source: "chatbot",
  service_interest: message
});

describe("POST /api/leads deduplication", () => {
  test("the same messenger asking twice yields one lead", async () => {
    const first = await post(enquiry("what are your pro packages?"));
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const second = await post(enquiry("and what are your opening hours?"));
    expect(second.status).toBe(200);
    const secondBody = await second.json();

    expect(secondBody.deduplicated).toBe(true);
    expect(secondBody.lead.id).toBe(firstBody.lead.id);
  });

  test("a different messenger still creates its own lead", async () => {
    const other = await post({
      business_id: "biz_dedupe",
      messenger_id: "tg_someone_else",
      platform: "telegram",
      source: "chatbot",
      service_interest: "do you do bridal makeup?"
    });

    expect(other.status).toBe(201);
  });

  test("the same messenger under another business is a separate lead", async () => {
    const other = await post({
      business_id: "biz_other_tenant",
      messenger_id: "tg_same_person",
      platform: "telegram",
      source: "chatbot",
      service_interest: "hello"
    });

    expect(other.status).toBe(201);
  });
});
