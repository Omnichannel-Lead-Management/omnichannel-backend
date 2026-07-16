import type { ServerWebSocket } from "bun";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { getPlatformAdapter } from "../platforms";
import { getBusinessById, resolveAdapterForBusiness } from "./BusinessRegistry";

interface AgentSocketData {
  agent_id?: string;
}

interface AgentRegistrationPayload {
  agent_id?: string;
  agent_name?: string;
  /** Business this agent is scoped to. Undefined = "super agent" (sees/acts on every business). */
  business_id?: string;
}

export interface AgentHistoryEntry {
  id: number;
  from: "user" | "ai" | "agent";
  text: string;
  timestamp: string;
  agent_id?: string;
}

export interface AgentHistoryPage {
  history: AgentHistoryEntry[];
  next_cursor: number | null;
  has_more: boolean;
}

export interface EscalatedChatSummary {
  messenger_id: string;
  platform: string;
  business_id: string;
  display_name: string;
  escalation_status: "queued" | "claimed";
  claimed_by_agent_id: string | null;
  escalation_requested_at: string | null;
  claimed_at: string | null;
  updated_at: string | null;
  escalation_tag: string | null;
  escalation_summary: string | null;
}

interface AgentConnection {
  agent_id: string;
  agent_name: string;
  /** Undefined = super agent (sees/acts on every business). */
  business_id?: string;
  ws: ServerWebSocket<AgentSocketData>;
  connected_at: string;
}

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export class AgentHub {
  private agents = new Map<string, AgentConnection>();

  registerAgent(
    ws: ServerWebSocket<AgentSocketData>,
    payload: AgentRegistrationPayload
  ): { agent_id: string; agent_name: string; business_id?: string } {
    let agent_id = payload.agent_id?.trim();
    if (!agent_id) {
      agent_id = this.generateAgentId();
    }

    const agent_name = payload.agent_name?.trim() || agent_id;
    const business_id = payload.business_id?.trim() || undefined;

    const existing = this.agents.get(agent_id);
    if (existing) {
      this.sendRaw(existing.ws, {
        type: "session_replaced",
        message: "You were disconnected because this agent ID connected from another session."
      });

      try {
        existing.ws.close(4001, "Session replaced");
      } catch {
        // Ignore close errors
      }

      this.agents.delete(agent_id);
    }

    ws.data.agent_id = agent_id;

    this.agents.set(agent_id, {
      agent_id,
      agent_name,
      business_id,
      ws,
      connected_at: new Date().toISOString()
    });

    this.sendRaw(ws, {
      type: "registered",
      agent_id,
      agent_name,
      business_id: business_id ?? null,
      connected_agents: this.getConnectedAgentCount()
    });

    this.broadcastPresence();

    return { agent_id, agent_name, business_id };
  }

  unregisterSocket(ws: ServerWebSocket<AgentSocketData>): void {
    const agent_id = ws.data.agent_id;
    if (!agent_id) return;

    if (this.agents.delete(agent_id)) {
      this.broadcastPresence();
    }
  }

  /** Whether any agent is online who could handle this business's chats (a super agent, or one scoped to it). */
  hasConnectedAgents(business_id?: string): boolean {
    if (!business_id) return this.agents.size > 0;

    for (const connection of this.agents.values()) {
      if (connection.business_id === undefined || connection.business_id === business_id) {
        return true;
      }
    }
    return false;
  }

  getConnectedAgentCount(): number {
    return this.agents.size;
  }

  /** True if this agent (super agent, or one scoped to business_id) may act on that business's chats. */
  private isAuthorizedForBusiness(agent_id: string, business_id: string): boolean {
    const connection = this.agents.get(agent_id);
    if (!connection) return false;
    return connection.business_id === undefined || connection.business_id === business_id;
  }

  async getEscalatedQueue(business_id?: string): Promise<EscalatedChatSummary[]> {
    return await this.getEscalatedChats(business_id);
  }

  async sendQueueSnapshotToAgent(agent_id: string): Promise<void> {
    const connection = this.agents.get(agent_id);
    if (!connection) return;

    const chats = await this.getEscalatedChats(connection.business_id);
    this.sendRaw(connection.ws, {
      type: "queue_snapshot",
      chats
    });
  }

  /**
   * Send every connected agent their own filtered queue snapshot — super agents see
   * every business's escalated chats, scoped agents only see their own business's.
   */
  async broadcastQueueSnapshot(): Promise<void> {
    for (const connection of this.agents.values()) {
      const chats = await this.getEscalatedChats(connection.business_id);
      this.sendRaw(connection.ws, {
        type: "queue_snapshot",
        chats
      });
    }
  }

  async claimChat(
    agent_id: string,
    platform: string,
    messenger_id: string,
    business_id?: string
  ): Promise<{
    success: boolean;
    error?: string;
    history?: AgentHistoryEntry[];
    next_cursor?: number | null;
    has_more?: boolean;
  }> {
    const normalizedPlatform = platform.toLowerCase();
    const targetBusinessId = business_id || "biz_default";

    if (!this.isAuthorizedForBusiness(agent_id, targetBusinessId)) {
      return { success: false, error: "You are not authorized to act on this business's chats." };
    }

    await db
      .update(schema.messengers)
      .set({
        escalation_status: "claimed",
        claimed_by_agent_id: agent_id,
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .where(
        and(
          eq(schema.messengers.platform, normalizedPlatform),
          eq(schema.messengers.messenger_id, messenger_id),
          eq(schema.messengers.business_id, targetBusinessId),
          eq(schema.messengers.is_escalated, 1),
          isNull(schema.messengers.claimed_by_agent_id)
        )
      );

    const conversation = await this.getMessenger(normalizedPlatform, messenger_id, targetBusinessId);
    if (!conversation || !conversation.is_escalated) {
      return { success: false, error: "Conversation is not escalated." };
    }

    if (conversation.claimed_by_agent_id !== agent_id) {
      return {
        success: false,
        error: `Conversation is already claimed by ${conversation.claimed_by_agent_id}.`
      };
    }

    const historyPage = await this.getHistory(normalizedPlatform, messenger_id, 30, undefined, targetBusinessId);

    this.broadcastToBusiness(targetBusinessId, {
      type: "chat_claimed",
      platform: normalizedPlatform,
      messenger_id,
      business_id: targetBusinessId,
      claimed_by_agent_id: agent_id
    });

    await this.broadcastQueueSnapshot();

    return {
      success: true,
      history: historyPage.history,
      next_cursor: historyPage.next_cursor,
      has_more: historyPage.has_more
    };
  }

  async releaseChat(
    agent_id: string,
    platform: string,
    messenger_id: string,
    business_id?: string
  ): Promise<{ success: boolean; error?: string }> {
    const normalizedPlatform = platform.toLowerCase();
    const targetBusinessId = business_id || "biz_default";

    if (!this.isAuthorizedForBusiness(agent_id, targetBusinessId)) {
      return { success: false, error: "You are not authorized to act on this business's chats." };
    }

    const conversation = await this.getMessenger(normalizedPlatform, messenger_id, targetBusinessId);
    if (!conversation || !conversation.is_escalated) {
      return { success: false, error: "Conversation is not escalated." };
    }

    if (conversation.claimed_by_agent_id !== agent_id) {
      return { success: false, error: "Only the claiming agent can release this conversation." };
    }

    await db
      .update(schema.messengers)
      .set({
        is_escalated: 0,
        escalation_status: "none",
        claimed_by_agent_id: null,
        claimed_at: null,
        released_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .where(
        and(
          eq(schema.messengers.platform, normalizedPlatform),
          eq(schema.messengers.messenger_id, messenger_id),
          eq(schema.messengers.business_id, targetBusinessId)
        )
      );

    const deEscalationMessage = "Your conversation with customer care is complete. You can continue chatting with the AI assistant.";
    const adapter = await this.resolveAdapter(normalizedPlatform, targetBusinessId);
    if (adapter) {
      await adapter.sendMessage(messenger_id, deEscalationMessage);
    }

    await this.saveAssistantMessage(normalizedPlatform, messenger_id, targetBusinessId, deEscalationMessage, {
      from_agent: false,
      system: true,
      type: "de_escalated"
    });

    this.broadcastToBusiness(targetBusinessId, {
      type: "chat_released",
      platform: normalizedPlatform,
      messenger_id,
      business_id: targetBusinessId,
      released_by_agent_id: agent_id
    });

    await this.broadcastQueueSnapshot();

    return { success: true };
  }

  async sendAgentMessage(
    agent_id: string,
    platform: string,
    messenger_id: string,
    message: string,
    business_id?: string
  ): Promise<{ success: boolean; error?: string }> {
    const normalizedPlatform = platform.toLowerCase();
    const targetBusinessId = business_id || "biz_default";
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return { success: false, error: "Message cannot be empty." };
    }

    if (!this.isAuthorizedForBusiness(agent_id, targetBusinessId)) {
      return { success: false, error: "You are not authorized to act on this business's chats." };
    }

    const conversation = await this.getMessenger(normalizedPlatform, messenger_id, targetBusinessId);
    if (!conversation || !conversation.is_escalated) {
      return { success: false, error: "Conversation is not escalated." };
    }

    if (conversation.claimed_by_agent_id !== agent_id) {
      return { success: false, error: "You can only send messages to chats you have claimed." };
    }

    const adapter = await this.resolveAdapter(normalizedPlatform, targetBusinessId);
    if (!adapter) {
      return { success: false, error: `No adapter found for platform: ${normalizedPlatform}` };
    }

    const result = await adapter.sendMessage(messenger_id, trimmedMessage);
    if (!result.success) {
      return { success: false, error: result.error || "Failed to send message to user." };
    }

    const timestamp = new Date().toISOString();

    await this.saveAssistantMessage(normalizedPlatform, messenger_id, targetBusinessId, trimmedMessage, {
      from_agent: true,
      agent_id
    });

    this.broadcastToBusiness(targetBusinessId, {
      type: "chat_message",
      platform: normalizedPlatform,
      messenger_id,
      business_id: targetBusinessId,
      from: "agent",
      text: trimmedMessage,
      agent_id,
      timestamp
    });

    return { success: true };
  }

  async getHistory(
    platform: string,
    messenger_id: string,
    limit: number = 200,
    cursor?: number,
    business_id?: string
  ): Promise<AgentHistoryPage> {
    const normalizedPlatform = platform.toLowerCase();
    const targetBusinessId = business_id || "biz_default";
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const safeCursor = typeof cursor === "number" && Number.isFinite(cursor) ? Math.floor(cursor) : null;

    const rows = await db
      .select()
      .from(schema.chatMessages)
      .where(
        safeCursor && safeCursor > 0
          ? and(
              eq(schema.chatMessages.platform, normalizedPlatform),
              eq(schema.chatMessages.messenger_id, messenger_id),
              eq(schema.chatMessages.business_id, targetBusinessId),
              lt(schema.chatMessages.id, safeCursor)
            )
          : and(
              eq(schema.chatMessages.platform, normalizedPlatform),
              eq(schema.chatMessages.messenger_id, messenger_id),
              eq(schema.chatMessages.business_id, targetBusinessId)
            )
      )
      .orderBy(desc(schema.chatMessages.id))
      .limit(safeLimit + 1);

    const has_more = rows.length > safeLimit;
    const pageRows = has_more ? rows.slice(0, safeLimit) : rows;
    const history: AgentHistoryEntry[] = pageRows.reverse().map((row) => {
      const metadata = safeJsonParse<{ from_agent?: boolean; agent_id?: string }>(row.metadata);
      const from: AgentHistoryEntry["from"] = row.is_from_user
        ? "user"
        : (metadata?.from_agent ? "agent" : "ai");

      return {
        id: row.id,
        from,
        text: row.message_text,
        timestamp: row.created_at || new Date().toISOString(),
        agent_id: metadata?.agent_id
      };
    });

    return {
      history,
      next_cursor: has_more && history.length > 0 ? history[0]!.id : null,
      has_more
    };
  }

  async notifyConversationQueued(platform: string, messenger_id: string, business_id?: string): Promise<void> {
    const normalizedPlatform = platform.toLowerCase();
    const targetBusinessId = business_id || "biz_default";
    const chat = await this.getEscalatedChatSummary(normalizedPlatform, messenger_id, targetBusinessId);
    if (!chat) return;

    this.broadcastToBusiness(targetBusinessId, {
      type: "chat_queued",
      chat
    });

    await this.broadcastQueueSnapshot();
  }

  async notifyConversationDeEscalated(platform: string, messenger_id: string, business_id?: string): Promise<void> {
    const targetBusinessId = business_id || "biz_default";

    this.broadcastToBusiness(targetBusinessId, {
      type: "chat_released",
      platform,
      messenger_id,
      business_id: targetBusinessId,
      released_by_agent_id: "system"
    });

    await this.broadcastQueueSnapshot();
  }

  async handleEscalatedUserMessage(payload: {
    platform: string;
    messenger_id: string;
    business_id?: string;
    text: string;
    timestamp?: string;
  }): Promise<void> {
    const targetBusinessId = payload.business_id || "biz_default";
    const conversation = await this.getMessenger(payload.platform, payload.messenger_id, targetBusinessId);
    if (!conversation || !conversation.is_escalated) {
      return;
    }

    this.broadcastToBusiness(targetBusinessId, {
      type: "chat_message",
      platform: payload.platform,
      messenger_id: payload.messenger_id,
      business_id: targetBusinessId,
      from: "user",
      text: payload.text,
      timestamp: payload.timestamp || new Date().toISOString(),
      claimed_by_agent_id: conversation.claimed_by_agent_id
    });

    await this.broadcastQueueSnapshot();
  }

  /**
   * Resolve the adapter to send through for a business's escalated conversation —
   * that business's own bot credentials, falling back to the global singleton
   * (legacy single-tenant .env-based setup) if the business has none configured.
   */
  private async resolveAdapter(platform: string, business_id: string) {
    if (business_id !== "biz_default") {
      const business = await getBusinessById(business_id);
      if (business) {
        const businessAdapter = resolveAdapterForBusiness(platform, business);
        if (businessAdapter) return businessAdapter;
      }
    }

    return getPlatformAdapter(platform);
  }

  private async getEscalatedChats(business_id?: string): Promise<EscalatedChatSummary[]> {
    const rows = await db
      .select()
      .from(schema.messengers)
      .where(
        business_id
          ? and(eq(schema.messengers.is_escalated, 1), eq(schema.messengers.business_id, business_id))
          : eq(schema.messengers.is_escalated, 1)
      )
      .orderBy(desc(schema.messengers.updated_at));

    return rows.map((row) => this.mapMessengerToSummary(row));
  }

  private async getEscalatedChatSummary(
    platform: string,
    messenger_id: string,
    business_id: string
  ): Promise<EscalatedChatSummary | null> {
    const row = await this.getMessenger(platform, messenger_id, business_id);
    if (!row || !row.is_escalated) return null;

    return this.mapMessengerToSummary(row);
  }

  private mapMessengerToSummary(row: typeof schema.messengers.$inferSelect): EscalatedChatSummary {
    const nameParts = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    const display_name = row.username || nameParts || row.messenger_id;

    return {
      messenger_id: row.messenger_id,
      platform: row.platform,
      business_id: row.business_id,
      display_name,
      escalation_status: row.claimed_by_agent_id ? "claimed" : "queued",
      claimed_by_agent_id: row.claimed_by_agent_id,
      escalation_requested_at: row.escalation_requested_at,
      claimed_at: row.claimed_at,
      updated_at: row.updated_at,
      escalation_tag: row.escalation_tag ?? null,
      escalation_summary: row.escalation_summary ?? null
    };
  }

  private async getMessenger(platform: string, messenger_id: string, business_id: string) {
    return await db
      .select()
      .from(schema.messengers)
      .where(
        and(
          eq(schema.messengers.platform, platform.toLowerCase()),
          eq(schema.messengers.messenger_id, messenger_id),
          eq(schema.messengers.business_id, business_id)
        )
      )
      .then((rows) => rows[0]);
  }

  private async saveAssistantMessage(
    platform: string,
    messenger_id: string,
    business_id: string,
    message: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await db.insert(schema.chatMessages).values({
      platform,
      messenger_id,
      business_id,
      message_text: message,
      is_from_user: false,
      metadata: JSON.stringify(metadata)
    });
  }

  private broadcastPresence(): void {
    const agents = Array.from(this.agents.values()).map((connection) => ({
      agent_id: connection.agent_id,
      agent_name: connection.agent_name,
      connected_at: connection.connected_at
    }));

    this.broadcast({
      type: "agent_presence",
      connected_agents: agents.length,
      agents
    });
  }

  private broadcast(payload: Record<string, unknown>): void {
    for (const connection of this.agents.values()) {
      this.sendRaw(connection.ws, payload);
    }
  }

  /** Broadcast only to agents who may see this business (super agents + agents scoped to it). */
  private broadcastToBusiness(business_id: string, payload: Record<string, unknown>): void {
    for (const connection of this.agents.values()) {
      if (connection.business_id === undefined || connection.business_id === business_id) {
        this.sendRaw(connection.ws, payload);
      }
    }
  }

  private sendRaw(ws: ServerWebSocket<AgentSocketData>, payload: Record<string, unknown>): void {
    if (ws.readyState !== 1) return;

    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Ignore websocket send failures
    }
  }

  private generateAgentId(): string {
    return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export const agentHub = new AgentHub();
