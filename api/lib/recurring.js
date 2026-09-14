// Enums mirror the live Postgres enum types exactly (verified via PostgREST introspection on
// 2026-09-14) — this schema was created directly against Supabase by the DB owner, not by a
// migration in this repo. Note the asymmetry: recurring_revenue_status has 'overdue',
// recurring_expense_status does NOT — recurring_expenses "overdue" is a computed state
// (next_due_date in the past), never a stored status value.
export const billingCycles = ["monthly", "yearly"];

export const recurringRevenueTypes = ["hosting", "maintenance", "other"];
export const recurringRevenueStatuses = ["active", "cancelled", "overdue"];

export const recurringExpenseTypes = ["hosting_cost", "ai_subscription", "tool_subscription", "other"];
export const recurringExpenseStatuses = ["active", "cancelled"];

export const investmentReturnCycles = ["one_time", "monthly", "yearly"];
export const investmentStatuses = ["active", "closed"];

/**
 * Add one billing cycle to a YYYY-MM-DD date string, returning a new YYYY-MM-DD string.
 */
export function addBillingCycle(dateStr, cycle) {
  const d = new Date(dateStr);
  if (cycle === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * [start of this month, end of `monthsAhead` months from now] as YYYY-MM-DD strings.
 * monthRange(1) covers "this month + next month".
 */
export function monthRange(monthsAhead) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsAhead + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
