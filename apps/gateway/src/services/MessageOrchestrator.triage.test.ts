import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { AIRequestPayload } from "../platforms/PlatformAdapter";

const noopChain: any = new Proxy(function () {} as any, {
  get: (_t, prop) => (prop === "then" ? undefined : () => noopChain),
  apply: () => noopChain
});

let updates: Array<Record<string, unknown>> = [];

mock.module("../db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({
            then: (resolve: (value: unknown) => unknown) => resolve(undefined),
            returning: async () => [{ id: 1 }]
          })
        };
      }
    }),
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

/** Run one escalating turn and return the columns written to the messenger row. */
async function queueWith(body: unknown): Promise<Record<string, unknown>> {
  const orchestrator = new MessageOrchestrator();
  (orchestrator as any).resolveAdapter = async () => ({
    sendMessage: async () => ({ success: true })
  });
  (orchestrator as any).saveReply = async () => undefined;

  const payload = {
    platform: "web",
    messenger_id: "cust_1",
    message: "I was charged twice for my booking",
    business_id: "biz_default",
    language: "en"
  } as AIRequestPayload;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => body
  })) as any;

  try {
    await (orchestrator as any).forwardToAI(payload, false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const queued = updates.find((row) => row.is_escalated === 1);
  expect(queued).toBeDefined();
  return queued!;
}

describe("escalation triage metadata", () => {
  beforeEach(() => {
    updates = [];
  });

  test("top-level tag and summary are stored on the messenger row", async () => {
    const queued = await queueWith({
      success: true,
      escalated: true,
      escalation_tag: "billing",
      escalation_summary: "Charged twice for one booking, wants a refund.",
      messages: []
    });

    expect(queued.escalation_tag).toBe("billing");
    expect(queued.escalation_summary).toBe("Charged twice for one booking, wants a refund.");
  });

  test("routing metadata fills the card when the top-level keys are absent", async () => {
    const queued = await queueWith({
      success: true,
      escalated: true,
      routing: {
        intent: "service_inquiry",
        summary: "Customer reports a duplicate charge on their booking.",
        reasoning: "billing complaint",
        language: "english"
      },
      messages: []
    });

    expect(queued.escalation_tag).toBe("service_inquiry");
    expect(queued.escalation_summary).toBe(
      "Customer reports a duplicate charge on their booking."
    );
  });

  test("the customer's own words are the last-resort summary", async () => {
    const queued = await queueWith({ success: true, escalated: true, messages: [] });

    expect(queued.escalation_tag).toBeNull();
    expect(queued.escalation_summary).toBe("I was charged twice for my booking");
  });
});
