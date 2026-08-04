import { describe, expect, test } from "bun:test";

/**
 * Vertex exhausts on-demand capacity per model, so a 429 on one model says
 * nothing about the others. These tests pin the retry-then-fallback behaviour
 * that keeps a customer message alive through that.
 *
 * genaiClient builds its client at import time and throws without credentials,
 * so a placeholder key is set before the dynamic import. Every test injects a
 * fake client, so this key is never used for a request.
 */
process.env.GEMINI_API_KEY ||= "test-key-never-used-fake-client-injected";
process.env.GOOGLE_GENAI_USE_VERTEXAI ??= "false";

const { generateContentWithFallback, isTransientGenAiError } = await import("./genaiClient");

function fakeClient(behaviour: Record<string, "ok" | Error | Error[]>) {
  const calls: string[] = [];
  const remaining = new Map<string, Error[]>();
  for (const [model, b] of Object.entries(behaviour)) {
    if (Array.isArray(b)) remaining.set(model, [...b]);
  }

  return {
    calls,
    client: {
      models: {
        generateContent: async ({ model }: { model: string }) => {
          calls.push(model);
          const b = behaviour[model];
          if (b === "ok") return { candidates: [{ content: { parts: [{ text: `${model}!` }] } }] };
          if (Array.isArray(b)) {
            const next = remaining.get(model)!.shift();
            if (next) throw next;
            return { candidates: [{ content: { parts: [{ text: `${model}!` }] } }] };
          }
          throw b;
        }
      }
    } as any
  };
}

const err = (message: string, status?: string) =>
  Object.assign(new Error(message), status ? { status } : {});

const opts = (client: any, models: string[]) => ({
  client,
  models,
  wait: async () => {},
  log: () => {},
  attemptsPerModel: 2
});

describe("isTransientGenAiError", () => {
  test("capacity and upstream blips are retryable", () => {
    expect(isTransientGenAiError(err("429 RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isTransientGenAiError(err("Service Unavailable", "503"))).toBe(true);
    expect(isTransientGenAiError(err("fetch failed"))).toBe(true);
  });

  test("client and auth errors are not retryable", () => {
    // Retrying these burns the customer's latency budget on doomed calls.
    expect(isTransientGenAiError(err("404 NOT_FOUND: model unavailable"))).toBe(false);
    expect(isTransientGenAiError(err("403 PERMISSION_DENIED"))).toBe(false);
    expect(isTransientGenAiError(err("400 INVALID_ARGUMENT"))).toBe(false);
  });

  test("BILLING_DISABLED is a 403 and must not be retried", () => {
    expect(
      isTransientGenAiError(err("This API method requires billing to be enabled", "PERMISSION_DENIED"))
    ).toBe(false);
  });
});

describe("generateContentWithFallback", () => {
  test("uses the first model when it works", async () => {
    const { client, calls } = fakeClient({ a: "ok", b: "ok" });
    const res = await generateContentWithFallback({ contents: [] } as any, opts(client, ["a", "b"]));
    expect(calls).toEqual(["a"]);
    expect(res.candidates?.[0]?.content?.parts?.[0]?.text).toBe("a!");
  });

  test("retries the same model before moving on", async () => {
    const { client, calls } = fakeClient({ a: [err("429 RESOURCE_EXHAUSTED")], b: "ok" });
    const res = await generateContentWithFallback({ contents: [] } as any, opts(client, ["a", "b"]));
    expect(calls).toEqual(["a", "a"]);
    expect(res.candidates?.[0]?.content?.parts?.[0]?.text).toBe("a!");
  });

  test("falls through to the next model when one is out of capacity", async () => {
    // The real 2026-08-04 shape: flash 0/3 while flash-lite answered every call.
    const { client, calls } = fakeClient({
      "gemini-2.5-flash": err("429 RESOURCE_EXHAUSTED"),
      "gemini-2.5-flash-lite": "ok"
    });
    const res = await generateContentWithFallback(
      { contents: [] } as any,
      opts(client, ["gemini-2.5-flash", "gemini-2.5-flash-lite"])
    );
    expect(calls).toEqual(["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    expect(res.candidates?.[0]?.content?.parts?.[0]?.text).toBe("gemini-2.5-flash-lite!");
  });

  test("a permanent error aborts immediately without touching other models", async () => {
    const { client, calls } = fakeClient({ a: err("403 PERMISSION_DENIED"), b: "ok" });
    await expect(
      generateContentWithFallback({ contents: [] } as any, opts(client, ["a", "b"]))
    ).rejects.toThrow("403");
    expect(calls).toEqual(["a"]);
  });

  test("throws the last error when every model is exhausted", async () => {
    const { client, calls } = fakeClient({
      a: err("429 RESOURCE_EXHAUSTED"),
      b: err("429 RESOURCE_EXHAUSTED")
    });
    await expect(
      generateContentWithFallback({ contents: [] } as any, opts(client, ["a", "b"]))
    ).rejects.toThrow("RESOURCE_EXHAUSTED");
    expect(calls).toEqual(["a", "a", "b", "b"]);
  });

  test("backs off between attempts on the same model", async () => {
    const delays: number[] = [];
    const { client } = fakeClient({ a: [err("429"), err("429")], b: "ok" });
    await generateContentWithFallback({ contents: [] } as any, {
      client,
      models: ["a", "b"],
      attemptsPerModel: 3,
      wait: async (ms: number) => {
        delays.push(ms);
      },
      log: () => {}
    });
    expect(delays).toEqual([250, 500]);
  });
});
