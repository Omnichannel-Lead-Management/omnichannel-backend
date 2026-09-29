/**
 * The platform-admin API.
 *
 * Everything under `/api/admin/` is gated on an admin session (see
 * middleware/requireAuth.ts) and nothing under it returns message content.
 * Admins run the business of the platform: they watch volume, set prices and
 * issue bills.
 */

import { Elysia, t } from "elysia";
import { adminAuthService } from "../services/AdminAuth";
import {
  AdminError,
  buildPlatformOverview,
  createAdmin,
  getAdminByEmail,
  getAdminById,
  listAdmins,
  listTenantStats,
  recordAdminLogin,
  setAdminActive,
  setAdminPassword,
  toPublicAdmin
} from "../services/AdminRegistry";
import {
  BillingError,
  assignPlanToBusiness,
  assertValidPeriod,
  buildInvoiceDraft,
  createInvoice,
  createPricingPlan,
  deleteDraftInvoice,
  getInvoice,
  listInvoices,
  listPricingPlans,
  markInvoiceStatus,
  resolvePlanForBusiness,
  updateInvoiceDraft,
  updatePricingPlan,
  type InvoiceStatus
} from "../services/BillingService";
import { aiUsageTrend, summarizeUsage } from "../services/UsageMeter";
import { sendInvoiceEmail } from "../services/InvoiceMailer";
import { MIN_PASSWORD_LENGTH } from "../services/SessionAuth";
import { getBusinessById } from "../services/BusinessRegistry";
import { db, schema } from "../db";
import { eq } from "drizzle-orm";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Same in-memory throttle shape as the tenant login; see auth.routes.ts. */
const attempts = new Map<string, { failures: number; blockedUntil: number }>();

function isLockedOut(email: string): number {
  const record = attempts.get(email.trim().toLowerCase());
  if (!record) return 0;
  const remaining = record.blockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

function recordFailure(email: string): void {
  const key = email.trim().toLowerCase();
  const record = attempts.get(key) ?? { failures: 0, blockedUntil: 0 };
  record.failures += 1;
  if (record.failures >= MAX_FAILED_ATTEMPTS) {
    record.blockedUntil = Date.now() + LOCKOUT_MS;
    record.failures = 0;
  }
  attempts.set(key, record);
}

function bearerToken(headers: Record<string, string | undefined>): string {
  const match = /^Bearer\s+(.+)$/i.exec((headers.authorization ?? "").trim());
  return match ? match[1]!.trim() : "";
}

/**
 * Routes re-verify the token rather than trusting the gate that already ran.
 * The gate decides *whether* the request proceeds; a route that needs to know
 * *who* the admin is asks for itself, so the two can never drift apart.
 */
async function requireAdmin(headers: Record<string, string | undefined>) {
  return await adminAuthService.verify(bearerToken(headers));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Defaults to the last 30 days, the window the console opens on. */
function resolvePeriod(query: { from?: string; to?: string }): { from: string; to: string } {
  const to = DATE_RE.test(query.to ?? "") ? (query.to as string) : today();
  const fromCandidate = DATE_RE.test(query.from ?? "") ? (query.from as string) : shiftDays(to, -29);
  return { from: fromCandidate > to ? to : fromCandidate, to };
}

function failed(error: unknown, set: { status?: number | string }) {
  if (error instanceof BillingError || error instanceof AdminError) {
    set.status = error.status;
    return { success: false, error: error.message };
  }
  console.error("[admin] request failed", error);
  set.status = 500;
  return { success: false, error: "Something went wrong handling that request" };
}

const periodQuery = t.Object({
  from: t.Optional(t.String()),
  to: t.Optional(t.String())
});

const planBody = {
  name: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
  description: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
  currency: t.Optional(t.String({ minLength: 3, maxLength: 8 })),
  monthly_fee: t.Optional(t.Number({ minimum: 0 })),
  included_ai_requests: t.Optional(t.Number({ minimum: 0 })),
  price_per_ai_request: t.Optional(t.Number({ minimum: 0 })),
  included_conversations: t.Optional(t.Number({ minimum: 0 })),
  price_per_conversation: t.Optional(t.Number({ minimum: 0 })),
  included_messages: t.Optional(t.Number({ minimum: 0 })),
  price_per_message: t.Optional(t.Number({ minimum: 0 })),
  tax_percent: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
  is_default: t.Optional(t.Boolean())
};

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
  /* ───────────────────────────── auth ───────────────────────────── */

  .post(
    "/auth/login",
    async ({ body, set }) => {
      const email = body.email.trim();

      if (!adminAuthService.configured) {
        set.status = 503;
        return {
          success: false,
          error: "Admin authentication is not configured on this server"
        };
      }

      const lockedFor = isLockedOut(email);
      if (lockedFor > 0) {
        set.status = 429;
        return {
          success: false,
          error: "Too many failed attempts. Try again later.",
          retry_after_seconds: lockedFor
        };
      }

      const admin = await getAdminByEmail(email);
      const passwordValid = await adminAuthService.verifyPassword(
        body.password,
        admin?.password_hash
      );

      // One message for every failure mode, so this cannot be used to discover
      // which addresses are platform admins.
      if (!admin || !passwordValid || admin.is_active !== 1) {
        recordFailure(email);
        set.status = 401;
        return { success: false, error: "Invalid email or password" };
      }

      attempts.delete(email.trim().toLowerCase());
      await recordAdminLogin(admin.id);

      const { token, expires_at } = await adminAuthService.issue({
        admin_id: admin.id,
        email: admin.email,
        role: admin.role === "owner" ? "owner" : "staff"
      });

      return { success: true, token, expires_at, admin: toPublicAdmin(admin) };
    },
    {
      body: t.Object({
        email: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 })
      }),
      detail: { summary: "Sign in as a platform admin", tags: ["Admin"] }
    }
  )

  .get(
    "/auth/me",
    async ({ headers, set }) => {
      const identity = await requireAdmin(headers);
      if (!identity) {
        set.status = 401;
        return { success: false, error: "Session is invalid or has expired" };
      }

      const admin = await getAdminById(identity.admin_id);
      if (!admin || admin.is_active !== 1) {
        set.status = 401;
        return { success: false, error: "This admin account is no longer active" };
      }

      return { success: true, admin: toPublicAdmin(admin) };
    },
    { detail: { summary: "The signed-in admin", tags: ["Admin"] } }
  )

  .post(
    "/auth/change-password",
    async ({ headers, body, set }) => {
      const identity = await requireAdmin(headers);
      if (!identity) {
        set.status = 401;
        return { success: false, error: "Session is invalid or has expired" };
      }
      if (body.new_password.length < MIN_PASSWORD_LENGTH) {
        set.status = 400;
        return {
          success: false,
          error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters`
        };
      }

      const admin = await getAdminById(identity.admin_id);
      if (!admin) {
        set.status = 404;
        return { success: false, error: "Admin not found" };
      }

      const currentValid = await adminAuthService.verifyPassword(
        body.current_password,
        admin.password_hash
      );
      if (!currentValid) {
        set.status = 401;
        return { success: false, error: "Current password is incorrect" };
      }

      await setAdminPassword(admin.id, body.new_password);
      return { success: true };
    },
    {
      body: t.Object({
        current_password: t.String({ minLength: 1 }),
        new_password: t.String({ minLength: 1 })
      }),
      detail: { summary: "Change the signed-in admin's password", tags: ["Admin"] }
    }
  )

  /* ─────────────────────────── admin users ─────────────────────────── */

  .get(
    "/admins",
    async ({ headers, set }) => {
      const identity = await requireAdmin(headers);
      if (identity?.role !== "owner") {
        set.status = 403;
        return { success: false, error: "Only an owner admin can manage admin accounts" };
      }
      return { success: true, admins: (await listAdmins()).map(toPublicAdmin) };
    },
    { detail: { summary: "List platform admins", tags: ["Admin"] } }
  )

  .post(
    "/admins",
    async ({ headers, body, set }) => {
      const identity = await requireAdmin(headers);
      if (identity?.role !== "owner") {
        set.status = 403;
        return { success: false, error: "Only an owner admin can create admin accounts" };
      }
      if (body.password.length < MIN_PASSWORD_LENGTH) {
        set.status = 400;
        return {
          success: false,
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
        };
      }

      try {
        const admin = await createAdmin({
          email: body.email,
          password: body.password,
          name: body.name,
          role: body.role === "owner" ? "owner" : "staff"
        });
        set.status = 201;
        return { success: true, admin: toPublicAdmin(admin) };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      body: t.Object({
        email: t.String({ minLength: 3, maxLength: 320 }),
        password: t.String({ minLength: 1 }),
        name: t.Optional(t.String({ maxLength: 120 })),
        role: t.Optional(t.Union([t.Literal("owner"), t.Literal("staff")]))
      }),
      detail: { summary: "Create a platform admin", tags: ["Admin"] }
    }
  )

  .patch(
    "/admins/:id",
    async ({ headers, params, body, set }) => {
      const identity = await requireAdmin(headers);
      if (identity?.role !== "owner") {
        set.status = 403;
        return { success: false, error: "Only an owner admin can manage admin accounts" };
      }
      // Locking yourself out of the console you are standing in helps nobody.
      if (params.id === identity.admin_id && body.is_active === false) {
        set.status = 400;
        return { success: false, error: "You cannot deactivate your own account" };
      }

      if (body.is_active !== undefined) await setAdminActive(params.id, body.is_active);
      if (body.password !== undefined) {
        if (body.password.length < MIN_PASSWORD_LENGTH) {
          set.status = 400;
          return {
            success: false,
            error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
          };
        }
        await setAdminPassword(params.id, body.password);
      }

      const admin = await getAdminById(params.id);
      if (!admin) {
        set.status = 404;
        return { success: false, error: "Admin not found" };
      }
      return { success: true, admin: toPublicAdmin(admin) };
    },
    {
      body: t.Object({
        is_active: t.Optional(t.Boolean()),
        password: t.Optional(t.String({ minLength: 1 }))
      }),
      detail: { summary: "Deactivate or reset a platform admin", tags: ["Admin"] }
    }
  )

  /* ────────────────────────────── stats ────────────────────────────── */

  .get(
    "/overview",
    async ({ query, set }) => {
      try {
        return { success: true, overview: await buildPlatformOverview(resolvePeriod(query)) };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      query: periodQuery,
      detail: { summary: "Platform-wide counts for the admin dashboard", tags: ["Admin"] }
    }
  )

  .get(
    "/businesses",
    async ({ query, set }) => {
      try {
        const period = resolvePeriod(query);
        return { success: true, period, businesses: await listTenantStats(period) };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      query: periodQuery,
      detail: { summary: "Every tenant with its usage counts", tags: ["Admin"] }
    }
  )

  .get(
    "/businesses/:id",
    async ({ params, query, set }) => {
      const business = await getBusinessById(params.id);
      if (!business) {
        set.status = 404;
        return { success: false, error: "Business not found" };
      }

      try {
        const period = resolvePeriod(query);
        const [usage, trend, plan, invoices] = await Promise.all([
          summarizeUsage(params.id, period),
          aiUsageTrend(params.id, period),
          resolvePlanForBusiness(params.id),
          listInvoices({ business_id: params.id, limit: 50 })
        ]);

        // A tenant profile for a billing admin: who they are, how much they
        // used, what they are charged. No conversations, no message text.
        return {
          success: true,
          business: {
            id: business.id,
            name: business.name,
            sector: business.sector,
            owner_email: business.owner_email,
            owner_name: business.owner_name,
            contact_phone: business.contact_phone,
            timezone: business.timezone,
            created_at: business.created_at,
            billing_active: business.billing_active !== 0,
            pricing_plan_id: business.pricing_plan_id,
            telegram_connected: Boolean(business.telegram_bot_token),
            whatsapp_connected: Boolean(business.whatsapp_instance_name)
          },
          plan: plan ?? null,
          usage,
          ai_trend: trend,
          invoices
        };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      query: periodQuery,
      detail: { summary: "One tenant's billing profile and usage", tags: ["Admin"] }
    }
  )

  .patch(
    "/businesses/:id/billing",
    async ({ params, body, set }) => {
      try {
        if (body.pricing_plan_id !== undefined) {
          await assignPlanToBusiness(params.id, body.pricing_plan_id);
        }
        if (body.billing_active !== undefined) {
          const updated = await db
            .update(schema.businesses)
            .set({
              billing_active: body.billing_active ? 1 : 0,
              updated_at: new Date().toISOString()
            })
            .where(eq(schema.businesses.id, params.id))
            .returning({ id: schema.businesses.id });

          if (updated.length === 0) {
            set.status = 404;
            return { success: false, error: "Business not found" };
          }
        }

        return { success: true, plan: (await resolvePlanForBusiness(params.id)) ?? null };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      body: t.Object({
        pricing_plan_id: t.Optional(t.Nullable(t.String())),
        billing_active: t.Optional(t.Boolean())
      }),
      detail: { summary: "Assign a tenant's rate card or pause its billing", tags: ["Admin"] }
    }
  )

  /* ────────────────────────────── pricing ────────────────────────────── */

  .get(
    "/pricing-plans",
    async ({ query, set }) => {
      try {
        return {
          success: true,
          plans: await listPricingPlans(query.include_archived === "true")
        };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      query: t.Object({ include_archived: t.Optional(t.String()) }),
      detail: { summary: "List rate cards", tags: ["Admin"] }
    }
  )

  .post(
    "/pricing-plans",
    async ({ body, set }) => {
      try {
        set.status = 201;
        return { success: true, plan: await createPricingPlan({ ...body, name: body.name }) };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      body: t.Object({ ...planBody, name: t.String({ minLength: 1, maxLength: 80 }) }),
      detail: { summary: "Create a rate card", tags: ["Admin"] }
    }
  )

  .patch(
    "/pricing-plans/:id",
    async ({ params, body, set }) => {
      try {
        const plan = await updatePricingPlan(params.id, body);
        if (!plan) {
          set.status = 404;
          return { success: false, error: "No such pricing plan" };
        }
        return { success: true, plan };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      body: t.Object({ ...planBody, archived: t.Optional(t.Boolean()) }),
      detail: { summary: "Adjust a rate card's prices", tags: ["Admin"] }
    }
  )

  /* ────────────────────────────── invoices ────────────────────────────── */

  .get(
    "/invoices/preview",
    async ({ query, set }) => {
      try {
        const period = { from: query.period_start, to: query.period_end };
        assertValidPeriod(period);

        const business = await getBusinessById(query.business_id);
        if (!business) {
          set.status = 404;
          return { success: false, error: "Business not found" };
        }

        const draft = await buildInvoiceDraft(query.business_id, period);
        return {
          success: true,
          preview: {
            business: { id: business.id, name: business.name, owner_email: business.owner_email },
            ...draft
          }
        };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      query: t.Object({
        business_id: t.String({ minLength: 1 }),
        period_start: t.String({ minLength: 10, maxLength: 10 }),
        period_end: t.String({ minLength: 10, maxLength: 10 })
      }),
      detail: {
        summary: "Price a period's usage without creating an invoice",
        tags: ["Admin"]
      }
    }
  )

  .get(
    "/invoices",
    async ({ query, set }) => {
      try {
        return {
          success: true,
          invoices: await listInvoices({
            business_id: query.business_id,
            status: query.status as InvoiceStatus | undefined,
            limit: query.limit ? Number(query.limit) : undefined
          })
        };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      query: t.Object({
        business_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        limit: t.Optional(t.String())
      }),
      detail: { summary: "List invoices across all tenants", tags: ["Admin"] }
    }
  )

  .post(
    "/invoices",
    async ({ headers, body, set }) => {
      const identity = await requireAdmin(headers);
      try {
        const invoice = await createInvoice({
          business_id: body.business_id,
          period_start: body.period_start,
          period_end: body.period_end,
          due_date: body.due_date,
          notes: body.notes,
          pricing_plan_id: body.pricing_plan_id,
          created_by: identity?.email
        });
        set.status = 201;
        return { success: true, invoice };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      body: t.Object({
        business_id: t.String({ minLength: 1 }),
        period_start: t.String({ minLength: 10, maxLength: 10 }),
        period_end: t.String({ minLength: 10, maxLength: 10 }),
        due_date: t.Optional(t.Nullable(t.String({ maxLength: 10 }))),
        notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        pricing_plan_id: t.Optional(t.Nullable(t.String()))
      }),
      detail: { summary: "Create a draft invoice from metered usage", tags: ["Admin"] }
    }
  )

  .get(
    "/invoices/:id",
    async ({ params, set }) => {
      const invoice = await getInvoice(params.id);
      if (!invoice) {
        set.status = 404;
        return { success: false, error: "Invoice not found" };
      }
      return { success: true, invoice };
    },
    { detail: { summary: "Read one invoice", tags: ["Admin"] } }
  )

  .patch(
    "/invoices/:id",
    async ({ params, body, set }) => {
      try {
        const invoice = await updateInvoiceDraft(params.id, body);
        if (!invoice) {
          set.status = 404;
          return { success: false, error: "Invoice not found" };
        }
        return { success: true, invoice };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      body: t.Object({
        notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
        due_date: t.Optional(t.Nullable(t.String({ maxLength: 10 })))
      }),
      detail: { summary: "Edit a draft invoice's notes or due date", tags: ["Admin"] }
    }
  )

  .delete(
    "/invoices/:id",
    async ({ params, set }) => {
      try {
        const deleted = await deleteDraftInvoice(params.id);
        if (!deleted) {
          set.status = 404;
          return { success: false, error: "Invoice not found" };
        }
        return { success: true };
      } catch (error) {
        return failed(error, set);
      }
    },
    { detail: { summary: "Discard a draft invoice", tags: ["Admin"] } }
  )

  .post(
    "/invoices/:id/send",
    async ({ params, set }) => {
      try {
        const invoice = await getInvoice(params.id);
        if (!invoice) {
          set.status = 404;
          return { success: false, error: "Invoice not found" };
        }
        if (invoice.status === "void") {
          set.status = 409;
          return { success: false, error: "This invoice has been voided" };
        }

        const delivery = await sendInvoiceEmail(invoice, {
          businessName: invoice.business_name ?? invoice.business_id,
          recipientEmail: invoice.owner_email ?? ""
        });

        // Issuing and emailing are separate outcomes. The invoice becomes
        // "sent" either way — the owner can read it in their dashboard — and
        // the email failure is reported rather than hidden.
        const sent = await markInvoiceStatus(params.id, "sent", {
          send_error: delivery.sent ? null : (delivery.error ?? "Email delivery failed")
        });

        return {
          success: true,
          invoice: sent,
          email_sent: delivery.sent,
          ...(delivery.error ? { email_error: delivery.error } : {})
        };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      detail: {
        summary: "Issue an invoice to the business and email it to the owner",
        tags: ["Admin"]
      }
    }
  )

  .post(
    "/invoices/:id/status",
    async ({ params, body, set }) => {
      try {
        const invoice = await markInvoiceStatus(params.id, body.status);
        if (!invoice) {
          set.status = 404;
          return { success: false, error: "Invoice not found" };
        }
        return { success: true, invoice };
      } catch (error) {
        return failed(error, set);
      }
    },
    {
      body: t.Object({
        status: t.Union([t.Literal("paid"), t.Literal("void"), t.Literal("sent")])
      }),
      detail: { summary: "Mark an invoice paid or void", tags: ["Admin"] }
    }
  );
