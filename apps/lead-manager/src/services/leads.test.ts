import { describe, expect, test, beforeAll } from "bun:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_PATH = ":memory:";
process.env.AGENT_POOL = "agentX,agentY";

const { initDatabase } = await import("../db");
const {
  createLead,
  listLeads,
  getLead,
  getActivities,
  updateLead,
  upsertLeadFromMessage,
  canTransition,
  pickAgent
} = await import("./leads");

beforeAll(async () => {
  await initDatabase();
});

describe("canTransition", () => {
  test("allows forward moves and lost from active states", () => {
    expect(canTransition("new", "contacted")).toBe(true);
    expect(canTransition("contacted", "converted")).toBe(true);
    expect(canTransition("qualified", "lost")).toBe(true);
    expect(canTransition("new", "new")).toBe(true);
  });
  test("rejects backward / terminal moves", () => {
    expect(canTransition("contacted", "new")).toBe(false);
    expect(canTransition("converted", "contacted")).toBe(false);
    expect(canTransition("lost", "qualified")).toBe(false);
  });
});

describe("createLead + activity log", () => {
  test("creates a scored lead with a lead_created activity", () => {
    const lead = createLead({
      business_id: "biz_t1",
      messenger_id: "m1",
      platform: "telegram",
      source: "chatbot",
      service_interest: "premium package"
    });
    expect(lead.status).toBe("new");
    expect(lead.score).toBe(50);
    const acts = getActivities(lead.id, "biz_t1");
    expect(acts.some((a) => a.activity_type === "lead_created")).toBe(true);
  });
});

describe("multi-tenant isolation", () => {
  test("listLeads only returns the requested business", () => {
    createLead({ business_id: "biz_A", messenger_id: "a1", platform: "web", source: "web" });
    createLead({ business_id: "biz_B", messenger_id: "b1", platform: "web", source: "web" });
    const a = listLeads({ businessId: "biz_A" });
    expect(a.every((l) => l.business_id === "biz_A")).toBe(true);
  });
  test("getLead with wrong business returns undefined", () => {
    const lead = createLead({
      business_id: "biz_X",
      messenger_id: "x1",
      platform: "web",
      source: "web"
    });
    expect(getLead(lead.id, "biz_Y")).toBeUndefined();
    expect(getLead(lead.id, "biz_X")).toBeDefined();
  });
});

describe("updateLead", () => {
  test("valid transition succeeds and logs status_changed", () => {
    const lead = createLead({ business_id: "biz_u", messenger_id: "u1", platform: "web", source: "web" });
    const res = updateLead(lead.id, "biz_u", { status: "contacted" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lead.status).toBe("contacted");
    const acts = getActivities(lead.id, "biz_u");
    expect(acts.some((a) => a.activity_type === "status_changed")).toBe(true);
  });

  test("invalid transition returns 400", () => {
    const lead = createLead({ business_id: "biz_u2", messenger_id: "u2", platform: "web", source: "web" });
    updateLead(lead.id, "biz_u2", { status: "qualified" });
    const res = updateLead(lead.id, "biz_u2", { status: "new" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(400);
  });

  test("converting sets converted_at", () => {
    const lead = createLead({ business_id: "biz_u3", messenger_id: "u3", platform: "web", source: "web" });
    updateLead(lead.id, "biz_u3", { status: "contacted" });
    const res = updateLead(lead.id, "biz_u3", { status: "converted" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.lead.converted_at).toBeGreaterThan(0);
  });

  test("unknown lead returns 404", () => {
    const res = updateLead("lead_missing", "biz_u", { status: "contacted" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe(404);
  });
});

describe("upsertLeadFromMessage", () => {
  test("creates on first message, updates (note) on second", () => {
    const first = upsertLeadFromMessage({
      business_id: "biz_c",
      messenger_id: "c1",
      platform: "telegram",
      message: "hi I want a premium booking"
    });
    const second = upsertLeadFromMessage({
      business_id: "biz_c",
      messenger_id: "c1",
      platform: "telegram",
      message: "any discounts?"
    });
    expect(second.id).toBe(first.id);
    const acts = getActivities(first.id, "biz_c");
    expect(acts.some((a) => a.activity_type === "note_added")).toBe(true);
  });
});

describe("pickAgent", () => {
  test("round-robins through the pool", () => {
    const a = pickAgent("biz_rr");
    const b = pickAgent("biz_rr");
    const c = pickAgent("biz_rr");
    expect([a, b]).toEqual(["agentX", "agentY"]);
    expect(c).toBe("agentX");
  });
});
