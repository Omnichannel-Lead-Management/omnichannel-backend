import type { AgentMessage, PlatformAdapter, PlatformCapabilities } from "./PlatformAdapter";
import type { ServerWebSocket } from "bun";

/**
 * WebAdapter
 *
 * Handles web chat via WebSocket connections.
 * Each web user gets a unique session ID.
 * All interactive features are fully supported — the client receives the raw
 * structured message and renders buttons/lists itself.
 */
export class WebAdapter implements PlatformAdapter {
  readonly name = "web";

  /** Web clients receive structured JSON so every feature is available. */
  readonly capabilities: PlatformCapabilities = {
    quick_replies: true,
    url_buttons: true,
    lists: true,
    max_quick_replies: null
  };

  private connections: Map<string, ServerWebSocket<{ session_id: string }>>;

  constructor() {
    this.connections = new Map();
  }

  /** Send a plain text message */
  async sendMessage(
    messenger_id: string,
    message: string,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const ws = this.connections.get(messenger_id);

      if (!ws || ws.readyState !== 1) {
        console.warn(`⚠️  WebSocket not connected for session: ${messenger_id}`);
        return { success: false, error: "WebSocket connection not found or closed" };
      }

      ws.send(JSON.stringify({
        type: "message",
        text: message,
        timestamp: new Date().toISOString(),
        metadata
      }));

      console.log(`✅ Web message sent to session ${messenger_id}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send web message:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Send an interactive message.
   * The full structured object is forwarded to the client via WebSocket so the
   * frontend can render native buttons, lists, and URL buttons.
   */
  async sendInteractive(
    messenger_id: string,
    message: Extract<AgentMessage, { type: "interactive" }>,
    metadata?: Record<string, any>
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const ws = this.connections.get(messenger_id);

      if (!ws || ws.readyState !== 1) {
        console.warn(`⚠️  WebSocket not connected for session: ${messenger_id}`);
        return { success: false, error: "WebSocket connection not found or closed" };
      }

      ws.send(JSON.stringify({
        type: "interactive",
        text: message.text,
        quick_replies: message.quick_replies ?? [],
        url_buttons: message.url_buttons ?? [],
        list: message.list ?? null,
        timestamp: new Date().toISOString()
      }));

      console.log(`✅ Web interactive message sent to session ${messenger_id}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send web interactive message:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /** Send a photo */
  async sendPhoto(
    messenger_id: string,
    url: string,
    caption?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const ws = this.connections.get(messenger_id);

      if (!ws || ws.readyState !== 1) {
        return { success: false, error: "WebSocket connection not found or closed" };
      }

      ws.send(JSON.stringify({
        type: "photo",
        url,
        caption,
        timestamp: new Date().toISOString()
      }));

      console.log(`✅ Web photo sent to session ${messenger_id}`);
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`❌ Failed to send web photo:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /** Register a WebSocket connection */
  registerConnection(session_id: string, ws: ServerWebSocket<{ session_id: string }>): void {
    this.connections.set(session_id, ws);
    console.log(`🔌 Web session connected: ${session_id} (Total: ${this.connections.size})`);
  }

  /** Unregister a WebSocket connection */
  unregisterConnection(session_id: string): void {
    this.connections.delete(session_id);
    console.log(`🔌 Web session disconnected: ${session_id} (Total: ${this.connections.size})`);
  }

  getActiveConnections(): number {
    return this.connections.size;
  }

  validateMessengerId(messenger_id: string): boolean {
    return /^web_[a-zA-Z0-9_-]+$/.test(messenger_id);
  }

  async initialize(): Promise<void> {
    console.log("✅ Web adapter initialized");
  }
}

/** Generate a unique session ID for web users */
export function generateWebSessionId(): string {
  return `web_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
