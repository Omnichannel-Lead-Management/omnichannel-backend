import { describe, expect, test, mock, beforeEach } from "bun:test";

const noopChain: any = new Proxy(function () {} as any, {
  get: (_t, prop) => (prop === "then" ? undefined : () => noopChain),
  apply: () => noopChain
});

mock.module("../db", () => ({
  db: {
    update: () => ({ set: () => ({ where: () => ({ then: (r: any) => r(undefined), returning: async () => [] }) }) }),
    select: () => noopChain,
    insert: () => ({ values: async () => undefined })
  },
  schema: { messengers: {}, chatMessages: {} }
}));

type Mirrored = { from: string; text: string; platform: string; messenger_id: string };
const mirrored: Mirrored[] = [];

mock.module("./AgentHub", () => ({
  agentHub: {
    isAgentConnected: () => false,
    hasConnectedAgents: () => false,
    notifyConversationQueued: async () => undefined,
    notifyConversationDeEscalated: async () => undefined,
    notifyConversationMessage: async (payload: Mirrored) => {
      mirrored.push(payload);
    }
  }
}));

const { MessageOrchestrator } = await import("./MessageOrchestrator");

beforeEach(() => {
  mirrored.length = 0;
});

describe("live inbox mirroring", () => {
  test("the bot's own reply is mirrored to the dashboard", async () => {
    // Without this the agent watching a chat sees the customer's half only.
    const orchestrator = new MessageOrchestrator();

    await orchestrator.saveReply("cust_1", "telegram", "It's Rs.1000", undefined, "biz_a");

    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]).toMatchObject({
      platform: "telegram",
      messenger_id: "cust_1",
      from: "ai",
      text: "It's Rs.1000"
    });
  });

  test("an ordinary bot conversation still mirrors the customer's message", async () => {
    const orchestrator = new MessageOrchestrator();
    (orchestrator as any).getMessengerInfo = async () => ({
      is_escalated: 0,
      escalation_status: "none",
      claimed_by_agent_id: null
    });
    (orchestrator as any).upsertMessenger = async () => undefined;
    (orchestrator as any).saveMessage = async () => undefined;
    (orchestrator as any).getChatHistory = async () => [];
    (orchestrator as any).saveReply = async () => undefined;
    (orchestrator as any).resolveAdapter = async () => ({ sendMessage: async () => ({ success: true }) });
    (orchestrator as any).forwardToAI = async () => undefined;

    await orchestrator.processIncomingMessage({
      platform: "telegram",
      messenger_id: "cust_1",
      message: "what time do you open?",
      business_id: "biz_a",
      language: "en"
    } as any);

    // The escalation state must not decide whether the inbox sees the message.
    expect(mirrored.map((m) => [m.from, m.text])).toEqual([
      ["user", "what time do you open?"]
    ]);
  });
});
