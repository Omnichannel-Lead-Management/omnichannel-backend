import { describe, expect, test, mock } from "bun:test";
import type { AIRequestPayload } from "../platforms/PlatformAdapter";

/**
 * A failed routing agent used to return without sending anything, so a Vertex AI
 * outage looked identical to a working system from the customer's side. These
 * tests pin the fallback that replaced that silent drop.
 *
 * The DB and agent hub are stubbed so the escalation branch can be exercised
 * without a live Postgres.
 */

// A chainable no-op stand-in for the drizzle query builder.
const noopChain: any = new Proxy(function () {} as any, {
  get: (_t, prop) => (prop === "then" ? undefined : () => noopChain),
  apply: () => noopChain
});

mock.module("../db", () => ({
  db: {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => noopChain,
    insert: () => ({ values: async () => undefined })
  },
  schema: { messengers: {}, chatMessages: {} }
}));

mock.module("./AgentHub", () => ({
  agentHub: {
    notifyConversationQueued: async () => undefined,
    notifyConversationDeEscalated: async () => undefined,
    hasConnectedAgents: () => true
  }
}));

const { MessageOrchestrator } = await import("./MessageOrchestrator");

type Sent = { messenger_id: string; text: string };

function harness(routingResponse: { ok: boolean; body?: unknown; throws?: boolean }) {
  const sent: Sent[] = [];
  const saved: Array<{ text: string; metadata: any }> = [];
  const orchestrator = new MessageOrchestrator();

  const adapter = {
    sendMessage: async (messenger_id: string, text: string) => {
      sent.push({ messenger_id, text });
      return { success: true };
    }
  };

  (orchestrator as any).resolveAdapter = async () => adapter;
  (orchestrator as any).saveReply = async (
    _messenger_id: string,
    _platform: string,
    text: string,
    metadata: any
  ) => {
    saved.push({ text, metadata });
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (routingResponse.throws) throw new Error("connect ECONNREFUSED routing:3001");
    return {
      ok: routingResponse.ok,
      status: routingResponse.ok ? 200 : 500,
      text: async () => "upstream failure",
      json: async () => routingResponse.body
    };
  }) as any;

  const payload = {
    platform: "web",
    messenger_id: "cust_1",
    message: "how much is a haircut?",
    business_id: "biz_default",
    language: "en"
  } as AIRequestPayload;

  const run = async () => {
    try {
      await (orchestrator as any).forwardToAI(payload, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  const fallbacks = () =>
    sent.filter((m) => m.text === MessageOrchestrator.SERVICE_FALLBACK_MESSAGE);

  return { run, sent, saved, fallbacks };
}

describe("routing failure fallback", () => {
  test("an unsuccessful routing agent still answers the customer", async () => {
    const { run, sent, saved } = harness({
      ok: true,
      body: { success: false, error: "403 BILLING_DISABLED" }
    });
    await run();

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe(MessageOrchestrator.SERVICE_FALLBACK_MESSAGE);
    expect(saved[0].metadata.type).toBe("service_fallback");
    expect(saved[0].metadata.fallback_reason).toBe("routing_agent_unsuccessful");
  });

  test("an unreachable routing service still answers the customer", async () => {
    const { run, sent, saved } = harness({ ok: true, throws: true });
    await run();

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe(MessageOrchestrator.SERVICE_FALLBACK_MESSAGE);
    expect(saved[0].metadata.fallback_reason).toBe("routing_agent_error");
  });

  test("a non-ok routing response still answers the customer", async () => {
    const { run, fallbacks } = harness({ ok: false });
    await run();

    expect(fallbacks()).toHaveLength(1);
  });

  test("an empty reply set answers the customer", async () => {
    const { run, saved, fallbacks } = harness({
      ok: true,
      body: { success: true, messages: [] }
    });
    await run();

    expect(fallbacks()).toHaveLength(1);
    expect(saved[0].metadata.fallback_reason).toBe("no_outbound_messages");
  });

  test("an escalated chat is not told about a technical problem", async () => {
    // The escalation notice is the correct message here; a fallback on top of it
    // would contradict it.
    const { run, sent, fallbacks } = harness({
      ok: true,
      body: { success: true, escalated: true, messages: [] }
    });
    await run();

    expect(fallbacks()).toHaveLength(0);
    expect(sent.some((m) => m.text.includes("escalated to customer care"))).toBe(true);
  });

  test("a real reply is never followed by a fallback", async () => {
    const { run, sent } = harness({
      ok: true,
      body: { success: true, messages: [{ type: "text", text: "A haircut is $40." }] }
    });
    await run();

    expect(sent.map((m) => m.text)).toEqual(["A haircut is $40."]);
  });
});
