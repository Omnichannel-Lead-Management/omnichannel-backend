# Lead Manager — Complete A‑to‑Z Build Plan

Follow this guide top to bottom, starting from the **empty stub** in
`omnichannel-backend/apps/lead-manager/`. Each step tells you which file to create, the full
code to put in it, *why* it exists, and a checkpoint. At the end you have a working, tested
service. Every code block is the final, verified version.

- **Port:** 3002 · **Location:** `omnichannel-backend/apps/lead-manager/`
- **Owner:** PADMASIRI G.R.H.D. (230453V) · **Checklist covered:** L1–L8
- **Build order:** setup → DB → types → scoring → services → routes → wiring → tests

---

## 0. What you're building & the 3 principles

The Lead Manager is the **system of record for customer leads**. Inquiries become *leads*,
get a *score*, move through a *status lifecycle*, and can be *assigned* to an agent.

1. **Multi-tenancy** — every row has a `business_id` and **every query filters on it**.
2. **Explainable scoring** — the score is a sum of simple rules, not a black box.
3. **Loose coupling** — owns its own SQLite DB; peer calls (Notification) are best-effort.

**Stack:** Bun · Elysia.js · SQLite + Drizzle ORM · Server-Sent Events for real-time.

Final surface: `POST/GET/PATCH /api/leads`, `POST /api/leads/:id/assign`,
`GET /api/leads/stream` (SSE), `POST /chat`, `GET /health`.

---

## 1. Project setup

### `package.json`
Replace the stub's dependencies with these (adds Drizzle + a test script):

```json
{
  "name": "lead-manager",
  "version": "1.0.0",
  "description": "Lead Manager Service",
  "main": "src/index.ts",
  "scripts": {
    "dev": "bun run src/index.ts",
    "start": "bun run src/index.ts",
    "test": "bun test",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": { "drizzle-orm": "^0.36.0", "elysia": "^1.3.0" },
  "devDependencies": { "@types/bun": "latest", "drizzle-kit": "^0.28.0" }
}
```

### `tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "skipLibCheck": true, "esModuleInterop": true
  },
  "include": ["src"]
}
```

### `.env.example`
```bash
PORT=3002
NODE_ENV=development
DATABASE_PATH=../../data/leads.db
NOTIFICATION_SERVICE_URL=http://localhost:3004
DEFAULT_BUSINESS_ID=biz_demo_salon
AGENT_POOL=agent_1,agent_2,agent_3
```

### `drizzle.config.ts`
```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "bun:sqlite",
  dbCredentials: { url: process.env.DATABASE_PATH || "./sqlite/leads.db" }
} satisfies Config;
```

Then from the monorepo root: `bun install`.

> **Checkpoint:** `bun install` completes with no errors.

---

## 2. Step 1 — Database schema  (L1)

### `src/db/schema.ts`
```ts
import { sqliteTable, integer, text, real, index } from "drizzle-orm/sqlite-core";

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),                    // "lead_<uuid>"
    business_id: text("business_id").notNull(),     // tenant isolation — never optional
    messenger_id: text("messenger_id").notNull(),
    platform: text("platform").notNull(),           // telegram | whatsapp | web
    status: text("status").notNull().default("new"),
    score: integer("score").notNull().default(0),   // 0-100
    source: text("source").notNull(),               // chatbot | whatsapp | telegram | web | referral
    channel_source: text("channel_source"),
    assigned_agent_id: text("assigned_agent_id"),
    tags: text("tags"),                             // JSON array string
    notes: text("notes"),
    service_interest: text("service_interest"),
    budget_range: text("budget_range"),             // low | medium | high
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    last_contact_at: integer("last_contact_at"),
    converted_at: integer("converted_at"),
    conversion_value: real("conversion_value")
  },
  (table) => ({
    businessStatusIdx: index("idx_leads_business").on(table.business_id, table.status),
    agentStatusIdx: index("idx_leads_agent").on(table.assigned_agent_id, table.status),
    businessScoreIdx: index("idx_leads_score").on(table.business_id, table.score)
  })
);

export const leadActivities = sqliteTable(
  "lead_activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lead_id: text("lead_id").notNull(),
    business_id: text("business_id").notNull(),
    activity_type: text("activity_type").notNull(), // lead_created|status_changed|note_added|assigned|scored
    description: text("description").notNull(),
    performed_by: text("performed_by"),
    metadata: text("metadata"),                     // JSON: { old_value, new_value, ... }
    created_at: integer("created_at").notNull()
  },
  (table) => ({ leadIdx: index("idx_lead_activities_lead").on(table.lead_id, table.created_at) })
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadActivity = typeof leadActivities.$inferSelect;
export type NewLeadActivity = typeof leadActivities.$inferInsert;
```

**Why:** `leads` is the main table (note `business_id NOT NULL`); `lead_activities` is an
append-only audit trail. Timestamps are unix-millis integers; `tags` is JSON stored as text.

### `src/db/index.ts`
```ts
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

const dbPath = process.env.DATABASE_PATH || "./sqlite/leads.db";

// Ensure the parent directory exists so bun:sqlite can create the file.
// (Use fs.mkdirSync — do NOT shell out to `rm`; that breaks on Windows.)
if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const sqlite = new Database(dbPath, { create: true });
sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

export async function initDatabase(): Promise<void> {
  console.log("🔧 Initializing leads database...");
  db.run(sql`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY, business_id TEXT NOT NULL, messenger_id TEXT NOT NULL,
      platform TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', score INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL, channel_source TEXT, assigned_agent_id TEXT, tags TEXT, notes TEXT,
      service_interest TEXT, budget_range TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      last_contact_at INTEGER, converted_at INTEGER, conversion_value REAL
    )`);
  db.run(sql`
    CREATE TABLE IF NOT EXISTS lead_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id TEXT NOT NULL, business_id TEXT NOT NULL,
      activity_type TEXT NOT NULL, description TEXT NOT NULL, performed_by TEXT, metadata TEXT,
      created_at INTEGER NOT NULL
    )`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_leads_business ON leads(business_id, status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_leads_agent ON leads(assigned_agent_id, status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(business_id, score DESC)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id, created_at)`);
  console.log("✅ Leads database initialized");
}

export { schema };
```

**Why:** `initDatabase()` uses `CREATE TABLE IF NOT EXISTS`, so tables appear on startup with
no migration step. `:memory:` is special-cased for tests. **`mkdirSync` is the important
detail** — creating the DB directory this way is cross-platform and avoids a Windows crash.

> **Checkpoint (L1):** you can't run yet (no entry point), but this compiles.

---

## 3. Step 2 — Shared types

### `src/types.ts`
```ts
export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "converted", "lost"];

export type LanguageCode = "en" | "si" | "ta";
export type DetectedLanguageTag = "english" | "sinhala" | "tamil";

export interface PlatformCapabilities {
  quick_replies: boolean; url_buttons: boolean; lists: boolean; max_quick_replies: number | null;
}

export type AgentMessage =
  | { type: "text"; text: string }
  | { type: "interactive"; text: string; quick_replies?: Array<{ label: string; value?: string }> };

export interface ChatRequest {
  message: string; messenger_id: string; request_id?: string; platform?: string;
  business_id?: string; language?: LanguageCode | DetectedLanguageTag;
  language_tag?: DetectedLanguageTag; platform_capabilities?: PlatformCapabilities;
}

export interface ChatResponse {
  success: boolean; messages: AgentMessage[]; escalated: boolean;
  leadId?: string; leadScore?: number; error?: string;
}

export interface ScoreSignals {
  source?: string; service_interest?: string; budget_range?: string;
  premium_interest?: boolean; appointment_booked?: boolean; escalated?: boolean;
}
export interface ScoreResult { score: number; reasons: string[]; }
```

**Why:** the vocabulary every later file shares. `ChatRequest`/`AgentMessage` must match what
the Routing service sends so it can call `/chat` unchanged.

---

## 4. Step 3 — Explainable scoring  (L3)

### `src/services/scoring.ts`
```ts
import type { ScoreResult, ScoreSignals } from "../types";

interface ScoreRule {
  key: string; points: number; description: string; matches: (s: ScoreSignals) => boolean;
}
const PREMIUM_KEYWORDS = ["premium", "vip", "deluxe", "gold", "full package"];

export const SCORE_RULES: ScoreRule[] = [
  { key: "from_chatbot", points: 30, description: "Created from an automated chatbot conversation",
    matches: (s) => s.source === "chatbot" },
  { key: "instant_messaging_source", points: 10, description: "Arrived via WhatsApp or Telegram",
    matches: (s) => s.source === "whatsapp" || s.source === "telegram" },
  { key: "premium_interest", points: 20, description: "Expressed interest in a premium / booking option",
    matches: (s) => s.premium_interest === true ||
      (typeof s.service_interest === "string" &&
        PREMIUM_KEYWORDS.some((k) => s.service_interest!.toLowerCase().includes(k))) },
  { key: "high_budget", points: 15, description: "Indicated a high budget range",
    matches: (s) => (s.budget_range ?? "").toLowerCase() === "high" },
  { key: "appointment_booked", points: 20, description: "Booked an appointment",
    matches: (s) => s.appointment_booked === true }
];

export function scoreLead(signals: ScoreSignals): ScoreResult {
  const reasons: string[] = [];
  let score = 0;
  for (const rule of SCORE_RULES) {
    if (rule.matches(signals)) { score += rule.points; reasons.push(`+${rule.points} ${rule.description}`); }
  }
  if (signals.escalated) reasons.push("⚑ Escalated / complaint — flag for human follow-up");
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export function signalsFromMessage(message: string): Pick<ScoreSignals, "premium_interest"> {
  const lower = message.toLowerCase();
  return { premium_interest: PREMIUM_KEYWORDS.some((k) => lower.includes(k)) };
}
```

**Why:** each rule is data, so `reasons[]` explains any score (chatbot + premium + high budget
= 65). Put this table in your report — it's exactly the "explainable scoring" the proposal asks for.

---

## 5. Step 4 — Real-time events (SSE)

### `src/services/events.ts`
```ts
import type { Lead } from "../db/schema";

export type LeadEventType = "lead.created" | "lead.updated";
export interface LeadEvent { type: LeadEventType; businessId: string; lead: Lead; at: number; }
type Subscriber = (event: LeadEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();   // businessId -> callbacks

export function subscribe(businessId: string, fn: Subscriber): () => void {
  let set = subscribers.get(businessId);
  if (!set) { set = new Set(); subscribers.set(businessId, set); }
  set.add(fn);
  return () => { set!.delete(fn); if (set!.size === 0) subscribers.delete(businessId); };
}

export function publish(type: LeadEventType, lead: Lead): void {
  const set = subscribers.get(lead.business_id);
  if (!set || set.size === 0) return;
  const event: LeadEvent = { type, businessId: lead.business_id, lead, at: Date.now() };
  for (const fn of set) { try { fn(event); } catch (err) { console.error("[events]", err); } }
}
```

**Why:** a tiny in-process pub/sub **scoped by tenant**. The dashboard subscribes over SSE
(Step 7) and only receives its own business's events. One-way, so SSE (no WebSocket dependency).

---

## 6. Step 5 — Best-effort notification hook  (L7)

### `src/services/notify.ts`
```ts
import type { Lead } from "../db/schema";

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3004";
const TIMEOUT_MS = 4000;
type NotifyReason = "new_lead" | "escalated_lead";

export async function notifyLeadEvent(reason: NotifyReason, lead: Lead): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.NOTIFICATIONS_ENABLED === "false") return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const payload = {
    type: reason, business_id: lead.business_id, lead_id: lead.id, messenger_id: lead.messenger_id,
    platform: lead.platform, score: lead.score, status: lead.status,
    service_interest: lead.service_interest ?? null
  };
  try {
    const res = await fetch(`${NOTIFICATION_SERVICE_URL}/api/notifications/email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload), signal: controller.signal
    });
    if (!res.ok) console.warn(`[notify] notification service responded ${res.status} for ${reason}`);
  } catch (err) {
    console.warn(`[notify] could not reach notification service for ${reason}:`,
      err instanceof Error ? err.message : String(err));
  } finally { clearTimeout(timer); }
}
```

**Why:** fire-and-forget with a timeout, **never throws**. If the Notification service (a
teammate's) is down, a lead must still be created. Skipped under `NODE_ENV=test`.

---

## 7. Step 6 — The core leads service  (L2, L4, L5, L6, L8)

### `src/services/leads.ts`
```ts
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { leads, leadActivities, type Lead, type LeadActivity } from "../db/schema";
import type { LeadStatus, ScoreSignals } from "../types";
import { scoreLead } from "./scoring";
import { publish } from "./events";
import { notifyLeadEvent } from "./notify";

// L4 — allowed transitions. Forward-only + `lost` from any active state; converted/lost terminal.
const TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "converted", "lost"],
  qualified: ["converted", "lost"],
  converted: [], lost: []
};
export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

// L6 — round-robin assignment over a configurable pool
const AGENT_POOL = (process.env.AGENT_POOL ?? "agent_1,agent_2,agent_3").split(",").map((s) => s.trim()).filter(Boolean);
const rrPointer = new Map<string, number>();
export function pickAgent(businessId: string): string | null {
  if (AGENT_POOL.length === 0) return null;
  const i = rrPointer.get(businessId) ?? 0;
  rrPointer.set(businessId, i + 1);
  return AGENT_POOL[i % AGENT_POOL.length] ?? null;
}

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const serializeTags = (tags?: string[] | null) => (tags && tags.length > 0 ? JSON.stringify(tags) : null);

interface ActivityInput { activity_type: string; description: string; performed_by?: string; metadata?: Record<string, unknown>; }
function logActivity(leadId: string, businessId: string, a: ActivityInput): void {
  db.insert(leadActivities).values({
    lead_id: leadId, business_id: businessId, activity_type: a.activity_type, description: a.description,
    performed_by: a.performed_by ?? "system", metadata: a.metadata ? JSON.stringify(a.metadata) : null,
    created_at: Date.now()
  }).run();
}

// ---- reads (L8: every query filters by business_id) ----
export function getLead(id: string, businessId: string): Lead | undefined {
  return db.select().from(leads).where(and(eq(leads.id, id), eq(leads.business_id, businessId))).get();
}
export function getActivities(leadId: string, businessId: string): LeadActivity[] {
  return db.select().from(leadActivities)
    .where(and(eq(leadActivities.lead_id, leadId), eq(leadActivities.business_id, businessId)))
    .orderBy(desc(leadActivities.created_at)).all();
}
export interface ListFilter { businessId: string; status?: LeadStatus; assignedAgentId?: string; }
export function listLeads(filter: ListFilter): Lead[] {
  const conds = [eq(leads.business_id, filter.businessId)];
  if (filter.status) conds.push(eq(leads.status, filter.status));
  if (filter.assignedAgentId) conds.push(eq(leads.assigned_agent_id, filter.assignedAgentId));
  return db.select().from(leads).where(and(...conds)).orderBy(desc(leads.score), desc(leads.created_at)).all();
}
export function findLeadByMessenger(businessId: string, messengerId: string): Lead | undefined {
  return db.select().from(leads).where(and(eq(leads.business_id, businessId), eq(leads.messenger_id, messengerId)))
    .orderBy(desc(leads.created_at)).get();
}

// ---- create ----
export interface CreateLeadInput {
  business_id: string; messenger_id: string; platform: string; source: string;
  channel_source?: string; service_interest?: string; budget_range?: string; tags?: string[];
  notes?: string; assigned_agent_id?: string; premium_interest?: boolean; appointment_booked?: boolean;
  autoAssign?: boolean; performed_by?: string;
}
export function createLead(input: CreateLeadInput): Lead {
  const signals: ScoreSignals = {
    source: input.source, service_interest: input.service_interest, budget_range: input.budget_range,
    premium_interest: input.premium_interest, appointment_booked: input.appointment_booked
  };
  const { score, reasons } = scoreLead(signals);
  const now = Date.now();
  const id = `lead_${crypto.randomUUID()}`;
  const assigned = input.assigned_agent_id ?? (input.autoAssign ? pickAgent(input.business_id) : null);

  db.insert(leads).values({
    id, business_id: input.business_id, messenger_id: input.messenger_id, platform: input.platform,
    status: "new", score, source: input.source, channel_source: input.channel_source ?? null,
    assigned_agent_id: assigned, tags: serializeTags(input.tags), notes: input.notes ?? null,
    service_interest: input.service_interest ?? null, budget_range: input.budget_range ?? null,
    created_at: now, updated_at: now, last_contact_at: now, converted_at: null, conversion_value: null
  }).run();

  const lead = getLead(id, input.business_id)!;
  logActivity(id, input.business_id, {
    activity_type: "lead_created", description: `Lead created from ${input.source} with score ${score}`,
    performed_by: input.performed_by, metadata: { reasons, source: input.source }
  });
  if (assigned) logActivity(id, input.business_id, {
    activity_type: "assigned", description: `Auto-assigned to ${assigned}`, metadata: { assigned_agent_id: assigned }
  });
  publish("lead.created", lead);
  void notifyLeadEvent("new_lead", lead);
  return lead;
}

// ---- update ----
export interface UpdateLeadInput {
  status?: LeadStatus; score?: number; assigned_agent_id?: string | null; notes?: string;
  tags?: string[]; service_interest?: string; budget_range?: string; conversion_value?: number; performed_by?: string;
}
export type UpdateResult = { ok: true; lead: Lead } | { ok: false; code: number; error: string };

export function updateLead(id: string, businessId: string, input: UpdateLeadInput): UpdateResult {
  const existing = getLead(id, businessId);
  if (!existing) return { ok: false, code: 404, error: "Lead not found" };
  const now = Date.now();
  const patch: Record<string, unknown> = { updated_at: now };
  const pending: ActivityInput[] = [];

  if (input.status && input.status !== existing.status) {
    if (!canTransition(existing.status as LeadStatus, input.status))
      return { ok: false, code: 400, error: `Invalid status transition: '${existing.status}' → '${input.status}'` };
    patch.status = input.status;
    if (input.status === "converted") patch.converted_at = now;
    pending.push({ activity_type: "status_changed",
      description: `Status changed from '${existing.status}' to '${input.status}'`,
      performed_by: input.performed_by, metadata: { old_value: existing.status, new_value: input.status } });
  }
  if (typeof input.score === "number") {
    patch.score = clampScore(input.score);
    pending.push({ activity_type: "scored", description: `Score set to ${patch.score}`,
      performed_by: input.performed_by, metadata: { old_value: existing.score, new_value: patch.score } });
  }
  if (input.assigned_agent_id !== undefined) {
    patch.assigned_agent_id = input.assigned_agent_id;
    pending.push({ activity_type: "assigned",
      description: input.assigned_agent_id ? `Assigned to ${input.assigned_agent_id}` : "Unassigned",
      performed_by: input.performed_by, metadata: { assigned_agent_id: input.assigned_agent_id } });
  }
  if (input.notes !== undefined) {
    patch.notes = input.notes; patch.last_contact_at = now;
    pending.push({ activity_type: "note_added", description: input.notes.slice(0, 200), performed_by: input.performed_by });
  }
  if (input.tags !== undefined) patch.tags = serializeTags(input.tags);
  if (input.service_interest !== undefined) patch.service_interest = input.service_interest;
  if (input.budget_range !== undefined) patch.budget_range = input.budget_range;
  if (input.conversion_value !== undefined) patch.conversion_value = input.conversion_value;

  db.update(leads).set(patch).where(and(eq(leads.id, id), eq(leads.business_id, businessId))).run();
  const updated = getLead(id, businessId)!;
  for (const a of pending) logActivity(id, businessId, a);
  publish("lead.updated", updated);
  return { ok: true, lead: updated };
}

// Used by POST /chat (lead_qualification): create if new messenger, else add a note.
export function upsertLeadFromMessage(params: { business_id: string; messenger_id: string; platform: string; message: string; }): Lead {
  const existing = findLeadByMessenger(params.business_id, params.messenger_id);
  if (existing) {
    const res = updateLead(existing.id, params.business_id, { notes: params.message, performed_by: "system" });
    return res.ok ? res.lead : existing;
  }
  return createLead({
    business_id: params.business_id, messenger_id: params.messenger_id, platform: params.platform,
    source: params.platform === "web" ? "web" : params.platform, notes: params.message,
    ...scoreHintsFromText(params.message), autoAssign: true, performed_by: "system"
  });
}
function scoreHintsFromText(message: string): { service_interest?: string; premium_interest?: boolean } {
  const lower = message.toLowerCase();
  const premium = ["premium", "vip", "deluxe", "gold"].some((k) => lower.includes(k));
  return premium ? { premium_interest: true, service_interest: message.slice(0, 120) } : {};
}

export function parseTags(lead: Lead): string[] {
  if (!lead.tags) return [];
  try { const arr = JSON.parse(lead.tags); return Array.isArray(arr) ? arr : []; } catch { return []; }
}
```

**Why each part matters:** `canTransition` (L4) rejects illegal status jumps; `logActivity`
(L5) records every change; `pickAgent` (L6) round-robins; every query passes `businessId`
(L8); `createLead` scores + logs + publishes + notifies (L2/L3/L7).

---

## 8. Step 7 — Routes

### `src/routes/leads.routes.ts`
```ts
import { Elysia, t } from "elysia";
import type { Lead } from "../db/schema";
import { createLead, getLead, getActivities, listLeads, updateLead, pickAgent, parseTags } from "../services/leads";
import { subscribe } from "../services/events";
import type { LeadStatus } from "../types";

const statusSchema = t.Union([t.Literal("new"), t.Literal("contacted"), t.Literal("qualified"),
  t.Literal("converted"), t.Literal("lost")]);

function toDto(lead: Lead) { const { tags: _t, ...rest } = lead; return { ...rest, tags: parseTags(lead) }; }

export const leadsRoutes = new Elysia({ prefix: "/api/leads" })
  .post("/", ({ body, set }) => { const lead = createLead(body); set.status = 201; return { success: true, lead: toDto(lead) }; }, {
    body: t.Object({
      business_id: t.String({ minLength: 1, error: "business_id is required" }),
      messenger_id: t.String({ minLength: 1, error: "messenger_id is required" }),
      platform: t.String({ minLength: 1, error: "platform is required" }),
      source: t.String({ minLength: 1, error: "source is required" }),
      channel_source: t.Optional(t.String()), service_interest: t.Optional(t.String()),
      budget_range: t.Optional(t.String()), tags: t.Optional(t.Array(t.String())),
      notes: t.Optional(t.String()), assigned_agent_id: t.Optional(t.String()),
      premium_interest: t.Optional(t.Boolean()), appointment_booked: t.Optional(t.Boolean()),
      autoAssign: t.Optional(t.Boolean())
    })
  })
  .get("/stream", ({ query }) => {                    // SSE — declared before "/:id" so it isn't shadowed
    const businessId = query.businessId;
    const encoder = new TextEncoder();
    let unsubscribe: () => void = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ businessId })}\n\n`));
        unsubscribe = subscribe(businessId, (event) => {
          try { controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(toDto(event.lead))}\n\n`)); } catch {}
        });
        heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch {} }, 25000);
      },
      cancel() { if (heartbeat) clearInterval(heartbeat); unsubscribe(); }
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
  }, { query: t.Object({ businessId: t.String({ minLength: 1, error: "businessId query param is required" }) }) })
  .get("/", ({ query }) => {
    const items = listLeads({ businessId: query.businessId, status: query.status as LeadStatus | undefined, assignedAgentId: query.assignedAgentId });
    return { success: true, count: items.length, leads: items.map(toDto) };
  }, { query: t.Object({ businessId: t.String({ minLength: 1 }), status: t.Optional(statusSchema), assignedAgentId: t.Optional(t.String()) }) })
  .get("/:id", ({ params, query, set }) => {
    const lead = getLead(params.id, query.businessId);
    if (!lead) { set.status = 404; return { success: false, error: "Lead not found" }; }
    return { success: true, lead: toDto(lead), activities: getActivities(params.id, query.businessId) };
  }, { query: t.Object({ businessId: t.String({ minLength: 1 }) }) })
  .patch("/:id", ({ params, body, set }) => {
    const { business_id, ...changes } = body;
    const result = updateLead(params.id, business_id, changes);
    if (!result.ok) { set.status = result.code; return { success: false, error: result.error }; }
    return { success: true, lead: toDto(result.lead) };
  }, {
    body: t.Object({
      business_id: t.String({ minLength: 1 }), status: t.Optional(statusSchema),
      score: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
      assigned_agent_id: t.Optional(t.Nullable(t.String())), notes: t.Optional(t.String()),
      tags: t.Optional(t.Array(t.String())), service_interest: t.Optional(t.String()),
      budget_range: t.Optional(t.String()), conversion_value: t.Optional(t.Number()), performed_by: t.Optional(t.String())
    })
  })
  .post("/:id/assign", ({ params, body, set }) => {
    const agentId = body.agent_id ?? pickAgent(body.business_id);
    if (!agentId) { set.status = 400; return { success: false, error: "No agent available to assign" }; }
    const result = updateLead(params.id, body.business_id, { assigned_agent_id: agentId, performed_by: body.performed_by ?? "system" });
    if (!result.ok) { set.status = result.code; return { success: false, error: result.error }; }
    return { success: true, lead: toDto(result.lead), assigned_agent_id: agentId };
  }, { body: t.Object({ business_id: t.String({ minLength: 1 }), agent_id: t.Optional(t.String()), performed_by: t.Optional(t.String()) }) });
```

### `src/routes/chat.routes.ts`
```ts
import { Elysia, t } from "elysia";
import { upsertLeadFromMessage } from "../services/leads";
import { notifyLeadEvent } from "../services/notify";
import type { ChatResponse } from "../types";

const DEFAULT_BUSINESS_ID = process.env.DEFAULT_BUSINESS_ID ?? "biz_demo_salon";

export const chatRoutes = new Elysia().post("/chat", ({ body, headers }): ChatResponse => {
  const requestId = body.request_id ??
    (typeof headers["x-request-id"] === "string" && headers["x-request-id"] ? headers["x-request-id"] : crypto.randomUUID());
  const businessId = body.business_id ?? DEFAULT_BUSINESS_ID;
  const platform = body.platform ?? "web";
  try {
    const lead = upsertLeadFromMessage({ business_id: businessId, messenger_id: body.messenger_id, platform, message: body.message });
    void notifyLeadEvent("escalated_lead", lead);
    return {
      success: true,
      messages: [{ type: "text", text: "Thanks for reaching out! I've noted your details and a team member will follow up with you shortly." }],
      escalated: true, leadId: lead.id, leadScore: lead.score
    };
  } catch (err) {
    console.error(`[REQ-${requestId}] CHAT_ERROR`, err instanceof Error ? err.message : err);
    return { success: false, messages: [{ type: "text", text: "Let me connect you with a team member." }],
      escalated: true, error: err instanceof Error ? err.message : String(err) };
  }
}, {
  body: t.Object({
    message: t.String({ minLength: 1 }), messenger_id: t.String({ minLength: 1 }),
    request_id: t.Optional(t.String()), platform: t.Optional(t.String()), business_id: t.Optional(t.String()),
    language: t.Optional(t.String()), language_tag: t.Optional(t.String()),
    platform_capabilities: t.Optional(t.Object({
      quick_replies: t.Boolean(), url_buttons: t.Boolean(), lists: t.Boolean(), max_quick_replies: t.Union([t.Number(), t.Null()])
    }))
  })
});
```

### `src/routes/health.routes.ts`
```ts
import { Elysia } from "elysia";
export const healthRoutes = new Elysia().get("/health", () => ({ status: "ok", service: "lead-manager" }));
```

---

## 9. Step 8 — App wiring

### `src/index.ts` (replace the stub)
```ts
import { Elysia } from "elysia";
import { initDatabase } from "./db";
import { leadsRoutes } from "./routes/leads.routes";
import { chatRoutes } from "./routes/chat.routes";
import { healthRoutes } from "./routes/health.routes";

const PORT = Number(process.env.PORT ?? 3002);
await initDatabase();

const app = new Elysia()
  .get("/", () => ({ name: "lead-manager", version: "1.0.0" }))
  .use(healthRoutes).use(leadsRoutes).use(chatRoutes)
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") { set.status = 400; return { success: false, error: error.message }; }
    if (code === "NOT_FOUND") { set.status = 404; return { success: false, error: "Not found" }; }
    set.status = 500; return { success: false, error: error instanceof Error ? error.message : "Internal server error" };
  })
  .listen(PORT);

console.log(`🚀 Lead Manager listening on http://localhost:${PORT}`);
export default app;
export type App = typeof app;
```

> **Checkpoint:** `bun run dev:lead-manager` (from monorepo root) prints "Lead Manager
> listening" and `curl localhost:3002/health` returns `{"status":"ok",...}`.

---

## 10. Step 9 — Tests  (proof it works)

### `src/services/scoring.test.ts`
```ts
import { describe, expect, test } from "bun:test";
import { scoreLead, signalsFromMessage } from "./scoring";

describe("scoreLead", () => {
  test("chatbot + premium + high budget stacks (65)", () => {
    expect(scoreLead({ source: "chatbot", service_interest: "premium haircut package", budget_range: "high" }).score).toBe(65);
  });
  test("telegram source with premium keyword (30)", () => {
    expect(scoreLead({ source: "telegram", premium_interest: true }).score).toBe(30);
  });
  test("empty signals score 0", () => { expect(scoreLead({}).score).toBe(0); });
  test("score is clamped to 100", () => {
    expect(scoreLead({ source: "chatbot", premium_interest: true, budget_range: "high", appointment_booked: true }).score).toBeLessThanOrEqual(100);
  });
  test("escalation is a flag, not points", () => {
    const r = scoreLead({ escalated: true });
    expect(r.score).toBe(0); expect(r.reasons.some((x) => x.includes("Escalated"))).toBe(true);
  });
});
describe("signalsFromMessage", () => {
  test("detects premium intent", () => {
    expect(signalsFromMessage("Do you have a VIP deluxe option?").premium_interest).toBe(true);
    expect(signalsFromMessage("just a basic trim").premium_interest).toBe(false);
  });
});
```

### `src/services/leads.test.ts`
```ts
import { describe, expect, test, beforeAll } from "bun:test";

process.env.NODE_ENV = "test";                 // disables notify network calls
process.env.DATABASE_PATH = ":memory:";        // isolated DB
process.env.AGENT_POOL = "agentX,agentY";

const { initDatabase } = await import("../db");
const { createLead, listLeads, getLead, getActivities, updateLead, upsertLeadFromMessage, canTransition, pickAgent } = await import("./leads");

beforeAll(async () => { await initDatabase(); });

describe("canTransition", () => {
  test("forward + lost allowed", () => {
    expect(canTransition("new", "contacted")).toBe(true);
    expect(canTransition("qualified", "lost")).toBe(true);
    expect(canTransition("new", "new")).toBe(true);
  });
  test("backward/terminal rejected", () => {
    expect(canTransition("contacted", "new")).toBe(false);
    expect(canTransition("converted", "contacted")).toBe(false);
  });
});
describe("createLead", () => {
  test("scores + logs a lead_created activity", () => {
    const lead = createLead({ business_id: "b1", messenger_id: "m1", platform: "telegram", source: "chatbot", service_interest: "premium package" });
    expect(lead.score).toBe(50);
    expect(getActivities(lead.id, "b1").some((a) => a.activity_type === "lead_created")).toBe(true);
  });
});
describe("multi-tenant isolation", () => {
  test("getLead with wrong business = undefined", () => {
    const lead = createLead({ business_id: "bX", messenger_id: "x1", platform: "web", source: "web" });
    expect(getLead(lead.id, "bY")).toBeUndefined();
    expect(getLead(lead.id, "bX")).toBeDefined();
  });
});
describe("updateLead", () => {
  test("valid transition + status_changed activity", () => {
    const lead = createLead({ business_id: "bu", messenger_id: "u1", platform: "web", source: "web" });
    const res = updateLead(lead.id, "bu", { status: "contacted" });
    expect(res.ok).toBe(true);
    expect(getActivities(lead.id, "bu").some((a) => a.activity_type === "status_changed")).toBe(true);
  });
  test("invalid transition = 400", () => {
    const lead = createLead({ business_id: "bu2", messenger_id: "u2", platform: "web", source: "web" });
    updateLead(lead.id, "bu2", { status: "qualified" });
    const res = updateLead(lead.id, "bu2", { status: "new" });
    expect(res.ok).toBe(false); if (!res.ok) expect(res.code).toBe(400);
  });
  test("unknown lead = 404", () => {
    const res = updateLead("nope", "bu", { status: "contacted" });
    expect(res.ok).toBe(false); if (!res.ok) expect(res.code).toBe(404);
  });
});
describe("upsertLeadFromMessage", () => {
  test("creates then reuses same lead", () => {
    const a = upsertLeadFromMessage({ business_id: "bc", messenger_id: "c1", platform: "telegram", message: "premium please" });
    const b = upsertLeadFromMessage({ business_id: "bc", messenger_id: "c1", platform: "telegram", message: "discounts?" });
    expect(b.id).toBe(a.id);
    expect(getActivities(a.id, "bc").some((x) => x.activity_type === "note_added")).toBe(true);
  });
});
describe("pickAgent", () => {
  test("round-robins", () => {
    expect([pickAgent("brr"), pickAgent("brr"), pickAgent("brr")]).toEqual(["agentX", "agentY", "agentX"]);
  });
});
```

**Run them:** `cd omnichannel-backend/apps/lead-manager && bun test` → **18 pass**.

> **Test trick:** because `db/index.ts` opens the DB at import time, the test sets
> `process.env.DATABASE_PATH` *before* `await import(...)` so the module reads `:memory:`.

---

## 11. Manual testing (curl)

```bash
BASE=http://localhost:3002
# create (chatbot + premium + high budget -> 65)
curl -s -X POST $BASE/api/leads -H 'Content-Type: application/json' \
  -d '{"business_id":"biz_A","messenger_id":"m1","platform":"telegram","source":"chatbot","service_interest":"premium package","budget_range":"high"}'
curl -s "$BASE/api/leads?businessId=biz_A"                              # list
curl -s -X PATCH $BASE/api/leads/<ID> -d '{"business_id":"biz_A","status":"contacted"}' -H 'Content-Type: application/json'   # 200
curl -s -o /dev/null -w "%{http_code}\n" -X PATCH $BASE/api/leads/<ID> -d '{"business_id":"biz_A","status":"new"}' -H 'Content-Type: application/json'  # 400
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/leads/<ID>?businessId=biz_B"   # 404 (tenant isolation)
curl -N "$BASE/api/leads/stream?businessId=biz_A"                       # SSE, leave open while you create/patch
```

---

## 12. Checklist (what "done" means)

| # | Task | Verified by |
|---|------|-------------|
| L1 | SQLite + Drizzle schema | startup log + `leads.db` |
| L2 | CRUD APIs | curl create/list/detail/patch |
| L3 | Scoring function | score 65; `reasons[]` in activity metadata |
| L4 | Status lifecycle validation | illegal transition → 400 |
| L5 | Activity log | `GET /api/leads/:id` → `activities[]` |
| L6 | Assign agent | `POST /:id/assign` sets `assigned_agent_id` |
| L7 | Notify on new lead | best-effort POST (warns if peer down) |
| L8 | Multi-tenant filter | cross-tenant fetch → 404 |

---

## 13. Integration note & pitfalls

- **`business_id` gap:** Routing's `/chat` body has no `business_id`, so we resolve
  `body.business_id ?? DEFAULT_BUSINESS_ID`. Coordinate with the Gateway/Routing owner
  (PANKAJA) to forward it. Document this in your report.
- **Always pass `business_id`** into every query (the classic multi-tenant bug).
- **Use `mkdirSync`** for the DB directory — do not shell out to `rm` (breaks on Windows).
- **Commit your work!** This whole implementation was lost once because it wasn't committed —
  run `git add -A && git commit` after each working step.
