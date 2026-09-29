/**
 * The tenant's own view of billing.
 *
 * An owner sees the bills addressed to them, the rate card those bills are
 * priced on, and the usage behind the current period — read-only. Drafts are
 * withheld: a draft is the admin's working copy, not yet a bill the customer
 * has been asked to pay.
 *
 * This is also what makes email delivery non-critical. If SMTP is off, the
 * invoice is still here waiting for the owner.
 */

import { Elysia, t } from "elysia";
import { getInvoice, listInvoices, resolvePlanForBusiness } from "../services/BillingService";
import { summarizeUsage } from "../services/UsageMeter";
import { getBusinessById } from "../services/BusinessRegistry";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Defaults to the calendar month so far — the period the next bill covers. */
function resolvePeriod(query: { from?: string; to?: string }): { from: string; to: string } {
  const to = DATE_RE.test(query.to ?? "") ? (query.to as string) : today();
  const from = DATE_RE.test(query.from ?? "")
    ? (query.from as string)
    : `${to.slice(0, 7)}-01`;

  return { from: from > to ? to : from, to };
}

/** Prices are shown to the owner; the plan's internal flags are not. */
function toPublicPlan(plan: Awaited<ReturnType<typeof resolvePlanForBusiness>>) {
  if (!plan) return null;
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    currency: plan.currency,
    monthly_fee: plan.monthly_fee,
    included_ai_requests: plan.included_ai_requests,
    price_per_ai_request: plan.price_per_ai_request,
    included_conversations: plan.included_conversations,
    price_per_conversation: plan.price_per_conversation,
    included_messages: plan.included_messages,
    price_per_message: plan.price_per_message,
    tax_percent: plan.tax_percent
  };
}

export const billingRoutes = new Elysia({ prefix: "/api/businesses" })
  .get(
    "/:id/billing",
    async ({ params, query, set }) => {
      const business = await getBusinessById(params.id);
      if (!business) {
        set.status = 404;
        return { success: false, error: "Business not found" };
      }

      const period = resolvePeriod(query);
      const [plan, usage, invoices] = await Promise.all([
        resolvePlanForBusiness(params.id),
        summarizeUsage(params.id, period),
        listInvoices({ business_id: params.id, limit: 100 })
      ]);

      const issued = invoices.filter((invoice) => invoice.status !== "draft");

      return {
        success: true,
        period,
        plan: toPublicPlan(plan),
        usage,
        invoices: issued,
        outstanding_total: Number(
          issued
            .filter((invoice) => invoice.status === "sent")
            .reduce((total, invoice) => total + invoice.total, 0)
            .toFixed(2)
        )
      };
    },
    {
      query: t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()) }),
      detail: {
        summary: "This business's plan, current usage and issued invoices",
        tags: ["Billing"]
      }
    }
  )

  .get(
    "/:id/invoices/:invoiceId",
    async ({ params, set }) => {
      const invoice = await getInvoice(params.invoiceId);

      // A missing invoice and another tenant's invoice answer identically, so
      // the endpoint cannot be walked to discover what other tenants are billed.
      if (!invoice || invoice.business_id !== params.id || invoice.status === "draft") {
        set.status = 404;
        return { success: false, error: "Invoice not found" };
      }

      return { success: true, invoice };
    },
    { detail: { summary: "Read one of this business's invoices", tags: ["Billing"] } }
  );
