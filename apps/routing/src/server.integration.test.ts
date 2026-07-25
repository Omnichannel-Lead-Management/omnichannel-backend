import { afterAll, describe, expect, test } from "bun:test";

const PORT = 3099 + Math.floor(Math.random() * 200);
let proc: ReturnType<typeof Bun.spawn> | null = null;

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch (err) {
      lastError = err;
    }
    await Bun.sleep(200);
  }
  throw new Error(`Health check timed out: ${String(lastError)}`);
}

describe("routing service integration", () => {
  test("GET /health returns agent status map", async () => {
    proc = Bun.spawn(["bun", "run", "src/index.ts"], {
      cwd: `${import.meta.dir}/..`,
      env: {
        ...process.env,
        PORT: String(PORT),
        GEMINI_API_KEY: "test-key-not-used-for-health",
        CHATBOT_ENGINE_URL: "http://127.0.0.1:9",
        LEAD_MANAGER_URL: "http://127.0.0.1:9",
        APPOINTMENT_SERVICE_URL: "http://127.0.0.1:9"
      },
      stdout: "ignore",
      stderr: "ignore"
    });

    const res = await waitForHealth(`http://127.0.0.1:${PORT}/health`);
    const body = (await res.json()) as {
      status: string;
      agents: Record<string, string>;
    };

    expect(body.status === "ok" || body.status === "degraded").toBe(true);
    expect(body.agents.service_inquiry).toBeDefined();
    expect(body.agents.appointment_booking).toBeDefined();
    expect(body.agents.lead_qualification).toBeDefined();
  });
});

afterAll(() => {
  proc?.kill();
  proc = null;
});
