import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const PORT = 3700 + Math.floor(Math.random() * 200);
const received: Array<{ method: string; path: string; body: string }> = [];

const upstream = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "GET" || req.method === "DELETE" ? "" : await req.text();
    received.push({ method: req.method, path: `${url.pathname}${url.search}`, body });

    if (url.pathname.endsWith("/faqs") && req.method === "GET") {
      return Response.json({
        success: true,
        faqs: [{ id: "faq_1", business_id: url.pathname.split("/")[3], question: "Hours?" }]
      });
    }
    if (url.pathname === "/api/faqs/faq_missing") {
      return Response.json({ success: false, error: "FAQ not found" }, { status: 404 });
    }
    if (url.pathname.endsWith("/config") && req.method === "PATCH") {
      const patch = JSON.parse(body) as { chatbot_enabled?: boolean };
      return Response.json({
        success: true,
        config: { business_id: "biz_a", chatbot_enabled: patch.chatbot_enabled ?? true }
      });
    }
    if (url.pathname === "/api/templates") {
      return Response.json({ success: true, templates: [{ sector: "salon" }] });
    }
    return Response.json({ success: true });
  }
});

process.env.CHATBOT_SERVICE_URL = `http://127.0.0.1:${PORT}`;
const { chatbotProxyRoutes } = await import("./chatbot.proxy.routes");

afterAll(() => upstream.stop(true));

const call = (path: string, init?: RequestInit) =>
  chatbotProxyRoutes.handle(new Request(`http://localhost${path}`, init));

const json = { "Content-Type": "application/json" };

describe("chatbot proxy", () => {
  beforeEach(() => {
    received.length = 0;
  });

  test("lists a tenant's FAQs", async () => {
    const res = await call("/api/businesses/biz_a/faqs");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { faqs: Array<{ id: string }> };
    expect(body.faqs[0]?.id).toBe("faq_1");
    expect(received[0]?.path).toBe("/api/businesses/biz_a/faqs");
  });

  test("creates an FAQ and forwards the body verbatim", async () => {
    const payload = { question: "Do you open Sundays?", answer: "No.", keywords: ["sunday"] };
    const res = await call("/api/businesses/biz_a/faqs", {
      method: "POST",
      headers: json,
      body: JSON.stringify(payload)
    });

    expect(res.status).toBe(200);
    expect(received[0]?.method).toBe("POST");
    expect(JSON.parse(received[0]!.body)).toEqual(payload);
  });

  test("replaces the whole FAQ collection over PUT", async () => {
    await call("/api/businesses/biz_a/faqs", {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ items: [] })
    });

    expect(received[0]?.method).toBe("PUT");
    expect(received[0]?.path).toBe("/api/businesses/biz_a/faqs");
  });

  test("patches and deletes an FAQ by id", async () => {
    await call("/api/faqs/faq_1", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ enabled: false })
    });
    await call("/api/faqs/faq_1", { method: "DELETE" });

    expect(received[0]?.method).toBe("PATCH");
    expect(JSON.parse(received[0]!.body)).toEqual({ enabled: false });
    expect(received[1]?.method).toBe("DELETE");
  });

  test("passes an upstream 404 through unchanged", async () => {
    const res = await call("/api/faqs/faq_missing", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ enabled: true })
    });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe("FAQ not found");
  });

  test("ids containing URL-significant characters are encoded", async () => {
    await call("/api/businesses/biz%2Fa%20%26%20b/faqs");
    expect(received[0]?.path).toBe("/api/businesses/biz%2Fa%20%26%20b/faqs");
  });

  test("reads and writes chatbot config", async () => {
    await call("/api/businesses/biz_a/config");
    const res = await call("/api/businesses/biz_a/config", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ welcome_message: "Hi!", chatbot_enabled: false })
    });

    expect(res.status).toBe(200);
    expect(received[0]?.method).toBe("GET");
    expect(JSON.parse(received[1]!.body)).toEqual({
      welcome_message: "Hi!",
      chatbot_enabled: false
    });
  });

  test("templates and flows are reachable", async () => {
    await call("/api/templates");
    await call("/api/flows?businessId=biz_a");
    await call("/api/flows/flow_1", {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ is_active: false })
    });
    await call("/api/businesses/biz_a/attach-template", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ sector: "salon" })
    });

    expect(received.map((r) => r.path)).toEqual([
      "/api/templates",
      "/api/flows?businessId=biz_a",
      "/api/flows/flow_1",
      "/api/businesses/biz_a/attach-template"
    ]);
  });
});

describe("chatbot proxy when the service is down", () => {
  test("returns 503 rather than hanging", async () => {
    process.env.CHATBOT_SERVICE_URL = "http://127.0.0.1:1";
    const { chatbotProxyRoutes: offline } = await import("./chatbot.proxy.routes?offline");

    const res = await offline.handle(
      new Request("http://localhost/api/businesses/biz_a/faqs")
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Chatbot service unreachable");
  });
});
