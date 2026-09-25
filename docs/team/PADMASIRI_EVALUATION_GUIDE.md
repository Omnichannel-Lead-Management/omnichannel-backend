# Evaluation Guide — Lead Manager & Chatbot Builder

**Owner:** PADMASIRI (230453V) · **Course:** CS3202 Omnichannel Lead Management Platform
**Scope:** the two microservices I built — Lead Manager (`:3002`) and Chatbot Builder (`:3003`)

**Verified state at time of writing:** Lead Manager **18/18 tests pass**, Chatbot Builder **56/56 tests pass** (`bun test`).

---

## 0. One-paragraph summary (say this first in the viva)

I built two independent microservices. The **Chatbot Builder** is a *no-code, data-driven conversation engine*: a business owner's chatbot is a JSON graph of nodes plus plain question→answer FAQ pairs stored in the database, which a pure interpreter walks at runtime — so changing the bot's behaviour never requires changing code. The **Lead Manager** turns those conversations into a sales pipeline: it scores every lead with a transparent rule-based model, enforces the lead lifecycle as a finite state machine, keeps an append-only audit trail, distributes leads to agents round-robin, and pushes live updates to the dashboard over Server-Sent Events. Both are multi-tenant (every row and every query is scoped by `business_id`), both degrade gracefully when their dependencies are down, and both keep domain logic in pure, framework-free functions — which is precisely what makes the 74 unit tests fast and deterministic.

---

# PART 1 — LEAD MANAGER

**Location:** `omnichannel-backend/apps/lead-manager/`
**Stack:** Bun runtime · Elysia.js (HTTP) · TypeScript · SQLite via Drizzle ORM
**Port:** 3002

## 1.1 Theories / concepts used, and *why*

| # | Theory / concept | Where it lives | Why this and not the alternative |
|---|---|---|---|
| 1 | **Microservices + Database-per-Service** | whole service, own `leads.db` | Each service owns its data exclusively; no other service reads my tables, they call my HTTP API. Gives independent deploy + failure isolation. Cost: no cross-service JOINs and only eventual consistency. |
| 2 | **Multi-tenancy: shared database, shared schema, tenant discriminator** | `business_id` column on both tables | Cheapest of the three multi-tenancy models (vs database-per-tenant / schema-per-tenant). Trade-off: isolation is *enforced in application code*, so **every** query must filter `business_id` — that's why I wrote explicit tests for it. |
| 3 | **Rule-based expert system / weighted additive scoring (Explainable AI)** | `services/scoring.ts` | Score = Σ points of matched rules, clamped 0–100. Deliberately **not** an ML classifier: no training data exists for a new business, and a salon owner must be able to see *why* a lead scored 65. Every rule emits a human-readable reason string → `reasons[]`. This is the XAI argument: interpretability over marginal accuracy. |
| 4 | **Finite State Machine (FSM)** | `TRANSITIONS` map in `services/leads.ts` | Lead lifecycle = states {new, contacted, qualified, converted, lost}, transition function δ encoded as an adjacency list. `converted` and `lost` are **absorbing (terminal) states**. Self-transition allowed → **idempotent**. Illegal transitions are rejected with HTTP 400 rather than silently accepted — the FSM is a *guard*, protecting data integrity. |
| 5 | **Append-only audit log (event-sourcing–lite)** | `lead_activities` table | The `leads` row is the *materialised current state*; the activity table is the immutable history (who/what/when/old→new in `metadata` JSON). Full provenance and traceability. Not true event sourcing — I don't rebuild state by replaying — hence "lite". |
| 6 | **Publish–Subscribe / Observer pattern** | `services/events.ts` | In-process event bus keyed by `business_id` (topic per tenant). The domain layer just calls `publish()`; it has no idea whether anyone is listening. Decouples producer from consumers and keeps the dashboard out of the domain code. |
| 7 | **Server-Sent Events (SSE)** | `GET /api/leads/stream` | Traffic is strictly one-way (server → dashboard), so SSE beats WebSockets: plain HTTP, auto-reconnect built into the browser, far simpler. Implemented with a `ReadableStream`, `text/event-stream`, and a 25 s `: ping` heartbeat comment so proxies don't drop the idle connection. `cancel()` unsubscribes → no memory leak. |
| 8 | **Round-robin scheduling** | `pickAgent()` | O(1), fair, no state to query. A per-tenant pointer in a `Map` means business A's rotation doesn't disturb business B's. Alternatives considered: least-connections (needs live agent load) and weighted (needs skill data) — neither is available in this system yet. |
| 9 | **Graceful degradation / timeout + fire-and-forget** | `services/notify.ts` | Notification is a *non-critical* dependency. Calls use `AbortController` with a 4 s timeout, are `void`-ed (not awaited), and **never throw**. Principle: a failure in a non-essential downstream service must never fail the core transaction (lead creation). |
| 10 | **Layered architecture (routes → services → db)** | folder structure | HTTP concerns live in `routes/`, domain logic in `services/`, persistence in `db/`. The service layer imports no HTTP types at all — which is exactly why it can be unit-tested without starting a server. |
| 11 | **Schema-first validation / fail-fast at the boundary** | Elysia `t.Object(...)` (TypeBox → JSON Schema) | Malformed input is rejected at the edge with 400 before it reaches domain code, so domain functions may assume well-formed input. Validation is *declarative*, so it also documents the API. |
| 12 | **Idempotent upsert** | `upsertLeadFromMessage()` | Same messenger sending a second message must not create a duplicate lead — it appends a note instead. |
| 13 | **Index design theory** | `db/schema.ts` | Composite indexes lead with `business_id` because it appears in *every* WHERE clause — leftmost-prefix rule. `idx_leads_score` supports the "hottest leads first" ordering. |

## 1.2 The scoring model (know these numbers cold)

| Rule key | Points | Fires when |
|---|---|---|
| `from_chatbot` | **+30** | `source === "chatbot"` |
| `instant_messaging_source` | **+10** | source is whatsapp or telegram |
| `premium_interest` | **+20** | `premium_interest` flag, or `service_interest` contains premium/vip/deluxe/gold/"full package" |
| `high_budget` | **+15** | `budget_range === "high"` |
| `appointment_booked` | **+20** | appointment was booked |
| *(escalation)* | **0 pts** | adds a ⚑ **flag** in `reasons[]`, not points |

Final score is **clamped to 0–100**. Rules are stored as *data* (an array of `{key, points, description, matches}` records), not as an if-chain — so adding a rule is one array entry, and the descriptions can be printed straight into the report.

> **Likely question: "why is escalation not points?"** Because escalation isn't evidence of buying intent — it's an operational signal ("a human must look at this"). Mixing it into the score would corrupt the meaning of the number.

## 1.3 What it does (functionality)

- **Create lead** — auto-scored at creation, optional auto-assignment, logs `lead_created` (+ `assigned`) activity, publishes `lead.created`, fires notification.
- **List / filter leads** — by `businessId` (mandatory), `status`, `assignedAgentId`; ordered by score DESC then newest.
- **Lead detail** — the lead plus its full activity trail.
- **Update** — status (FSM-guarded), score (clamped), assignment, notes, tags, budget, conversion value. Each change writes its own activity row. Setting status `converted` stamps `converted_at`.
- **Assign** — explicit agent, or round-robin when `agent_id` is omitted.
- **Real-time stream** — SSE per business.
- **`POST /chat`** — the Routing service's entry point for the `lead_qualification` intent: captures/enriches the lead from free text and replies with `escalated: true` (hand to a human).
- **Multi-tenant isolation** — reading another tenant's lead returns 404/undefined.

## 1.4 API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/leads` | Create (auto-scored) → 201 |
| GET | `/api/leads?businessId=&status=&assignedAgentId=` | List / filter |
| GET | `/api/leads/:id?businessId=` | Detail + activities |
| PATCH | `/api/leads/:id` | Update status/score/assignment/notes |
| POST | `/api/leads/:id/assign` | Assign (explicit or round-robin) |
| GET | `/api/leads/stream?businessId=` | SSE live feed |
| POST | `/chat` | Routing entry point |
| GET | `/health` | Health check |

## 1.5 How it was built — file by file

| File | Responsibility |
|---|---|
| `src/index.ts` | Elysia app: init DB, mount route modules, central `onError` handler (VALIDATION→400, NOT_FOUND→404, else 500), listen on 3002 |
| `src/db/index.ts` | Opens SQLite (WAL mode, FK on), `initDatabase()` creates tables + indexes **idempotently** (`CREATE TABLE IF NOT EXISTS`) so startup is always safe |
| `src/db/schema.ts` | Drizzle schema for `leads` + `lead_activities`, with the three composite indexes |
| `src/types.ts` | Shared contracts. `ChatRequest`/`ChatResponse` deliberately mirror the platform contract so Routing calls me unchanged |
| `src/services/scoring.ts` | Pure scoring engine — no I/O, no DB. `scoreLead()`, `signalsFromMessage()` |
| `src/services/leads.ts` | Domain core: FSM transitions, CRUD, activity logging, round-robin, upsert-from-message |
| `src/services/events.ts` | Per-tenant pub/sub bus |
| `src/services/notify.ts` | Best-effort notification hook |
| `src/routes/*.routes.ts` | HTTP layer: TypeBox validation + DTO mapping (`toDto` parses the tags JSON back to an array) |

**Build order I followed:** schema → DB init → pure scoring → domain services → routes → tests → integration client.

---

# PART 2 — CHATBOT BUILDER

**Location:** `chatbot-builder/` (its own repo, branch `hasarangadinuj`)
**Stack:** Bun · Elysia.js · TypeScript · SQLite/Drizzle · **LangGraph** + Google Gemini (optional layer)
**Port:** 3003

## 2.1 Theories / concepts used, and *why*

| # | Theory / concept | Where it lives | Why |
|---|---|---|---|
| 1 | **Interpreter pattern / data-driven design** | `engine/executor.ts` + `flow_json` column | The bot's behaviour is **data** (a JSON graph in the DB), and the engine is a generic interpreter of that data. This is the entire no-code claim: an owner changes the bot by editing rows, never code. Alternative (hardcoded if/else per business) doesn't scale past one client. |
| 2 | **Directed graph traversal with a halting guard** | `while (currentId && steps < MAX_STEPS)` | Flows are directed graphs; nodes point to `next`. Owner-authored graphs can contain cycles, so `MAX_STEPS = 100` guarantees termination. Safety property: an untrusted, user-authored program must not hang the server. |
| 3 | **Frame/slot-filling dialogue management** | `question` node → `store_as` → `state.awaiting` | Classic conversational-AI theory: the bot holds a *frame* of slots; each question fills one slot. `awaiting` names the slot the *next* user message will fill. This is how multi-turn conversation works without any NLU model. |
| 4 | **Continuation / resumable execution + externalised state** | `nextNodeId`, `current_node_id`, `session_state` | The executor runs until it must wait, then **returns its continuation** instead of blocking. The session row stores the "program counter" (`current_node_id`) and the "memory" (`session_state` JSON). Consequence: the HTTP service is **stateless**, so any instance can serve any turn → horizontal scalability. |
| 5 | **Functional core, imperative shell (purity)** | `executeFlow` performs **zero I/O** | Side effects are *described*, not performed: the engine returns an `EngineAction[]` list (`create_lead`, `update_lead_score`, `set_tags`, `trigger_service`) which `runtime.applyActions()` executes later. **This is the single most important design decision for testability** — the whole engine is testable with plain function calls, no mocks, no network. |
| 6 | **Hybrid deterministic-first AI with a closed-set LLM (guardrails)** | `engine/smartRouter.ts` | Cascade **keyword → LLM → default**. The LLM is *only* allowed to pick one of the branch keywords that already exist; it never writes customer-facing text. So it cannot hallucinate a price. Deterministic path runs first, so the LLM is never invoked when it isn't needed (cost + latency). |
| 7 | **LangGraph `StateGraph` — graph-structured agent orchestration** | `buildGraph()` | Nodes `keyword` / `llm` / `fallback` with **conditional edges**: `START → keyword → (matched ? END : llm) → (matched ? END : fallback) → END`. Compiled once (singleton). Chose LangGraph over plain LangChain because the routing decision is genuinely a *graph with branches*, not a linear chain. |
| 8 | **Retrieval-style (non-generative) FAQ answering** | `services/faqs.ts` | Owner enters question→answer pairs. Matching is keyword-first, then an LLM **classifier** that returns only an index number into the candidate list. The returned text is *always the owner's exact answer*. Formally: closed-set classification, not generation → hallucination is structurally impossible. |
| 9 | **Prototype / template instantiation** | `attachTemplate()` | Sector templates (`is_template=1`, held under a sentinel tenant `__templates__`) are **cloned** into a business, so later edits by one business never affect another. |
| 10 | **Capability negotiation / Adapter pattern** | `platform_capabilities` → `questionMessage()` | Channels differ: Telegram supports quick-reply buttons, plain web chat doesn't. If `quick_replies` is false the options degrade to a `• bulleted` text list. This is the *omnichannel* idea in miniature — one flow, many renderings. |
| 11 | **Templating with variable scoping** | `engine/interpolate.ts` | `{{business_name}}` substitution where **session variables shadow flow variables**; unknown placeholders collapse to empty string rather than leaking `{{var}}` to the customer. |
| 12 | **Feature flag / kill switch** | `business_config.chatbot_enabled` | Per-tenant off switch; when off, every message goes straight to a human. Operational safety valve. |
| 13 | **Anchored-regex intent detection** | `GREETING_RE`, `ESCALATION_RE` | Greeting regex is anchored `^...$` **on purpose**: "hi" greets, but "hi, what are your prices?" must run the pricing flow. This was a real bug I fixed — a naive `includes("hi")` launched the pricing flow on every hello. |
| 14 | **Graceful degradation of outbound calls** | `leadClient.ts`, `appointmentClient.ts` | 4 s timeout, returns `null` on any failure, never throws. The customer always gets their reply even if Lead Manager is down. |
| 15 | **Defensive input validation** | `validateFlowDefinition()` | Rejects empty node arrays, missing ids, missing types, and **duplicate node ids** before a flow can be saved — bad data can't reach the interpreter. |

## 2.2 The flow node model (know the six node types)

| Node type | Behaviour |
|---|---|
| `message` | Emit interpolated text, optionally fire an action, continue to `next` |
| `question` | Emit text (+ quick replies), set `awaiting = store_as`, **pause and return** |
| `branch` | Choose `next` via the resolver: keyword → LLM → `default` |
| `action` | Fire a side-effect descriptor (score/tags/lead), optional text, continue |
| `escalate` | Emit text, set `escalated: true`, stop |
| `trigger_service` | Emit text, push a `trigger_service` action (e.g. appointment), continue |

**Walk the salon template out loud in the viva** (`templates/salon.ts`): n1 welcome → n2 price list → n3 question with Basic/Standard/Premium quick replies (*pauses here*) → n4 branch → n5 premium (**+20**, tag `premium_interest`) / n6 standard (**+10**) / n7 basic / n8 default → n9 appointment handoff. Three templates ship: **salon, tutor, photography** — these are demo blueprints, *not* limits; any business can be configured from scratch via FAQs + a custom flow.

## 2.3 Request handling order in `handleChat()` (this is a favourite exam question)

1. Resolve tenant (`body.business_id` → `DEFAULT_BUSINESS_ID` fallback).
2. **Chatbot disabled?** → hand to human.
3. **Escalation keywords** ("human", "agent", "real person"…) → close session, hand to human.
4. Resume an active session if one exists (and self-heal if its flow was deleted).
5. If no session: **plain greeting?** → greet and guide, don't launch a flow.
6. If no session: **FAQ match?** → return the owner's exact answer.
7. Otherwise start the guided flow (creating a lead in Lead Manager as a side effect).
8. Execute the flow → apply actions → persist session → return the response contract.

## 2.4 API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/chat` | Conversation entry point (Routing calls this) |
| GET/POST | `/api/flows` | List / create flows (validated) |
| GET/PATCH/DELETE | `/api/flows/:id` | Manage a flow |
| GET | `/api/templates` | List sector templates |
| POST | `/api/businesses/:id/attach-template` | Clone a template into a business |
| GET/PATCH | `/api/businesses/:id/config` | Read / toggle `chatbot_enabled` |
| GET/POST/PUT | `/api/businesses/:id/faqs` | **No-code FAQ configuration** |
| PATCH/DELETE | `/api/faqs/:id` | Edit / delete an FAQ |
| GET | `/admin?businessId=` | Built-in no-code FAQ editor page |
| GET | `/demo?businessId=` | Browser chat widget (live demo) |
| GET | `/health` | Health check |

## 2.5 How it was built — file by file

| File | Responsibility |
|---|---|
| `src/engine/executor.ts` | The interpreter: pure graph walk, emits messages + action descriptors |
| `src/engine/interpolate.ts` | `{{var}}` substitution with scoping |
| `src/engine/smartRouter.ts` | LangGraph `StateGraph`: keyword → Gemini → default |
| `src/services/runtime.ts` | Orchestrator: tenant, session, FAQ, greeting, escalation, execute, apply actions, persist |
| `src/services/flows.ts` | Flow CRUD, `validateFlowDefinition`, template attach, per-business config |
| `src/services/sessions.ts` | Session persistence + `parseState` (carefully copies `variables`, `awaiting` **and** `lead`) |
| `src/services/faqs.ts` | FAQ CRUD + keyword/LLM matching |
| `src/services/seed.ts` | Idempotent seeding of 3 templates + 6 demo salon FAQs |
| `src/services/leadClient.ts` / `appointmentClient.ts` | Best-effort outbound integration |
| `src/templates/*.ts` | salon / tutor / photography blueprints |
| `src/routes/*.ts` | HTTP layer incl. `/admin` editor and `/demo` widget pages |

**Environment:** `GEMINI_API_KEY` (real key lives in git-ignored `.env`), working model **`gemini-flash-latest`**. Without a key the service still works — it silently degrades to pure keyword matching.

---

# PART 3 — TESTING (the part evaluators dig into)

## 3.1 Testing strategy and philosophy

**Framework:** `bun:test` (Bun's built-in Jest-compatible runner — `describe` / `test` / `expect`, zero extra dependencies).

**Level:** these are **unit and service-level integration tests** — they exercise domain logic and its real SQLite persistence, but not the HTTP layer. That is a deliberate position on the **test pyramid**: many fast tests at the bottom (pure logic), a handful of service-level tests in the middle, and HTTP/end-to-end verification done manually with `curl` (documented in §3.6). The architecture was designed to make this possible — because domain logic is framework-free and the flow engine is pure, most of the behaviour is reachable without booting a server.

**Three techniques make the tests deterministic — be ready to explain all three:**

1. **In-memory database.** `process.env.DATABASE_PATH = ":memory:"` gives every run a fresh, isolated SQLite DB. No fixture cleanup, no shared state between runs, no disk I/O.
2. **Dynamic `await import()` *after* setting env vars.** The DB module opens its connection at *module load* time, so a static top-of-file `import` would open the real file DB before the env var was set. Writing `const { initDatabase } = await import("../db")` **after** the assignments guarantees correct ordering. *(This is a subtle, genuinely interesting point — a good thing to volunteer in a viva.)*
3. **`NODE_ENV=test` as a side-effect kill switch.** `notify.ts`, `leadClient.ts`, `appointmentClient.ts` and both LLM call sites all check it and become no-ops. Result: **no network calls in the test suite** → tests are fast, offline-capable, and can never flake on a rate limit or an LLM's non-determinism.

**Test-design methods applied:** Arrange–Act–Assert structure; **equivalence partitioning** (chatbot vs telegram vs empty signals); **boundary value analysis** (score clamped at 100, clamped at 0); **state-transition testing** (valid, invalid, self, and terminal transitions of the lead FSM); **negative testing** (404 unknown lead, 400 illegal transition, unknown sector, malformed flow); and **security/isolation testing** (cross-tenant read must fail).

## 3.2 Lead Manager — 18 tests

**`src/services/scoring.test.ts` — 7 tests** (pure functions, no DB at all)

| Test | Asserts |
|---|---|
| chatbot + premium + high budget stacks | score **65** (30+20+15) and exactly 3 reasons — verifies rules *compose additively* |
| telegram + premium | score **30** (10+20) |
| empty signals | score **0** — the null case |
| appointment booked | **+20** in isolation |
| all rules at once | clamped ≤ **100** — boundary value |
| escalated only | score **0**, but a reason containing "Escalated" — proves the flag/points separation |
| `signalsFromMessage` | detects premium intent in "VIP deluxe option?", rejects "basic trim" |

**`src/services/leads.test.ts` — 11 tests** (in-memory DB, `AGENT_POOL="agentX,agentY"`)

| Group | Tests | Asserts |
|---|---|---|
| `canTransition` | 2 | forward moves + self-transition allowed; backward and out-of-terminal rejected — **full FSM coverage** |
| `createLead` | 1 | score 50 (chatbot 30 + premium 20), status `new`, `lead_created` activity written |
| **multi-tenant isolation** | 2 | `listLeads` returns only the requested tenant; `getLead` with the wrong `business_id` returns `undefined` — this is the security test |
| `updateLead` | 4 | valid transition logs `status_changed`; invalid → code **400**; converting stamps `converted_at`; unknown id → **404** |
| `upsertLeadFromMessage` | 1 | second message reuses the same lead id and adds a `note_added` activity — idempotency |
| `pickAgent` | 1 | agentX → agentY → **wraps back to agentX** — proves round-robin |

## 3.3 Chatbot Builder — 30 tests

**`src/engine/executor.test.ts` — 8 tests** (pure engine, no DB, no network)

| Test | Asserts |
|---|---|
| turn 1 walks to the question and waits | `completed: false`, 3 messages, last is `interactive`, `nextNodeId = "n4"`, `awaiting = "package_choice"` — proves the pause/continuation mechanism |
| turn 2 "premium please" | slot stored, "Premium includes…" emitted, `update_lead_score` action with **+20** and tag `premium_interest`, plus a `trigger_service` action — proves branch + action emission |
| unrecognised reply | takes the `default` branch |
| no quick-reply support | options fold into `• bulleted` text — capability adaptation |
| `matchBranch` × 2 | case-insensitive keyword match; falls back to default |
| escalate node | sets `escalated` and stops |
| `interpolate` | substitutes known vars, blanks unknown ones |

**`src/engine/smartRouter.test.ts` — 3 tests** (LangGraph with the LLM disabled)
Keyword wins; falls back to default; returns `null` when nothing matches and there is no default.

> **Why the LLM path itself isn't unit-tested:** an LLM is non-deterministic and needs a network + API key — including it would make the suite flaky and slow. The *architecture* is what's tested (the graph reaches the right terminal node), and the LLM path is verified manually. State this proactively; it reads as engineering judgement, not an omission.

**`src/services/runtime.test.ts` — 12 tests** (in-memory DB + seeded templates)
Seeding (3 templates, salon active for the demo business) · multi-turn `handleChat` (turn 1 returns 3 messages; turn 2 "premium" resumes and yields `leadScore: 20`) · escalation keyword → `escalated: true` · `chatbot_enabled` off → escalates, on → runs · **greeting handling** ("hello" gives one guiding message; "hi, what are your prices?" still runs the flow — the regression test for that bug) · business with no flow/FAQ hands off to a human · `attachTemplate` clones the tutor flow (response contains "BrightMinds") and returns `undefined` for an unknown sector · `validateFlowDefinition` accepts a good flow and rejects empty/missing-id/missing-type/**duplicate-id** flows.

**`src/services/faqs.test.ts` — 7 tests**
Match by explicit keywords · match by the significant words of the question (no keywords configured) · unrelated message → `null` · **disabled FAQ is never matched** · delete works · in the runtime, a matching message returns *the owner's exact answer as a single message* instead of the flow's 3-message intro · a non-FAQ message still runs the guided flow. Together these prove the precedence rule: **FAQ before flow**.

## 3.4 How to run the tests

```bash
# Lead Manager — expect: 18 pass, 0 fail
cd omnichannel-backend/apps/lead-manager
bun install
bun test

# Chatbot Builder — expect: 30 pass, 0 fail
cd chatbot-builder
bun install
bun test
```

Useful variants:

```bash
bun test --watch                      # re-run on save
bun test src/services/scoring.test.ts # one file
bun test --coverage                   # coverage report
bun test -t "round-robin"             # run only tests matching a name
```

**Actual output (verified):**

```
Lead Manager:      18 pass, 0 fail, 36 expect() calls   [2.43s]
Chatbot Builder:   30 pass, 0 fail, 59 expect() calls   [7.56s]
```

## 3.5 Running the services

```bash
# Terminal 1
cd omnichannel-backend/apps/lead-manager && bun run dev     # http://localhost:3002

# Terminal 2
cd chatbot-builder && bun run dev                            # http://localhost:3003
```

Both create their SQLite file and tables on first boot; the chatbot also seeds 3 templates + 6 demo FAQs. Run **both** together — otherwise the chatbot logs `[leadClient] … Unable to connect` warnings (harmless by design, but they look bad in a demo).

## 3.6 Manual / end-to-end verification (how I tested beyond unit tests)

```bash
# 1. Chatbot: two-turn conversation
curl -X POST http://localhost:3003/chat -H "Content-Type: application/json" \
  -d '{"message":"what are your prices?","messenger_id":"demo1","platform":"telegram"}'
curl -X POST http://localhost:3003/chat -H "Content-Type: application/json" \
  -d '{"message":"premium","messenger_id":"demo1","platform":"telegram"}'

# 2. Cross-service effect: that conversation created a scored lead
curl "http://localhost:3002/api/leads?businessId=biz_demo_salon"

# 3. FAQ path (no-code answer, not the flow)
curl -X POST http://localhost:3003/chat -H "Content-Type: application/json" \
  -d '{"message":"where are you located?","messenger_id":"demo2"}'

# 4. Lead lifecycle: valid then invalid transition (expect 200 then 400)
curl -X PATCH http://localhost:3002/api/leads/LEAD_ID -H "Content-Type: application/json" \
  -d '{"business_id":"biz_demo_salon","status":"contacted"}'
curl -X PATCH http://localhost:3002/api/leads/LEAD_ID -H "Content-Type: application/json" \
  -d '{"business_id":"biz_demo_salon","status":"new"}'

# 5. Live SSE stream (leave open, then create a lead in another terminal)
curl -N "http://localhost:3002/api/leads/stream?businessId=biz_demo_salon"
```

Browser demos: **`http://localhost:3003/demo?businessId=biz_demo_salon`** (chat widget) and **`http://localhost:3003/admin?businessId=biz_demo_salon`** (no-code FAQ editor). The admin page is the strongest visual proof of the "zero coding" requirement — show it.

**Verified cross-service end-to-end result:** a chatbot conversation creates a lead in Lead Manager with `source=chatbot`, **score 50**, tag `premium_interest`, auto-assigned to `agent_1`, and an activity trail of `lead_created` → `assigned` → `scored`.

## 3.7 Honest gaps (prepare this — "what would you improve?")

- **No HTTP route-level tests.** Validation schemas and status codes are verified by hand with `curl`, not automatically. Fix: Elysia's in-process `app.handle(new Request(...))` test harness.
- **The LLM branch is not unit-tested** (non-deterministic by nature); it needs recorded fixtures or a stubbed model to test properly.
- **No load/performance testing** — the round-robin pointer is in-memory, so it resets on restart and isn't shared across multiple instances. Fix: persist the pointer, or move to least-connections backed by a shared store.
- **No authentication yet** — `business_id` is trusted from the request body. In production it must come from a verified JWT, otherwise tenant isolation is bypassable.
- **Known integration gap:** the Routing service's `/chat` body doesn't yet carry `business_id`, so both services fall back to `DEFAULT_BUSINESS_ID`. Needs coordination with PANKAJA (Gateway/Routing).

---

# PART 4 — RAPID-FIRE VIVA PREP

**Q: Why rule-based scoring instead of machine learning?**
No labelled training data exists for a brand-new small business (cold start), and the owner must be able to see and edit *why* a lead scored what it did. Every rule returns a reason string. Once the platform accumulates real conversion outcomes, the rule weights become the baseline you'd train an ML model against.

**Q: Why is the flow engine pure?**
Because it makes the whole engine testable with plain function calls, and it separates *deciding* from *doing*. The engine returns a list of action descriptors; the runtime shell performs the I/O. That's the functional-core / imperative-shell pattern.

**Q: How does a multi-turn conversation survive a stateless HTTP service?**
The session row stores the program counter (`current_node_id`) and the memory (`session_state` JSON). On the next request the engine reloads them and resumes. No server-side memory is required, so instances scale horizontally.

**Q: How do you stop the LLM from making up prices?**
It never produces customer-facing text. It only *chooses* among branch keywords or FAQ indices that already exist — a closed-set classification. The wording always comes from the owner's template or FAQ answer. And the LLM step is skipped entirely when the keyword match already succeeded.

**Q: How is one business's data kept away from another's?**
`business_id` is a mandatory column on every table and a mandatory predicate in every query; composite indexes lead with it; and there are explicit unit tests asserting that a cross-tenant read returns nothing.

**Q: What happens if the Lead Manager is down while a customer is chatting?**
Nothing visible to the customer. `leadClient` has a 4 s timeout, returns `null` instead of throwing, and the conversation continues. The lead simply isn't recorded — availability of the customer-facing path is prioritised over completeness of the CRM record.

**Q: Why SSE and not WebSockets?**
The data flow is one-way (server → dashboard). SSE is plain HTTP, reconnects automatically in the browser, and needs no extra protocol handling. WebSockets would only be justified if the dashboard had to push back over the same channel.

**Q: What guarantees the flow interpreter terminates?**
`MAX_STEPS = 100`. Owner-authored graphs are untrusted input and may contain cycles, so the walk is bounded by construction.

**Q: Which design patterns can you name in your code?**
Interpreter (flow engine), Observer / Pub-Sub (events), Prototype (template cloning), Adapter (platform capabilities), Strategy (pluggable `BranchResolver`), layered Repository-style persistence (services over Drizzle), Feature toggle (`chatbot_enabled`).

**Q: What are the numbers?**
2 services · Lead Manager 18 tests · Chatbot Builder 30 tests · **48 total, all passing** · 5 scoring rules · 5 lifecycle states · 6 node types · 3 sector templates · ports 3002 / 3003.
