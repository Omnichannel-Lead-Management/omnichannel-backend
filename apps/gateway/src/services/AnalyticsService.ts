import { and, eq, gte, lte } from "drizzle-orm";
import { db, schema } from "../db";

/**
 * Tenant analytics.
 *
 * The gateway is the only service that can answer this: conversations and
 * escalations live in its own Postgres, leads live in lead-manager and
 * appointments in the appointment service. Each remote source is fetched
 * best-effort — one service being down degrades a section to zero rather than
 * failing the whole dashboard.
 */

const LEAD_SERVICE_URL = (process.env.LEAD_SERVICE_URL ?? "http://localhost:3002").replace(/\/$/, "");
const APPOINTMENT_SERVICE_URL = (
  process.env.APPOINTMENT_SERVICE_URL ?? "http://localhost:3005"
).replace(/\/$/, "");
const TIMEOUT_MS = 8000;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

export interface AnalyticsRange {
  from: string; // YYYY-MM-DD, inclusive
  to: string; // YYYY-MM-DD, inclusive
  timezone: string;
}

export interface DistributionRow {
  category: string;
  value: number;
}

export interface TrendPoint {
  date: string;
  value: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Clamp a caller-supplied range to something sane; default to the last 30 days. */
export function resolveRange(query: {
  from?: string;
  to?: string;
  timezone?: string;
}): AnalyticsRange {
  const to = DATE_RE.test(query.to ?? "") ? (query.to as string) : today();
  const fromCandidate = DATE_RE.test(query.from ?? "") ? (query.from as string) : shiftDays(to, -29);

  // A reversed range is a client bug; treat it as a single day rather than
  // silently returning nothing.
  let from = fromCandidate > to ? to : fromCandidate;
  if (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`) > MAX_RANGE_DAYS * DAY_MS) {
    from = shiftDays(to, -(MAX_RANGE_DAYS - 1));
  }

  return {
    from,
    to,
    timezone: typeof query.timezone === "string" && query.timezone.trim() ? query.timezone.trim() : "UTC"
  };
}

function rangeBoundsIso(range: AnalyticsRange): { startIso: string; endIso: string } {
  return {
    startIso: `${range.from}T00:00:00.000Z`,
    // Exclusive upper bound: the day after `to`.
    endIso: `${shiftDays(range.to, 1)}T00:00:00.000Z`
  };
}

function eachDay(range: AnalyticsRange): string[] {
  const days: string[] = [];
  for (let day = range.from; day <= range.to; day = shiftDays(day, 1)) days.push(day);
  return days;
}

/** Bucket timestamps into a dense daily series so the chart has no gaps. */
function toTrend(range: AnalyticsRange, timestamps: (string | number | null | undefined)[]): TrendPoint[] {
  const counts = new Map<string, number>(eachDay(range).map((day) => [day, 0]));

  for (const raw of timestamps) {
    if (raw === null || raw === undefined) continue;
    const ms = typeof raw === "number" ? raw : Date.parse(raw);
    if (!Number.isFinite(ms)) continue;
    const day = new Date(ms).toISOString().slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  return [...counts.entries()].map(([date, value]) => ({ date, value }));
}

function tally(values: (string | null | undefined)[], fallback = "unknown"): DistributionRow[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = typeof value === "string" && value.trim() ? value.trim() : fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, value]) => ({ category, value }))
    .sort((a, b) => b.value - a.value);
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[analytics] ${url} unavailable:`, err instanceof Error ? err.message : String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface LeadRow {
  status?: string;
  platform?: string;
  assigned_agent_id?: string | null;
  created_at?: number;
  converted_at?: number | null;
  conversion_value?: number | null;
}

interface AppointmentRow {
  status?: string;
  createdAt?: string;
  startTime?: string;
}

function inRange(range: AnalyticsRange, ms: number | null | undefined): boolean {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return false;
  const day = new Date(ms).toISOString().slice(0, 10);
  return day >= range.from && day <= range.to;
}

export async function buildBusinessAnalytics(businessId: string, range: AnalyticsRange) {
  const { startIso, endIso } = rangeBoundsIso(range);

  // ── Local: conversations + escalations ──
  const conversationRows = await db
    .select({
      platform: schema.messengers.platform,
      escalation_status: schema.messengers.escalation_status,
      is_escalated: schema.messengers.is_escalated,
      created_at: schema.messengers.created_at
    })
    .from(schema.messengers)
    .where(
      and(
        eq(schema.messengers.business_id, businessId),
        gte(schema.messengers.created_at, startIso),
        lte(schema.messengers.created_at, endIso)
      )
    );

  // ── Remote: leads + appointments ──
  const [leadsResponse, appointmentsResponse] = await Promise.all([
    fetchJson<{ leads?: LeadRow[] }>(
      `${LEAD_SERVICE_URL}/api/leads?businessId=${encodeURIComponent(businessId)}`
    ),
    fetchJson<{ data?: AppointmentRow[] }>(
      `${APPOINTMENT_SERVICE_URL}/api/appointments?businessId=${encodeURIComponent(businessId)}`
    )
  ]);

  const allLeads = Array.isArray(leadsResponse?.leads) ? leadsResponse.leads : [];
  const leads = allLeads.filter((lead) => inRange(range, lead.created_at));

  const allAppointments = Array.isArray(appointmentsResponse?.data) ? appointmentsResponse.data : [];
  const appointments = allAppointments.filter((appointment) =>
    inRange(range, appointment.createdAt ? Date.parse(appointment.createdAt) : undefined)
  );

  const convertedLeads = leads.filter((lead) => lead.status === "converted");
  const conversionValue = convertedLeads.reduce(
    (total, lead) => total + (typeof lead.conversion_value === "number" ? lead.conversion_value : 0),
    0
  );

  const escalations = conversationRows.filter(
    (row) => row.is_escalated === 1 || (row.escalation_status && row.escalation_status !== "none")
  );

  return {
    range,
    summary: {
      conversations: conversationRows.length,
      leads: leads.length,
      converted_leads: convertedLeads.length,
      conversion_rate:
        leads.length > 0 ? Number(((convertedLeads.length / leads.length) * 100).toFixed(2)) : 0,
      appointments: appointments.length,
      completed_appointments: appointments.filter((a) => a.status === "completed").length,
      cancelled_appointments: appointments.filter((a) => a.status === "cancelled").length,
      conversion_value: Number(conversionValue.toFixed(2)),
      currency: process.env.ANALYTICS_CURRENCY ?? "LKR",
      escalations: escalations.length
    },
    trends: {
      conversations: toTrend(range, conversationRows.map((row) => row.created_at)),
      leads: toTrend(range, leads.map((lead) => lead.created_at)),
      appointments: toTrend(range, appointments.map((a) => a.createdAt)),
      conversions: toTrend(range, convertedLeads.map((lead) => lead.converted_at ?? lead.created_at))
    },
    channels: tally(conversationRows.map((row) => row.platform)),
    lead_statuses: tally(leads.map((lead) => lead.status)),
    appointment_statuses: tally(appointments.map((a) => a.status)),
    escalation_statuses: tally(escalations.map((row) => row.escalation_status)),
    // Per-agent breakdown — the dashboard's agent view reads this.
    agents: tally(
      leads.map((lead) => (lead.assigned_agent_id ? lead.assigned_agent_id : "Unassigned")),
      "Unassigned"
    ),
    sources: {
      conversations: "gateway",
      leads: leadsResponse === null ? "unavailable" : "lead-manager",
      appointments: appointmentsResponse === null ? "unavailable" : "appointment"
    },
    generated_at: new Date().toISOString()
  };
}
