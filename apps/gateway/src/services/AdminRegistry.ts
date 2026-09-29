/**
 * Platform-admin accounts and the platform-wide statistics the admin console
 * is built on.
 *
 * Note what is deliberately absent: nothing here reads `message_text`. Admins
 * bill on volume, so this module counts rows and never returns their content.
 */

import { and, count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { adminAuthService, type AdminRole } from "./AdminAuth";

export type AdminRow = typeof schema.platformAdmins.$inferSelect;

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "AdminError";
  }
}

function adminId(): string {
  return `adm_${Math.random().toString(36).slice(2, 10)}`;
}

/** Never return the password hash, not even to another admin. */
export function toPublicAdmin(admin: AdminRow) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role as AdminRole,
    is_active: admin.is_active === 1,
    last_login_at: admin.last_login_at,
    created_at: admin.created_at
  };
}

export async function getAdminById(id: string): Promise<AdminRow | undefined> {
  return await db
    .select()
    .from(schema.platformAdmins)
    .where(eq(schema.platformAdmins.id, id))
    .then((rows) => rows[0]);
}

export async function getAdminByEmail(email: string): Promise<AdminRow | undefined> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return undefined;

  return await db
    .select()
    .from(schema.platformAdmins)
    .where(sql`lower(${schema.platformAdmins.email}) = ${normalized}`)
    .then((rows) => rows[0]);
}

export async function listAdmins(): Promise<AdminRow[]> {
  return await db.select().from(schema.platformAdmins).orderBy(schema.platformAdmins.created_at);
}

export async function countAdmins(): Promise<number> {
  const rows = await db.select({ total: count() }).from(schema.platformAdmins);
  return Number(rows[0]?.total ?? 0);
}

export async function createAdmin(input: {
  email: string;
  password: string;
  name?: string;
  role?: AdminRole;
}): Promise<AdminRow> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new AdminError("A valid email address is required");
  if (await getAdminByEmail(email)) throw new AdminError("That email is already an admin", 409);

  const id = adminId();
  const now = new Date().toISOString();

  await db.insert(schema.platformAdmins).values({
    id,
    email,
    name: input.name?.trim() || null,
    password_hash: await adminAuthService.hashPassword(input.password),
    role: input.role ?? "staff",
    is_active: 1,
    created_at: now,
    updated_at: now
  });

  const created = await getAdminById(id);
  if (!created) throw new AdminError("Failed to create the admin", 500);
  return created;
}

export async function setAdminPassword(id: string, password: string): Promise<boolean> {
  const updated = await db
    .update(schema.platformAdmins)
    .set({
      password_hash: await adminAuthService.hashPassword(password),
      updated_at: new Date().toISOString()
    })
    .where(eq(schema.platformAdmins.id, id))
    .returning({ id: schema.platformAdmins.id });

  return updated.length > 0;
}

export async function setAdminActive(id: string, active: boolean): Promise<boolean> {
  const updated = await db
    .update(schema.platformAdmins)
    .set({ is_active: active ? 1 : 0, updated_at: new Date().toISOString() })
    .where(eq(schema.platformAdmins.id, id))
    .returning({ id: schema.platformAdmins.id });

  return updated.length > 0;
}

export async function recordAdminLogin(id: string): Promise<void> {
  await db
    .update(schema.platformAdmins)
    .set({ last_login_at: new Date().toISOString() })
    .where(eq(schema.platformAdmins.id, id));
}

/* ─────────────────────── platform statistics ─────────────────────── */

export interface TenantStatsRow {
  id: string;
  name: string;
  sector: string;
  owner_email: string | null;
  owner_name: string | null;
  created_at: string | null;
  billing_active: boolean;
  pricing_plan_id: string | null;
  plan_name: string | null;
  /** Total customers ("users") this tenant has ever talked to. */
  contacts: number;
  /** Contacts first seen in the selected period. */
  new_contacts: number;
  messages: number;
  ai_requests: number;
  channels: string[];
  last_activity_at: string | null;
  unpaid_invoices: number;
  outstanding_total: number;
  currency: string | null;
}

interface StatsPeriod {
  from: string;
  to: string;
}

function periodBounds(period: StatsPeriod): { startIso: string; endIso: string } {
  return {
    startIso: `${period.from}T00:00:00.000Z`,
    endIso: new Date(
      Date.parse(`${period.to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000
    ).toISOString()
  };
}

/**
 * One row per tenant with everything the admin list needs. Built from five
 * grouped queries rather than a per-tenant loop — the console is the one place
 * that reads every tenant at once, so an N+1 here is felt immediately.
 */
export async function listTenantStats(period: StatsPeriod): Promise<TenantStatsRow[]> {
  const { startIso, endIso } = periodBounds(period);

  const [businesses, plans, contactRows, newContactRows, messageRows, aiRows, invoiceRows] =
    await Promise.all([
      db.select().from(schema.businesses).orderBy(desc(schema.businesses.created_at)),

      db.select().from(schema.pricingPlans),

      db
        .select({
          business_id: schema.messengers.business_id,
          total: count(),
          platforms: sql<string>`string_agg(DISTINCT ${schema.messengers.platform}, ',')`,
          last_activity: sql<string>`max(${schema.messengers.updated_at})`
        })
        .from(schema.messengers)
        .groupBy(schema.messengers.business_id),

      db
        .select({ business_id: schema.messengers.business_id, total: count() })
        .from(schema.messengers)
        .where(
          and(
            gte(schema.messengers.created_at, startIso),
            sql`${schema.messengers.created_at} < ${endIso}`
          )
        )
        .groupBy(schema.messengers.business_id),

      db
        .select({ business_id: schema.chatMessages.business_id, total: count() })
        .from(schema.chatMessages)
        .where(
          and(
            gte(schema.chatMessages.created_at, startIso),
            sql`${schema.chatMessages.created_at} < ${endIso}`
          )
        )
        .groupBy(schema.chatMessages.business_id),

      db
        .select({
          business_id: schema.usageEvents.business_id,
          units: sql<number>`coalesce(sum(${schema.usageEvents.units}), 0)`
        })
        .from(schema.usageEvents)
        .where(
          and(
            gte(schema.usageEvents.occurred_at, startIso),
            sql`${schema.usageEvents.occurred_at} < ${endIso}`
          )
        )
        .groupBy(schema.usageEvents.business_id),

      db
        .select({
          business_id: schema.invoices.business_id,
          total: count(),
          outstanding: sql<number>`coalesce(sum(${schema.invoices.total}), 0)`,
          currency: sql<string>`min(${schema.invoices.currency})`
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.status, "sent"))
        .groupBy(schema.invoices.business_id)
    ]);

  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const defaultPlan = plans.find((plan) => plan.is_default === 1 && plan.archived === 0);
  const contactsBy = new Map(contactRows.map((row) => [row.business_id, row]));
  const newContactsBy = new Map(newContactRows.map((row) => [row.business_id, Number(row.total)]));
  const messagesBy = new Map(messageRows.map((row) => [row.business_id, Number(row.total)]));
  const aiBy = new Map(aiRows.map((row) => [row.business_id, Number(row.units)]));
  const invoicesBy = new Map(invoiceRows.map((row) => [row.business_id, row]));

  return businesses.map((business) => {
    const contacts = contactsBy.get(business.id);
    const invoice = invoicesBy.get(business.id);
    const plan = business.pricing_plan_id ? planById.get(business.pricing_plan_id) : defaultPlan;

    return {
      id: business.id,
      name: business.name,
      sector: business.sector,
      owner_email: business.owner_email,
      owner_name: business.owner_name,
      created_at: business.created_at,
      billing_active: business.billing_active !== 0,
      pricing_plan_id: business.pricing_plan_id,
      plan_name: plan?.name ?? null,
      contacts: Number(contacts?.total ?? 0),
      new_contacts: newContactsBy.get(business.id) ?? 0,
      messages: messagesBy.get(business.id) ?? 0,
      ai_requests: aiBy.get(business.id) ?? 0,
      channels: (contacts?.platforms ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .sort(),
      last_activity_at: contacts?.last_activity ?? null,
      unpaid_invoices: Number(invoice?.total ?? 0),
      outstanding_total: Number(invoice?.outstanding ?? 0),
      currency: invoice?.currency ?? plan?.currency ?? null
    };
  });
}

export interface PlatformOverview {
  period: StatsPeriod;
  businesses: number;
  active_businesses: number;
  contacts: number;
  new_contacts: number;
  messages: number;
  ai_requests: number;
  ai_by_kind: Record<string, number>;
  channels: Array<{ category: string; value: number }>;
  ai_trend: Array<{ date: string; value: number }>;
  invoiced_total: number;
  outstanding_total: number;
  paid_total: number;
  currency: string;
}

/** Platform-level totals for the admin dashboard's headline figures. */
export async function buildPlatformOverview(period: StatsPeriod): Promise<PlatformOverview> {
  const { startIso, endIso } = periodBounds(period);

  const [
    businessRows,
    activeRows,
    contactRows,
    newContactRows,
    messageRows,
    aiKindRows,
    channelRows,
    trendRows,
    invoiceRows
  ] = await Promise.all([
    db.select({ total: count() }).from(schema.businesses),

    db
      .select({ total: countDistinct(schema.chatMessages.business_id) })
      .from(schema.chatMessages)
      .where(
        and(
          gte(schema.chatMessages.created_at, startIso),
          sql`${schema.chatMessages.created_at} < ${endIso}`
        )
      ),

    db.select({ total: count() }).from(schema.messengers),

    db
      .select({ total: count() })
      .from(schema.messengers)
      .where(
        and(
          gte(schema.messengers.created_at, startIso),
          sql`${schema.messengers.created_at} < ${endIso}`
        )
      ),

    db
      .select({ total: count() })
      .from(schema.chatMessages)
      .where(
        and(
          gte(schema.chatMessages.created_at, startIso),
          sql`${schema.chatMessages.created_at} < ${endIso}`
        )
      ),

    db
      .select({
        kind: schema.usageEvents.kind,
        units: sql<number>`coalesce(sum(${schema.usageEvents.units}), 0)`
      })
      .from(schema.usageEvents)
      .where(
        and(
          gte(schema.usageEvents.occurred_at, startIso),
          sql`${schema.usageEvents.occurred_at} < ${endIso}`
        )
      )
      .groupBy(schema.usageEvents.kind),

    db
      .select({ platform: schema.messengers.platform, total: count() })
      .from(schema.messengers)
      .groupBy(schema.messengers.platform),

    db
      .select({
        day: sql<string>`substring(${schema.usageEvents.occurred_at} from 1 for 10)`,
        units: sql<number>`coalesce(sum(${schema.usageEvents.units}), 0)`
      })
      .from(schema.usageEvents)
      .where(
        and(
          gte(schema.usageEvents.occurred_at, startIso),
          sql`${schema.usageEvents.occurred_at} < ${endIso}`
        )
      )
      .groupBy(sql`1`),

    db
      .select({
        status: schema.invoices.status,
        total: sql<number>`coalesce(sum(${schema.invoices.total}), 0)`,
        currency: sql<string>`min(${schema.invoices.currency})`
      })
      .from(schema.invoices)
      .groupBy(schema.invoices.status)
  ]);

  const aiByKind: Record<string, number> = {};
  let aiTotal = 0;
  for (const row of aiKindRows) {
    const units = Number(row.units) || 0;
    aiByKind[row.kind] = units;
    aiTotal += units;
  }

  const counts = new Map<string, number>();
  const dayMs = 24 * 60 * 60 * 1000;
  for (
    let ms = Date.parse(`${period.from}T00:00:00.000Z`);
    ms <= Date.parse(`${period.to}T00:00:00.000Z`);
    ms += dayMs
  ) {
    counts.set(new Date(ms).toISOString().slice(0, 10), 0);
  }
  for (const row of trendRows) {
    if (counts.has(row.day)) counts.set(row.day, Number(row.units) || 0);
  }

  const byStatus = new Map(invoiceRows.map((row) => [row.status, row]));
  const sent = Number(byStatus.get("sent")?.total ?? 0);
  const paid = Number(byStatus.get("paid")?.total ?? 0);

  return {
    period,
    businesses: Number(businessRows[0]?.total ?? 0),
    active_businesses: Number(activeRows[0]?.total ?? 0),
    contacts: Number(contactRows[0]?.total ?? 0),
    new_contacts: Number(newContactRows[0]?.total ?? 0),
    messages: Number(messageRows[0]?.total ?? 0),
    ai_requests: aiTotal,
    ai_by_kind: aiByKind,
    channels: channelRows
      .map((row) => ({ category: row.platform, value: Number(row.total) }))
      .sort((a, b) => b.value - a.value),
    ai_trend: [...counts.entries()].map(([date, value]) => ({ date, value })),
    invoiced_total: sent + paid,
    outstanding_total: sent,
    paid_total: paid,
    currency:
      byStatus.get("sent")?.currency ??
      byStatus.get("paid")?.currency ??
      process.env.ANALYTICS_CURRENCY ??
      "LKR"
  };
}
