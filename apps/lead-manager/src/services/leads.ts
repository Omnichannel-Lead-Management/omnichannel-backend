import { and, desc, eq } from "drizzle-orm";
import { db } from "../db";
import { leads, leadActivities, type Lead, type LeadActivity } from "../db/schema";
import type { LeadStatus, ScoreSignals } from "../types";
import { scoreLead, signalsFromMessage } from "./scoring";
import { publish } from "./events";
import { notifyLeadEvent } from "./notify";

const TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "converted", "lost"],
  qualified: ["converted", "lost"],
  converted: [],
  lost: []
};

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

const AGENT_POOL = (process.env.AGENT_POOL ?? "agent_1,agent_2,agent_3")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const rrPointer = new Map<string, number>();

/** Round-robin pick from the agent pool, per business. */
export function pickAgent(businessId: string): string | null {
  if (AGENT_POOL.length === 0) return null;
  const i = rrPointer.get(businessId) ?? 0;
  rrPointer.set(businessId, i + 1);
  return AGENT_POOL[i % AGENT_POOL.length] ?? null;
}

const clampScore = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const serializeTags = (tags?: string[] | null): string | null =>
  tags && tags.length > 0 ? JSON.stringify(tags) : null;

interface ActivityInput {
  activity_type: string;
  description: string;
  performed_by?: string;
  metadata?: Record<string, unknown>;
}

function logActivity(leadId: string, businessId: string, a: ActivityInput): void {
  db.insert(leadActivities)
    .values({
      lead_id: leadId,
      business_id: businessId,
      activity_type: a.activity_type,
      description: a.description,
      performed_by: a.performed_by ?? "system",
      metadata: a.metadata ? JSON.stringify(a.metadata) : null,
      created_at: Date.now()
    })
    .run();
}

export function getLead(id: string, businessId: string): Lead | undefined {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.id, id), eq(leads.business_id, businessId)))
    .get();
}

export function getActivities(leadId: string, businessId: string): LeadActivity[] {
  return db
    .select()
    .from(leadActivities)
    .where(and(eq(leadActivities.lead_id, leadId), eq(leadActivities.business_id, businessId)))
    .orderBy(desc(leadActivities.created_at))
    .all();
}

export interface ListFilter {
  businessId: string;
  status?: LeadStatus;
  assignedAgentId?: string;
}

export function listLeads(filter: ListFilter): Lead[] {
  const conds = [eq(leads.business_id, filter.businessId)];
  if (filter.status) conds.push(eq(leads.status, filter.status));
  if (filter.assignedAgentId) conds.push(eq(leads.assigned_agent_id, filter.assignedAgentId));
  return db
    .select()
    .from(leads)
    .where(and(...conds))
    .orderBy(desc(leads.score), desc(leads.created_at))
    .all();
}

export function findLeadByMessenger(businessId: string, messengerId: string): Lead | undefined {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.business_id, businessId), eq(leads.messenger_id, messengerId)))
    .orderBy(desc(leads.created_at))
    .get();
}

export interface CreateLeadInput {
  business_id: string;
  messenger_id: string;
  platform: string;
  source: string;
  channel_source?: string;
  service_interest?: string;
  budget_range?: string;
  tags?: string[];
  notes?: string;
  assigned_agent_id?: string;
  premium_interest?: boolean;
  appointment_booked?: boolean;
  autoAssign?: boolean;
  performed_by?: string;
}

export function createLead(input: CreateLeadInput): Lead {
  const signals: ScoreSignals = {
    source: input.source,
    service_interest: input.service_interest,
    budget_range: input.budget_range,
    premium_interest: input.premium_interest,
    appointment_booked: input.appointment_booked
  };
  const { score, reasons } = scoreLead(signals);
  const now = Date.now();
  const id = `lead_${crypto.randomUUID()}`;
  const assigned = input.assigned_agent_id ?? (input.autoAssign ? pickAgent(input.business_id) : null);

  db.insert(leads)
    .values({
      id,
      business_id: input.business_id,
      messenger_id: input.messenger_id,
      platform: input.platform,
      status: "new",
      score,
      source: input.source,
      channel_source: input.channel_source ?? null,
      assigned_agent_id: assigned,
      tags: serializeTags(input.tags),
      notes: input.notes ?? null,
      service_interest: input.service_interest ?? null,
      budget_range: input.budget_range ?? null,
      created_at: now,
      updated_at: now,
      last_contact_at: now,
      converted_at: null,
      conversion_value: null
    })
    .run();

  const lead = getLead(id, input.business_id)!;
  logActivity(id, input.business_id, {
    activity_type: "lead_created",
    description: `Lead created from ${input.source} with score ${score}`,
    performed_by: input.performed_by,
    metadata: { reasons, source: input.source }
  });
  if (assigned) {
    logActivity(id, input.business_id, {
      activity_type: "assigned",
      description: `Auto-assigned to ${assigned}`,
      metadata: { assigned_agent_id: assigned }
    });
  }

  publish("lead.created", lead);
  void notifyLeadEvent("new_lead", lead);
  return lead;
}

export interface UpdateLeadInput {
  status?: LeadStatus;
  score?: number;
  assigned_agent_id?: string | null;
  notes?: string;
  tags?: string[];
  service_interest?: string;
  budget_range?: string;
  conversion_value?: number;
  performed_by?: string;
}

export type UpdateResult =
  | { ok: true; lead: Lead }
  | { ok: false; code: number; error: string };

export function updateLead(
  id: string,
  businessId: string,
  input: UpdateLeadInput
): UpdateResult {
  const existing = getLead(id, businessId);
  if (!existing) return { ok: false, code: 404, error: "Lead not found" };

  const now = Date.now();
  const patch: Record<string, unknown> = { updated_at: now };
  const pending: ActivityInput[] = [];

  if (input.status && input.status !== existing.status) {
    if (!canTransition(existing.status as LeadStatus, input.status)) {
      return {
        ok: false,
        code: 400,
        error: `Invalid status transition: '${existing.status}' → '${input.status}'`
      };
    }
    patch.status = input.status;
    if (input.status === "converted") patch.converted_at = now;
    pending.push({
      activity_type: "status_changed",
      description: `Status changed from '${existing.status}' to '${input.status}'`,
      performed_by: input.performed_by,
      metadata: { old_value: existing.status, new_value: input.status }
    });
  }

  if (typeof input.score === "number") {
    patch.score = clampScore(input.score);
    pending.push({
      activity_type: "scored",
      description: `Score set to ${patch.score}`,
      performed_by: input.performed_by,
      metadata: { old_value: existing.score, new_value: patch.score }
    });
  }

  if (input.assigned_agent_id !== undefined) {
    patch.assigned_agent_id = input.assigned_agent_id;
    pending.push({
      activity_type: "assigned",
      description: input.assigned_agent_id
        ? `Assigned to ${input.assigned_agent_id}`
        : "Unassigned",
      performed_by: input.performed_by,
      metadata: { assigned_agent_id: input.assigned_agent_id }
    });
  }

  if (input.notes !== undefined) {
    patch.notes = input.notes;
    patch.last_contact_at = now;
    pending.push({
      activity_type: "note_added",
      description: input.notes.slice(0, 200),
      performed_by: input.performed_by
    });
  }

  if (input.tags !== undefined) patch.tags = serializeTags(input.tags);
  if (input.service_interest !== undefined) patch.service_interest = input.service_interest;
  if (input.budget_range !== undefined) patch.budget_range = input.budget_range;
  if (input.conversion_value !== undefined) patch.conversion_value = input.conversion_value;

  db.update(leads)
    .set(patch)
    .where(and(eq(leads.id, id), eq(leads.business_id, businessId)))
    .run();

  const updated = getLead(id, businessId)!;
  for (const a of pending) logActivity(id, businessId, a);

  publish("lead.updated", updated);
  return { ok: true, lead: updated };
}

/** Upsert a lead from an inbound routing `/chat` message (lead_qualification intent). */
export function upsertLeadFromMessage(params: {
  business_id: string;
  messenger_id: string;
  platform: string;
  message: string;
}): Lead {
  const existing = findLeadByMessenger(params.business_id, params.messenger_id);
  if (existing) {
    const res = updateLead(existing.id, params.business_id, {
      notes: params.message,
      performed_by: "system"
    });
    return res.ok ? res.lead : existing;
  }
  return createLead({
    business_id: params.business_id,
    messenger_id: params.messenger_id,
    platform: params.platform,
    source: params.platform === "web" ? "web" : params.platform,
    notes: params.message,
    // What the customer actually asked for is the only thing an agent can
    // triage on, so it is always recorded — not just when the text happens to
    // contain a premium keyword, which left every other lead blank.
    service_interest: params.message.slice(0, 120),
    ...signalsFromMessage(params.message),
    autoAssign: true,
    performed_by: "system"
  });
}

/** Parse the stored tags JSON back into an array for API responses. */
export function parseTags(lead: Lead): string[] {
  if (!lead.tags) return [];
  try {
    const arr = JSON.parse(lead.tags);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
