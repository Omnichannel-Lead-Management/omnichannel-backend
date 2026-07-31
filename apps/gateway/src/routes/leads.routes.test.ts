import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// A stand-in Lead Manager, so these tests cover the proxy's behaviour rather
// than the real service's. Started before the route module is imported because
// leads.routes.ts reads LEAD_MANAGER_URL once at module scope.
const PORT = 3400 + Math.floor(Math.random() * 300);
const received: Array<{ method: string; path: string; body: string }> = [];

const upstream = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const body = req.method === "GET" ? "" : await req.text();
    received.push({ method: req.method, path: `${url.pathname}${url.search}`, body });

    if (url.pathname === "/api/leads" && req.method === "GET") {
      return Response.json({
        success: true,
        count: 1,
        leads: [{ id: "lead_1", business_id: url.searchParams.get("businessId"), score: 65 }]
      });
    }
    if (url.pathname === "/api/leads/lead_missing") {
      return Response.json({ success: false, error: "Lead not found" }, { status: 404 });
    }
    if (url.pathname === "/api/leads/lead_1" && req.method === "PATCH") {
      return Response.json({ success: false, error: "Invalid status transition" }, { status: 400 });
    }
    return Response.json({ success: true });
  }
});

process.env.LEAD_MANAGER_URL = `http://127.0.0.1:${PORT}`;
const { leadsRoutes } = await import("./leads.routes");

afterAll(() => upstream.stop(true));

const call = (path: string, init?: RequestInit) =>
  leadsRoutes.handle(new Request(`http://localhost${path}`, init));

describe("leads proxy", () => {
  beforeAll(() => {
    received.length = 0;
  });

  test("forwards the tenant filter to lead-manager", async () => {
    const res = await call("/api/leads?businessId=biz_a&status=new");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { leads: Array<{ business_id: string }> };
    expect(body.leads[0]?.business_id).toBe("biz_a");

    const forwarded = received.find((r) => r.path.startsWith("/api/leads?"));
    expect(forwarded?.path).toContain("businessId=biz_a");
    expect(forwarded?.path).toContain("status=new");
  });

  test("passes an upstream 404 through instead of flattening it to 200", async () => {
    const res = await call("/api/leads/lead_missing?businessId=biz_a");
    expect(res.status).toBe(404);
  });

  test("passes an invalid transition 400 through with its message", async () => {
    const res = await call("/api/leads/lead_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: "biz_a", status: "new" })
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Invalid status transition");
  });

  test("stream requires businessId rather than opening a tenant-less feed", async () => {
    const res = await call("/api/leads/stream");
    expect(res.status).toBe(400);
  });

  test("an unreachable lead-manager is a 502, never an empty lead list", async () => {
    process.env.LEAD_MANAGER_URL = "http://127.0.0.1:9";
    const isolated = await import("./leads.routes?unreachable");
    const res = await isolated.leadsRoutes.handle(
      new Request("http://localhost/api/leads?businessId=biz_a")
    );
    process.env.LEAD_MANAGER_URL = `http://127.0.0.1:${PORT}`;

    expect(res.status).toBe(502);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain("Lead Manager unreachable");
  });
});
