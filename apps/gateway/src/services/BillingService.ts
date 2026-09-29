/**
 * Billing: rate cards, the usage → invoice calculation, and the invoice
 * lifecycle (draft → sent → paid, or void).
 *
 * Two rules shape this file:
 *
 *  1. Money is arithmetic on integer cents. Adding floats until the total is
 *     off by a cent is how billing systems lose customers' trust.
 *  2. An invoice stores its own totals, its own plan name and the usage
 *     snapshot it was derived from. Prices change; a bill that has been sent
 *     must keep saying what it said when it was sent.
 */

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "../db";
import {
  summarizeUsage,
  type UsagePeriod,
  type UsageSummary
} from "./UsageMeter";

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export type PricingPlanRow = typeof schema.pricingPlans.$inferSelect;
export type InvoiceRow = typeof schema.invoices.$inferSelect;
export type InvoiceLineItemRow = typeof schema.invoiceLineItems.$inferSelect;

export class BillingError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "BillingError";
  }
}

/* ──────────────────────────── money ──────────────────────────── */

/** Currency amounts round half-up at two decimals, once, at the end. */
function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/* ──────────────────────── pricing plans ──────────────────────── */

function planId(): string {
  return `plan_${Math.random().toString(36).slice(2, 10)}`;
}

export interface PricingPlanInput {
  name: string;
  description?: string | null;
  currency?: string;
  monthly_fee?: number;
  included_ai_requests?: number;
  price_per_ai_request?: number;
  included_conversations?: number;
  price_per_conversation?: number;
  included_messages?: number;
  price_per_message?: number;
  tax_percent?: number;
  is_default?: boolean;
}

function nonNegative(value: number | undefined, field: string, fallback = 0): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new BillingError(`${field} must be a number of zero or more`);
  }
  return value;
}

export async function listPricingPlans(includeArchived = false): Promise<PricingPlanRow[]> {
  const rows = await db
    .select()
    .from(schema.pricingPlans)
    .orderBy(desc(schema.pricingPlans.is_default), schema.pricingPlans.name);

  return includeArchived ? rows : rows.filter((row) => row.archived !== 1);
}

export async function getPricingPlan(id: string): Promise<PricingPlanRow | undefined> {
  return await db
    .select()
    .from(schema.pricingPlans)
    .where(eq(schema.pricingPlans.id, id))
    .then((rows) => rows[0]);
}

export async function getDefaultPricingPlan(): Promise<PricingPlanRow | undefined> {
  const preferred = await db
    .select()
    .from(schema.pricingPlans)
    .where(and(eq(schema.pricingPlans.is_default, 1), eq(schema.pricingPlans.archived, 0)))
    .then((rows) => rows[0]);
  if (preferred) return preferred;

  // No plan is flagged default (an admin archived it): fall back to any live
  // plan rather than leaving the tenant unbillable.
  return await db
    .select()
    .from(schema.pricingPlans)
    .where(eq(schema.pricingPlans.archived, 0))
    .orderBy(schema.pricingPlans.created_at)
    .then((rows) => rows[0]);
}

/** The plan a tenant is billed on: its own, else the platform default. */
export async function resolvePlanForBusiness(businessId: string): Promise<PricingPlanRow | undefined> {
  const business = await db
    .select({ pricing_plan_id: schema.businesses.pricing_plan_id })
    .from(schema.businesses)
    .where(eq(schema.businesses.id, businessId))
    .then((rows) => rows[0]);

  if (business?.pricing_plan_id) {
    const assigned = await getPricingPlan(business.pricing_plan_id);
    if (assigned) return assigned;
  }
  return await getDefaultPricingPlan();
}

async function clearOtherDefaults(keepId: string): Promise<void> {
  await db
    .update(schema.pricingPlans)
    .set({ is_default: 0, updated_at: new Date().toISOString() })
    .where(and(eq(schema.pricingPlans.is_default, 1), ne(schema.pricingPlans.id, keepId)));
}

export async function createPricingPlan(input: PricingPlanInput): Promise<PricingPlanRow> {
  const name = input.name?.trim();
  if (!name) throw new BillingError("Plan name is required");

  const id = planId();
  const now = new Date().toISOString();

  await db.insert(schema.pricingPlans).values({
    id,
    name,
    description: input.description?.trim() || null,
    currency: (input.currency ?? process.env.ANALYTICS_CURRENCY ?? "LKR").trim().toUpperCase(),
    monthly_fee: nonNegative(input.monthly_fee, "monthly_fee"),
    included_ai_requests: Math.round(nonNegative(input.included_ai_requests, "included_ai_requests")),
    price_per_ai_request: nonNegative(input.price_per_ai_request, "price_per_ai_request"),
    included_conversations: Math.round(
      nonNegative(input.included_conversations, "included_conversations")
    ),
    price_per_conversation: nonNegative(input.price_per_conversation, "price_per_conversation"),
    included_messages: Math.round(nonNegative(input.included_messages, "included_messages")),
    price_per_message: nonNegative(input.price_per_message, "price_per_message"),
    tax_percent: nonNegative(input.tax_percent, "tax_percent"),
    is_default: input.is_default ? 1 : 0,
    archived: 0,
    created_at: now,
    updated_at: now
  });

  if (input.is_default) await clearOtherDefaults(id);

  const created = await getPricingPlan(id);
  if (!created) throw new BillingError("Failed to create the plan", 500);
  return created;
}

export async function updatePricingPlan(
  id: string,
  patch: Partial<PricingPlanInput> & { archived?: boolean }
): Promise<PricingPlanRow | undefined> {
  const existing = await getPricingPlan(id);
  if (!existing) return undefined;

  const changes: Partial<typeof schema.pricingPlans.$inferInsert> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new BillingError("Plan name cannot be empty");
    changes.name = name;
  }
  if (patch.description !== undefined) {
    changes.description = patch.description?.trim() || null;
  }
  if (patch.currency !== undefined) {
    changes.currency = patch.currency.trim().toUpperCase() || existing.currency;
  }

  if (patch.monthly_fee !== undefined) {
    changes.monthly_fee = nonNegative(patch.monthly_fee, "monthly_fee");
  }
  if (patch.included_ai_requests !== undefined) {
    changes.included_ai_requests = Math.round(
      nonNegative(patch.included_ai_requests, "included_ai_requests")
    );
  }
  if (patch.price_per_ai_request !== undefined) {
    changes.price_per_ai_request = nonNegative(patch.price_per_ai_request, "price_per_ai_request");
  }
  if (patch.included_conversations !== undefined) {
    changes.included_conversations = Math.round(
      nonNegative(patch.included_conversations, "included_conversations")
    );
  }
  if (patch.price_per_conversation !== undefined) {
    changes.price_per_conversation = nonNegative(
      patch.price_per_conversation,
      "price_per_conversation"
    );
  }
  if (patch.included_messages !== undefined) {
    changes.included_messages = Math.round(nonNegative(patch.included_messages, "included_messages"));
  }
  if (patch.price_per_message !== undefined) {
    changes.price_per_message = nonNegative(patch.price_per_message, "price_per_message");
  }
  if (patch.tax_percent !== undefined) {
    changes.tax_percent = nonNegative(patch.tax_percent, "tax_percent");
  }
  if (patch.is_default !== undefined) changes.is_default = patch.is_default ? 1 : 0;
  if (patch.archived !== undefined) changes.archived = patch.archived ? 1 : 0;

  if (changes.archived === 1 && (changes.is_default ?? existing.is_default) === 1) {
    throw new BillingError("Make another plan the default before archiving this one");
  }

  if (Object.keys(changes).length === 0) return existing;
  changes.updated_at = new Date().toISOString();

  await db.update(schema.pricingPlans).set(changes).where(eq(schema.pricingPlans.id, id));
  if (changes.is_default === 1) await clearOtherDefaults(id);

  return await getPricingPlan(id);
}

/** Points a tenant at a rate card. `null` returns it to the platform default. */
export async function assignPlanToBusiness(
  businessId: string,
  pricingPlanId: string | null
): Promise<void> {
  if (pricingPlanId) {
    const plan = await getPricingPlan(pricingPlanId);
    if (!plan) throw new BillingError("No such pricing plan", 404);
    if (plan.archived === 1) throw new BillingError("That pricing plan is archived");
  }

  const updated = await db
    .update(schema.businesses)
    .set({ pricing_plan_id: pricingPlanId, updated_at: new Date().toISOString() })
    .where(eq(schema.businesses.id, businessId))
    .returning({ id: schema.businesses.id });

  if (updated.length === 0) throw new BillingError("Business not found", 404);
}

/* ─────────────────── usage → invoice calculation ─────────────────── */

export interface DraftLineItem {
  kind: "subscription" | "ai_requests" | "conversations" | "messages" | "adjustment";
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface InvoiceDraft {
  currency: string;
  plan: PricingPlanRow;
  usage: UsageSummary;
  line_items: DraftLineItem[];
  subtotal: number;
  tax_percent: number;
  tax: number;
  total: number;
}

function meteredLine(
  kind: DraftLineItem["kind"],
  label: string,
  used: number,
  included: number,
  unitPrice: number
): DraftLineItem | null {
  const billable = Math.max(0, used - included);
  // A zero-priced or fully-included line is noise on a bill, not information.
  if (billable === 0 || unitPrice === 0) return null;

  return {
    kind,
    description:
      included > 0
        ? `${label} — ${used.toLocaleString()} used, ${included.toLocaleString()} included`
        : `${label} — ${used.toLocaleString()} used`,
    quantity: billable,
    unit_price: unitPrice,
    amount: fromCents(toCents(unitPrice) * billable)
  };
}

/**
 * Prices one period's usage against a plan.
 *
 * Pure: no database, no clock. The preview an admin approves and the invoice
 * that gets stored are produced by exactly this function, so what was on
 * screen is what gets billed.
 */
export function priceUsage(
  plan: PricingPlanRow,
  usage: UsageSummary,
  period: UsagePeriod,
  extraLines: DraftLineItem[] = []
): InvoiceDraft {
  const lines: DraftLineItem[] = [];

  if (plan.monthly_fee > 0) {
    lines.push({
      kind: "subscription",
      description: `${plan.name} plan — ${period.from} to ${period.to}`,
      quantity: 1,
      unit_price: plan.monthly_fee,
      amount: plan.monthly_fee
    });
  }

  const ai = meteredLine(
    "ai_requests",
    "AI requests",
    usage.ai_requests,
    plan.included_ai_requests,
    plan.price_per_ai_request
  );
  if (ai) lines.push(ai);

  const conversations = meteredLine(
    "conversations",
    "Conversations",
    usage.conversations,
    plan.included_conversations,
    plan.price_per_conversation
  );
  if (conversations) lines.push(conversations);

  const messages = meteredLine(
    "messages",
    "Messages",
    usage.messages,
    plan.included_messages,
    plan.price_per_message
  );
  if (messages) lines.push(messages);

  for (const extra of extraLines) {
    lines.push({ ...extra, amount: fromCents(toCents(extra.unit_price) * extra.quantity) });
  }

  const subtotalCents = lines.reduce((total, line) => total + toCents(line.amount), 0);
  const taxCents = Math.round((subtotalCents * plan.tax_percent) / 100);

  return {
    currency: plan.currency,
    plan,
    usage,
    line_items: lines,
    subtotal: fromCents(subtotalCents),
    tax_percent: plan.tax_percent,
    tax: fromCents(taxCents),
    total: fromCents(subtotalCents + taxCents)
  };
}

/** Reads a tenant's metered usage for the period and prices it. */
export async function buildInvoiceDraft(
  businessId: string,
  period: UsagePeriod,
  options: { plan?: PricingPlanRow; extraLines?: DraftLineItem[] } = {}
): Promise<InvoiceDraft> {
  const plan = options.plan ?? (await resolvePlanForBusiness(businessId));
  if (!plan) {
    throw new BillingError("No pricing plan is configured on this platform", 409);
  }

  const usage = await summarizeUsage(businessId, period);
  return priceUsage(plan, usage, period, options.extraLines ?? []);
}

/* ───────────────────────── invoice lifecycle ───────────────────────── */

const PERIOD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertValidPeriod(period: UsagePeriod): void {
  if (!PERIOD_RE.test(period.from) || !PERIOD_RE.test(period.to)) {
    throw new BillingError("period_start and period_end must be YYYY-MM-DD dates");
  }
  if (period.from > period.to) {
    throw new BillingError("period_start must be on or before period_end");
  }
}

function invoiceId(): string {
  return `inv_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Human-readable, sortable, and unique per year: INV-2026-0007. Derived from
 * the highest number already issued this year rather than a row count, so
 * deleting a draft cannot make the next invoice reuse a number.
 */
async function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `INV-${year}-`;

  const rows = await db
    .select({ number: schema.invoices.number })
    .from(schema.invoices)
    .where(sql`${schema.invoices.number} LIKE ${`${prefix}%`}`)
    .orderBy(desc(schema.invoices.number))
    .limit(1);

  const highest = Number(rows[0]?.number?.slice(prefix.length) ?? 0);
  const next = Number.isFinite(highest) ? highest + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export interface CreateInvoiceInput {
  business_id: string;
  period_start: string;
  period_end: string;
  due_date?: string | null;
  notes?: string | null;
  pricing_plan_id?: string | null;
  extra_lines?: DraftLineItem[];
  created_by?: string;
}

export interface InvoiceWithLines extends InvoiceRow {
  line_items: InvoiceLineItemRow[];
  business_name?: string | null;
  owner_email?: string | null;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceWithLines> {
  const period: UsagePeriod = { from: input.period_start, to: input.period_end };
  assertValidPeriod(period);

  const business = await db
    .select({ id: schema.businesses.id })
    .from(schema.businesses)
    .where(eq(schema.businesses.id, input.business_id))
    .then((rows) => rows[0]);
  if (!business) throw new BillingError("Business not found", 404);

  const plan = input.pricing_plan_id
    ? await getPricingPlan(input.pricing_plan_id)
    : await resolvePlanForBusiness(input.business_id);
  if (input.pricing_plan_id && !plan) throw new BillingError("No such pricing plan", 404);

  const draft = await buildInvoiceDraft(input.business_id, period, {
    plan,
    extraLines: input.extra_lines
  });

  const id = invoiceId();
  const now = new Date().toISOString();

  await db.insert(schema.invoices).values({
    id,
    number: await nextInvoiceNumber(),
    business_id: input.business_id,
    pricing_plan_id: draft.plan.id,
    plan_name: draft.plan.name,
    status: "draft",
    currency: draft.currency,
    period_start: period.from,
    period_end: period.to,
    subtotal: draft.subtotal,
    tax_percent: draft.tax_percent,
    tax: draft.tax,
    total: draft.total,
    notes: input.notes?.trim() || null,
    usage_json: JSON.stringify(draft.usage),
    due_date: input.due_date?.trim() || null,
    created_by: input.created_by ?? null,
    created_at: now,
    updated_at: now
  });

  if (draft.line_items.length > 0) {
    await db.insert(schema.invoiceLineItems).values(
      draft.line_items.map((line, index) => ({
        invoice_id: id,
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        amount: line.amount,
        sort_order: index
      }))
    );
  }

  const created = await getInvoice(id);
  if (!created) throw new BillingError("Failed to create the invoice", 500);
  return created;
}

export async function getInvoice(id: string): Promise<InvoiceWithLines | undefined> {
  const invoice = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .then((rows) => rows[0]);
  if (!invoice) return undefined;

  const [lines, business] = await Promise.all([
    db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoice_id, id))
      .orderBy(schema.invoiceLineItems.sort_order),
    db
      .select({ name: schema.businesses.name, owner_email: schema.businesses.owner_email })
      .from(schema.businesses)
      .where(eq(schema.businesses.id, invoice.business_id))
      .then((rows) => rows[0])
  ]);

  return {
    ...invoice,
    line_items: lines,
    business_name: business?.name ?? null,
    owner_email: business?.owner_email ?? null
  };
}

export interface ListInvoicesFilter {
  business_id?: string;
  status?: InvoiceStatus;
  limit?: number;
}

export async function listInvoices(filter: ListInvoicesFilter = {}): Promise<InvoiceWithLines[]> {
  const conditions = [];
  if (filter.business_id) conditions.push(eq(schema.invoices.business_id, filter.business_id));
  if (filter.status) conditions.push(eq(schema.invoices.status, filter.status));

  const rows = await db
    .select()
    .from(schema.invoices)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.invoices.created_at))
    .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const businessIds = [...new Set(rows.map((row) => row.business_id))];

  const [lines, businesses] = await Promise.all([
    db
      .select()
      .from(schema.invoiceLineItems)
      .where(inArray(schema.invoiceLineItems.invoice_id, ids))
      .orderBy(schema.invoiceLineItems.sort_order),
    db
      .select({
        id: schema.businesses.id,
        name: schema.businesses.name,
        owner_email: schema.businesses.owner_email
      })
      .from(schema.businesses)
      .where(inArray(schema.businesses.id, businessIds))
  ]);

  const linesByInvoice = new Map<string, InvoiceLineItemRow[]>();
  for (const line of lines) {
    const bucket = linesByInvoice.get(line.invoice_id) ?? [];
    bucket.push(line);
    linesByInvoice.set(line.invoice_id, bucket);
  }
  const businessById = new Map(businesses.map((row) => [row.id, row]));

  return rows.map((row) => ({
    ...row,
    line_items: linesByInvoice.get(row.id) ?? [],
    business_name: businessById.get(row.business_id)?.name ?? null,
    owner_email: businessById.get(row.business_id)?.owner_email ?? null
  }));
}

export async function updateInvoiceDraft(
  id: string,
  patch: { notes?: string | null; due_date?: string | null }
): Promise<InvoiceWithLines | undefined> {
  const invoice = await getInvoice(id);
  if (!invoice) return undefined;
  if (invoice.status !== "draft") {
    throw new BillingError("Only a draft invoice can be edited", 409);
  }

  await db
    .update(schema.invoices)
    .set({
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.due_date !== undefined ? { due_date: patch.due_date?.trim() || null } : {}),
      updated_at: new Date().toISOString()
    })
    .where(eq(schema.invoices.id, id));

  return await getInvoice(id);
}

/**
 * Only a draft can be discarded. Once an invoice has been sent it is a record
 * of what the customer was told they owe — it gets voided, never deleted.
 */
export async function deleteDraftInvoice(id: string): Promise<boolean> {
  const invoice = await db
    .select({ status: schema.invoices.status })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .then((rows) => rows[0]);

  if (!invoice) return false;
  if (invoice.status !== "draft") {
    throw new BillingError("Only a draft invoice can be deleted; void it instead", 409);
  }

  await db.delete(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoice_id, id));
  await db.delete(schema.invoices).where(eq(schema.invoices.id, id));
  return true;
}

export async function markInvoiceStatus(
  id: string,
  status: Exclude<InvoiceStatus, "draft">,
  extra: { sent_at?: string; send_error?: string | null } = {}
): Promise<InvoiceWithLines | undefined> {
  const invoice = await getInvoice(id);
  if (!invoice) return undefined;

  if (invoice.status === "void") {
    throw new BillingError("This invoice has been voided", 409);
  }
  if (status === "paid" && invoice.status === "draft") {
    throw new BillingError("Send the invoice before marking it paid", 409);
  }

  const now = new Date().toISOString();
  await db
    .update(schema.invoices)
    .set({
      status,
      ...(status === "sent"
        ? { sent_at: extra.sent_at ?? now, issued_at: invoice.issued_at ?? now }
        : {}),
      ...(status === "paid" ? { paid_at: now } : {}),
      ...(status === "void" ? { voided_at: now } : {}),
      ...(extra.send_error !== undefined ? { send_error: extra.send_error } : {}),
      updated_at: now
    })
    .where(eq(schema.invoices.id, id));

  return await getInvoice(id);
}
