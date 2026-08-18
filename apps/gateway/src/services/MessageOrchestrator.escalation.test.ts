import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { IncomingMessage } from "../platforms/PlatformAdapter";

/**
 * Escalation only queues a chat for a human. The AI keeps answering until an
 * agent claims it, and answers again the moment the agent releases it — these
 * tests pin that handover boundary.
 *
 * The DB and agent hub are stubbed so the routing branch can run without a live
 * Postgres or a connected agent socket.
 */

const updates: Array<Record<string, unknown>> = [];

const noopChain: any = new Proxy(function () {} as any, {
  get: (_t, prop) => (prop === "then" ? undefined : () => noopChain),
  apply: () => noopChain
});

mock.module("../db", () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return {
            then: (resolve: (value: unknown) => unknown) => resolve(undefined),
            returning: async () => [{ id: 1 }]
          };
        }
      })
    }),
    select: () => noopChain,
    insert: () => ({ values: async () => undefined })
  },
  schema: { messengers: {}, chatMessages: {} }
}));

const connectedAgents = new Set<string>();
const hubCalls: string[] = [];

mock.module("./AgentHub", () => ({
  agentHub: {
    isAgentConnected: (agent_id?: string | null) => Boolean(agent_id && connectedAgents.has(agent_id)),
    hasConnectedAgents: () => connectedAgents.size > 0,
    handleEscalatedUserMessage: async () => {
      hubCalls.push("handleEscalatedUserMessage");
    },
    notifyConversationQueued: async () => {
      hubCalls.push("notifyConversationQueued");
    },
    notifyConversationDeEscalated: async () => {
      hubCalls.push("notifyConversationDeEscalated");
    }
  }
}));

const { MessageOrchestrator } = await import("./MessageOrchestrator");

type MessengerRow = {
  is_escalated: number;
  escalation_status: string;
  claimed_by_agent_id: string | null;
  preferred_language?: string;
};

function harness(messenger: MessengerRow) {
  const sent: string[] = [];
  const forwarded: string[] = [];
  const orchestrator = new MessageOrchestrator();

  (orchestrator as any).getMessengerInfo = async () => messenger;
  (orchestrator as any).upsertMessenger = async () => undefined;
  (orchestrator as any).saveMessage = async () => undefined;
  (orchestrator as any).getChatHistory = async () => [];
  (orchestrator as any).saveReply = async () => undefined;
  (orchestrator as any).resolveAdapter = async () => ({
    sendMessage: async (_id: string, text: string) => {
      sent.push(text);
      return { success: true };
    }
  });
  (orchestrator as any).forwardToAI = async (payload: { message: string }) => {
    forwarded.push(payload.message);
  };

  const payload = {
    platform: "web",
    messenger_id: "cust_1",
    message: "any update on my refund?",
    business_id: "biz_default",
    language: "en"
  } as IncomingMessage;

  return {
    sent,
    forwarded,
    run: () => orchestrator.processIncomingMessage(payload)
  };
}

beforeEach(() => {
  updates.length = 0;
  hubCalls.length = 0;
  connectedAgents.clear();
});

describe("human handover boundary", () => {
  test("a queued but unclaimed chat is still answered by the AI", async () => {
    // The escalation is only a request for a human; muting the bot here left
    // customers waiting in silence for an agent who had not arrived yet.
    connectedAgents.add("agent_1");
    const { run, forwarded } = harness({
      is_escalated: 1,
      escalation_status: "queued",
      claimed_by_agent_id: null
    });

    await run();

    expect(forwarded).toEqual(["any update on my refund?"]);
    // The agent queue still sees the traffic live.
    expect(hubCalls).toContain("handleEscalatedUserMessage");
  });

  test("a claimed chat goes to the human agent instead of the AI", async () => {
    connectedAgents.add("agent_1");
    const { run, forwarded } = harness({
      is_escalated: 1,
      escalation_status: "claimed",
      claimed_by_agent_id: "agent_1"
    });

    await run();

    expect(forwarded).toEqual([]);
    expect(hubCalls).toContain("handleEscalatedUserMessage");
  });

  test("a released chat goes back to the AI", async () => {
    // releaseChat clears the escalation columns, so the next message is an
    // ordinary bot conversation again.
    const { run, forwarded } = harness({
      is_escalated: 0,
      escalation_status: "none",
      claimed_by_agent_id: null
    });

    await run();

    expect(forwarded).toEqual(["any update on my refund?"]);
    expect(hubCalls).toEqual([]);
  });

  test("a claim held by a disconnected agent returns to the queue and the AI", async () => {
    const { run, forwarded, sent } = harness({
      is_escalated: 1,
      escalation_status: "claimed",
      claimed_by_agent_id: "agent_gone"
    });

    await run();

    expect(updates[0]).toMatchObject({
      escalation_status: "queued",
      claimed_by_agent_id: null
    });
    // Still escalated — another agent can pick it up.
    expect(updates[0]).not.toHaveProperty("is_escalated");
    expect(hubCalls).toContain("notifyConversationQueued");
    expect(sent.some((text) => text.includes("keep helping you"))).toBe(true);
    expect(forwarded).toEqual(["any update on my refund?"]);
  });
});
