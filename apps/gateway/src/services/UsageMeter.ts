/**
 * The billing meter.
 *
 * Every AI operation the platform performs on a tenant's behalf is recorded
 * here, because AI is the expensive part of running this platform and the part
 * the rate card charges most for. Everything else an invoice needs
 * (conversations, messages, contacts) is already in the gateway's own tables
 * and is counted, not logged.
 *
 * Recording must never break the thing being metered: `recordUsage` swallows
 * its own errors. A lost meter row costs the platform a few cents; a webhook
 * that 500s because the meter was down costs a customer their reply.
 */

import { and, count, countDistinct, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "../db";

export type UsageKind = "ai_reply" | "ai_voice" | "ai_vision" | "ai_other";

const AI_KINDS: UsageKind[] = ["ai_reply", "ai_voice", "ai_vision", "ai_other"];

export function isUsageKind(value: unknown): value is UsageKind {
  return typeof value === "string" && (AI_KINDS as string[]).includes(value);
}

export interface RecordUsageInput {
  business_id: string | undefined | null;
  kind: UsageKind;
  units?: number;
  model?: string | null;
  metadata?: Record<string, unknown> | null;
  occurred_at?: string;
}

export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const businessId = input.business_id?.trim();
  if (!businessId) return;

  const units = Number.isFinite(input.units) ? Math.max(1, Math.round(input.units as number)) : 1;

  try {
    await db.insert(schema.usageEvents).values({
      business_id: businessId,
      kind: input.kind,
      units,
      model: input.model ?? process.env.GEMINI_MODEL ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      occurred_at: input.occurred_at ?? new Date().toISOString()
    });
  } catch (err) {
    console.warn(
      `[usage] could not record ${input.kind} for ${businessId}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** Fire-and-forget wrapper for call sites that must not await the meter. */
export function meter(input: RecordUsageInput): void {
  void recordUsage(input);
}

export interface UsagePeriod {
  /** Inclusive, YYYY-MM-DD. */
  from: string;
  /** Inclusive, YYYY-MM-DD. */
  to: string;
}

export interface UsageSummary {
  period: UsagePeriod;
  /** Billable AI units in the period, split by what produced them. */
  ai_requests: number;
  ai_by_kind: Record<UsageKind, number>;
  /** Conversations (unique customers) that sent or received anything in the period. */
  conversations: number;
  /** Messages in both directions in the period. */
  messages: number;
  inbound_messages: number;
  outbound_messages: number;
  /** New contacts first seen in the period. */
  new_contacts: number;
  /** Every contact this tenant has ever had — the "how many users" headline. */
  total_contacts: number;
}

/** `to` is inclusive, so the exclusive upper bound is the following midnight. */
function bounds(period: UsagePeriod): { startIso: string; endIso: string } {
  const endMs = Date.parse(`${period.to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  return {
    startIso: `${period.from}T00:00:00.000Z`,
    endIso: new Date(endMs).toISOString()
  };
}

function emptyByKind(): Record<UsageKind, number> {
  return { ai_reply: 0, ai_voice: 0, ai_vision: 0, ai_other: 0 };
}

export async function summarizeUsage(
  businessId: string,
  period: UsagePeriod
): Promise<UsageSummary> {
  const { startIso, endIso } = bounds(period);

  const [aiRows, messageRows, conversationRows, newContactRows, totalContactRows] =
    await Promise.all([
      db
        .select({
          kind: schema.usageEvents.kind,
          units: sql<number>`coalesce(sum(${schema.usageEvents.units}), 0)`
        })
        .from(schema.usageEvents)
        .where(
          and(
            eq(schema.usageEvents.business_id, businessId),
            gte(schema.usageEvents.occurred_at, startIso),
            lt(schema.usageEvents.occurred_at, endIso)
          )
        )
        .groupBy(schema.usageEvents.kind),

      db
        .select({
          is_from_user: schema.chatMessages.is_from_user,
          total: count()
        })
        .from(schema.chatMessages)
        .where(
          and(
            eq(schema.chatMessages.business_id, businessId),
            gte(schema.chatMessages.created_at, startIso),
            lt(schema.chatMessages.created_at, endIso)
          )
        )
        .groupBy(schema.chatMessages.is_from_user),

      db
        .select({ total: countDistinct(schema.chatMessages.messenger_id) })
        .from(schema.chatMessages)
        .where(
          and(
            eq(schema.chatMessages.business_id, businessId),
            gte(schema.chatMessages.created_at, startIso),
            lt(schema.chatMessages.created_at, endIso)
          )
        ),

      db
        .select({ total: count() })
        .from(schema.messengers)
        .where(
          and(
            eq(schema.messengers.business_id, businessId),
            gte(schema.messengers.created_at, startIso),
            lt(schema.messengers.created_at, endIso)
          )
        ),

      db
        .select({ total: count() })
        .from(schema.messengers)
        .where(eq(schema.messengers.business_id, businessId))
    ]);

  const byKind = emptyByKind();
  for (const row of aiRows) {
    if (isUsageKind(row.kind)) byKind[row.kind] = Number(row.units) || 0;
  }

  const inbound = Number(messageRows.find((row) => row.is_from_user === true)?.total ?? 0);
  const outbound = Number(messageRows.find((row) => row.is_from_user === false)?.total ?? 0);

  return {
    period,
    ai_requests: AI_KINDS.reduce((total, kind) => total + byKind[kind], 0),
    ai_by_kind: byKind,
    conversations: Number(conversationRows[0]?.total ?? 0),
    messages: inbound + outbound,
    inbound_messages: inbound,
    outbound_messages: outbound,
    new_contacts: Number(newContactRows[0]?.total ?? 0),
    total_contacts: Number(totalContactRows[0]?.total ?? 0)
  };
}

/** Daily AI-unit series for the admin's usage chart. */
export async function aiUsageTrend(
  businessId: string,
  period: UsagePeriod
): Promise<Array<{ date: string; value: number }>> {
  const { startIso, endIso } = bounds(period);

  const rows = await db
    .select({
      day: sql<string>`substring(${schema.usageEvents.occurred_at} from 1 for 10)`,
      units: sql<number>`coalesce(sum(${schema.usageEvents.units}), 0)`
    })
    .from(schema.usageEvents)
    .where(
      and(
        eq(schema.usageEvents.business_id, businessId),
        gte(schema.usageEvents.occurred_at, startIso),
        lt(schema.usageEvents.occurred_at, endIso)
      )
    )
    .groupBy(sql`1`);

  const counts = new Map<string, number>();
  const dayMs = 24 * 60 * 60 * 1000;
  for (
    let ms = Date.parse(`${period.from}T00:00:00.000Z`);
    ms <= Date.parse(`${period.to}T00:00:00.000Z`);
    ms += dayMs
  ) {
    counts.set(new Date(ms).toISOString().slice(0, 10), 0);
  }
  for (const row of rows) {
    if (counts.has(row.day)) counts.set(row.day, Number(row.units) || 0);
  }

  return [...counts.entries()].map(([date, value]) => ({ date, value }));
}
