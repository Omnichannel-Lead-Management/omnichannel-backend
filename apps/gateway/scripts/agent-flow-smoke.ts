import { createServer } from "node:http";

interface JsonEvent {
  [key: string]: unknown;
}

class WsTestClient {
  readonly label: string;
  private ws: WebSocket;
  private queue: JsonEvent[] = [];
  private waiters: Array<(event: JsonEvent) => void> = [];

  private constructor(label: string, ws: WebSocket) {
    this.label = label;
    this.ws = ws;
  }

  static async connect(url: string, label: string): Promise<WsTestClient> {
    const ws = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out opening websocket for ${label}`)), 10000);

      ws.onopen = () => {
        clearTimeout(timeout);
        resolve();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Failed to open websocket for ${label}`));
      };
    });

    const client = new WsTestClient(label, ws);

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;

      try {
        const parsed = JSON.parse(event.data) as JsonEvent;
        client.pushEvent(parsed);
      } catch {
        // Ignore malformed test events
      }
    };

    return client;
  }

  send(payload: JsonEvent): void {
    this.ws.send(JSON.stringify(payload));
  }

  async waitFor(
    predicate: (event: JsonEvent) => boolean,
    timeoutMs: number,
    description: string
  ): Promise<JsonEvent> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const queueIndex = this.queue.findIndex(predicate);
      if (queueIndex >= 0) {
        const [match] = this.queue.splice(queueIndex, 1);
        return match;
      }

      const remaining = Math.max(1, deadline - Date.now());
      const nextEvent = await this.nextEvent(remaining);
      if (predicate(nextEvent)) {
        return nextEvent;
      }
    }

    throw new Error(`Timeout waiting for ${description} on ${this.label}`);
  }

  close(): void {
    try {
      this.ws.close(1000, "test done");
    } catch {
      // Ignore close errors in smoke tests
    }
  }

  private pushEvent(event: JsonEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(event);
      return;
    }

    this.queue.push(event);
  }

  private async nextEvent(timeoutMs: number): Promise<JsonEvent> {
    if (this.queue.length > 0) {
      const event = this.queue.shift();
      if (!event) throw new Error(`Unexpected empty queue for ${this.label}`);
      return event;
    }

    return await new Promise<JsonEvent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.indexOf(resolver);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for websocket event on ${this.label}`));
      }, timeoutMs);

      const resolver = (event: JsonEvent) => {
        clearTimeout(timeout);
        resolve(event);
      };

      this.waiters.push(resolver);
    });
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until timeout
    }

    await Bun.sleep(300);
  }

  throw new Error(`Timed out waiting for health endpoint at ${url}`);
}

async function startMockRoutingServer(port: number) {
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/chat") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
      // fall back to empty payload
    }

    const message = typeof payload.message === "string" ? payload.message : "";
    const escalated = message.includes("[[escalate]]");

    const responseBody = {
      success: true,
      escalated,
      messages: [
        {
          type: "text",
          text: escalated
            ? "Escalation requested. A human agent will take over."
            : `AI reply: ${message}`
        }
      ]
    };

    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(responseBody));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  return server;
}

async function run(): Promise<void> {
  const orchestratorPort = Number(process.env.SMOKE_ORCH_PORT || 3010);
  const routingPort = Number(process.env.SMOKE_ROUTING_PORT || 3999);

  const authToken1 = "smoke-token-1";
  const authToken2 = "smoke-token-2";

  const orchestratorUrl = `http://127.0.0.1:${orchestratorPort}`;
  const agentsWsUrl = `ws://127.0.0.1:${orchestratorPort}/ws/agents`;
  const userWsUrl = `ws://127.0.0.1:${orchestratorPort}/ws/chat`;

  const dbPath = `/tmp/orchestrator-smoke-${Date.now()}.db`;
  const orchestratorDir = process.cwd();

  const mockServer = await startMockRoutingServer(routingPort);
  console.log(`✅ Mock routing agent started on :${routingPort}`);

  const orchestratorProc = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: orchestratorDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(orchestratorPort),
      ROUTING_AGENT_URL: `http://127.0.0.1:${routingPort}/chat`,
      DATABASE_PATH: dbPath,
      AGENT_AUTH_MODE: "static",
      AGENT_AUTH_TOKENS: `${authToken1},${authToken2}`,
      ADMIN_DEESCALATE_KEY: ""
    },
    stdout: "pipe",
    stderr: "pipe"
  });

  const verbose = process.env.SMOKE_VERBOSE === "1";
  if (verbose && orchestratorProc.stdout) {
    void (async () => {
      const text = await new Response(orchestratorProc.stdout).text();
      console.log(text);
    })();
  }

  if (verbose && orchestratorProc.stderr) {
    void (async () => {
      const text = await new Response(orchestratorProc.stderr).text();
      console.error(text);
    })();
  }

  let agent1: WsTestClient | null = null;
  let agent2: WsTestClient | null = null;
  let user: WsTestClient | null = null;

  try {
    await waitForHealth(`${orchestratorUrl}/api/messaging/health`, 25000);
    console.log("✅ Orchestrator is healthy");

    agent1 = await WsTestClient.connect(agentsWsUrl, "agent-1");
    agent2 = await WsTestClient.connect(agentsWsUrl, "agent-2");

    agent1.send({ type: "register", token: authToken1, agent_id: "agent_1", agent_name: "Agent One" });
    agent2.send({ type: "register", token: authToken2, agent_id: "agent_2", agent_name: "Agent Two" });

    const agent1Registered = await agent1.waitFor(
      (event) => event.type === "registered" && event.agent_id === "agent_1",
      10000,
      "agent-1 registration"
    );
    assert(agent1Registered.connected_agents !== undefined, "agent-1 did not receive connected agent count");

    await agent2.waitFor(
      (event) => event.type === "registered" && event.agent_id === "agent_2",
      10000,
      "agent-2 registration"
    );
    console.log("✅ Agents registered");

    user = await WsTestClient.connect(userWsUrl, "web-user");
    const userConnected = await user.waitFor(
      (event) => event.type === "connected" && typeof event.session_id === "string",
      10000,
      "web user connection"
    );

    const messengerId = userConnected.session_id as string;
    assert(messengerId.startsWith("web_"), "unexpected web messenger session id");

    user.send({ message: "[[escalate]] I need human support" });

    await user.waitFor(
      (event) => event.type === "message" && typeof event.text === "string",
      10000,
      "initial AI/escalation response"
    );

    const queuedSnapshot = await agent1.waitFor(
      (event) => {
        if (event.type !== "queue_snapshot" || !Array.isArray(event.chats)) return false;
        return event.chats.some((chat) => {
          if (!chat || typeof chat !== "object") return false;
          const row = chat as Record<string, unknown>;
          return row.platform === "web" && row.messenger_id === messengerId;
        });
      },
      10000,
      "queued chat visibility"
    );
    assert(queuedSnapshot.type === "queue_snapshot", "queue snapshot not received");
    console.log("✅ Escalated chat visible in queue");

    agent1.send({ type: "claim_chat", platform: "web", messenger_id: messengerId });
    const claim1 = await agent1.waitFor(
      (event) => event.type === "claim_result" && event.messenger_id === messengerId,
      10000,
      "agent-1 claim result"
    );
    assert(claim1.success === true, "agent-1 failed to claim chat");

    agent2.send({ type: "claim_chat", platform: "web", messenger_id: messengerId });
    const claim2 = await agent2.waitFor(
      (event) => event.type === "claim_result" && event.messenger_id === messengerId,
      10000,
      "agent-2 claim result"
    );
    assert(claim2.success === false, "agent-2 should not be able to claim already claimed chat");
    console.log("✅ Claim locking works");

    agent1.send({
      type: "send_message",
      platform: "web",
      messenger_id: messengerId,
      message: "Hello from human agent"
    });

    const sendResult = await agent1.waitFor(
      (event) => event.type === "send_result" && event.messenger_id === messengerId,
      10000,
      "agent send result"
    );
    assert(sendResult.success === true, "agent send failed");

    const userAgentReply = await user.waitFor(
      (event) => event.type === "message" && event.text === "Hello from human agent",
      10000,
      "user receives human agent message"
    );
    assert(userAgentReply.type === "message", "user did not receive agent reply");
    console.log("✅ Agent-to-user messaging works");

    agent1.send({ type: "release_chat", platform: "web", messenger_id: messengerId });
    const releaseResult = await agent1.waitFor(
      (event) => event.type === "release_result" && event.messenger_id === messengerId,
      10000,
      "release result"
    );
    assert(releaseResult.success === true, "release failed");
    console.log("✅ Release works");

    user.send({ message: "Back to AI now" });
    const postReleaseReply = await user.waitFor(
      (event) => event.type === "message" && typeof event.text === "string" && (event.text as string).includes("AI reply:"),
      10000,
      "AI response after release"
    );
    assert(postReleaseReply.type === "message", "AI did not resume after release");

    console.log("✅ Smoke test passed: escalation, claim lock, agent reply, release, AI resume");
  } finally {
    if (agent1) agent1.close();
    if (agent2) agent2.close();
    if (user) user.close();

    orchestratorProc.kill();
    await orchestratorProc.exited;

    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  }
}

run().catch((error) => {
  console.error(`❌ Smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
