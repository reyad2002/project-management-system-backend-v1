import { supabaseAdmin } from "../../db_connection.js";
import { addBillingCycle, todayStr } from "./recurring.js";
import { insertAudit } from "./audit.js";

/**
 * Automatic deduction of subscriptions (hosting, AI, tools — monthly or yearly).
 *
 * A subscription with auto_charge = true that has reached its next_due_date gets an expense recorded
 * for that date and its next_due_date moved forward by one billing cycle; if several cycles were
 * missed (the job didn't run, or the date was entered in the past) each missed cycle gets its own
 * expense, dated on its due date.
 *
 * Safe to run any number of times, concurrently or not: expenses carry (recurring_expense_id,
 * expense_date), which is unique in the database, so a cycle can never be charged twice.
 * It runs from the daily cron AND whenever subscriptions / the dashboard are opened, so the books
 * stay right even if the cron isn't scheduled.
 */

const CATEGORY_BY_TYPE = {
  hosting_cost: "software",
  ai_subscription: "software",
  tool_subscription: "software",
  other: "other",
};

/** Safety valve: a typo like year 1999 must not create thousands of expenses. */
const MAX_CYCLES_PER_RUN = 24;

/** The expense that one cycle of `subscription` turns into. Shared by auto-charge and "mark paid". */
export function expenseForCycle(subscription, dueDate) {
  const projectId = subscription.linked_project_id ?? null;
  return {
    company_id: subscription.company_id,
    project_id: projectId,
    amount: subscription.amount,
    expense_date: dueDate,
    title: `Recurring: ${subscription.name}`,
    // A subscription tied to a project is a cost of that project; otherwise it's a company overhead.
    type: projectId ? "direct" : "operational",
    cost_category: CATEGORY_BY_TYPE[subscription.type] ?? "other",
    recurring_expense_id: subscription.id,
  };
}

/**
 * @param {{ companyId?: string|number, throttleMs?: number }} [options] limit to one company (omit for every company);
 *   throttleMs skips the check if this instance already ran it that recently
 * @returns the expenses that were created, one entry per charged cycle
 */
const lastChecked = new Map();
export function clearChargeThrottle() {
  lastChecked.clear();
}

export async function chargeDueRecurringExpenses({ companyId, throttleMs = 0 } = {}) {
  const today = todayStr();

  // Page-open callers pass throttleMs: nothing new falls due within a minute, so skip the round trips.
  if (throttleMs > 0) {
    const key = `${companyId ?? "all"}:${today}`;
    const at = lastChecked.get(key);
    if (at && Date.now() - at < throttleMs) return [];
    if (lastChecked.size > 200) lastChecked.clear();
    lastChecked.set(key, Date.now());
  }

  let query = supabaseAdmin
    .from("recurring_expenses")
    .select("*")
    .eq("status", "active")
    .eq("auto_charge", true)
    .lte("next_due_date", today);
  if (companyId) query = query.eq("company_id", companyId);

  const { data: due, error } = await query;
  if (error) throw error;

  const charged = [];
  for (const subscription of due || []) {
    const originalDueDate = subscription.next_due_date;
    let dueDate = originalDueDate;
    let lastPaid = subscription.last_paid_date;
    let cycles = 0;

    while (dueDate <= today && cycles < MAX_CYCLES_PER_RUN) {
      const { error: insertError } = await supabaseAdmin.from("expenses").insert(expenseForCycle(subscription, dueDate));
      // 23505 = this cycle already has its expense (someone marked it paid, or another run got there first).
      if (insertError && insertError.code !== "23505") throw insertError;

      if (!insertError) {
        charged.push({
          subscription_id: subscription.id,
          company_id: subscription.company_id,
          name: subscription.name,
          amount: Number(subscription.amount),
          date: dueDate,
        });
        await insertAudit({
          company_id: subscription.company_id,
          actor_type: "system",
          actor_name: "Automatic billing",
          action: "auto_charge",
          entity_type: "recurring_expense",
          entity_id: subscription.id,
          summary: `Automatically charged ${subscription.name}: ${Number(subscription.amount)} for ${dueDate}`,
          metadata: { billing_cycle: subscription.billing_cycle, due_date: dueDate },
        });
      }

      lastPaid = dueDate;
      dueDate = addBillingCycle(dueDate, subscription.billing_cycle);
      cycles += 1;
    }

    // Only move the date if nobody else did meanwhile (optimistic concurrency on next_due_date).
    const { error: updateError } = await supabaseAdmin
      .from("recurring_expenses")
      .update({ last_paid_date: lastPaid, next_due_date: dueDate, updated_at: new Date().toISOString() })
      .eq("id", subscription.id)
      .eq("next_due_date", originalDueDate);
    if (updateError) throw updateError;
  }

  return charged;
}
