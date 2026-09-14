import { supabaseAdmin } from "../../db_connection.js";
import { createNotifications } from "./notifications.js";
import { todayStr } from "./recurring.js";

const REMINDER_WINDOW_DAYS = 7;

/**
 * recurring_revenue_status has an 'overdue' value; recurring_expense_status does not (verified
 * live) — only recurring_revenue gets this status transition. Expense "overdue" is a computed
 * read (see recurringExpensesController.overdue), never written.
 */
async function markRevenueOverdue() {
  const { data, error } = await supabaseAdmin
    .from("recurring_revenue")
    .update({ status: "overdue", updated_at: new Date().toISOString() })
    .eq("status", "active")
    .lt("next_renewal_date", todayStr())
    .select("id");
  if (error) throw error;
  return (data || []).map((r) => r.id);
}

/**
 * Notify every active team member about records due within the reminder window. Idempotent per
 * billing cycle without a dedicated column: skips a record if a 'recurring_payment_due'
 * notification for it already exists more recently than its last_paid_date (or ever, if it's
 * never been paid) — markPaid advancing last_paid_date naturally reopens the window next cycle.
 */
async function sendUpcomingReminders(tableName, dateColumn, relatedType, selectFields, titleField, statusFilter) {
  const today = todayStr();
  const windowEnd = new Date(Date.now() + REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let query = supabaseAdmin
    .from(tableName)
    .select(selectFields)
    .gte(dateColumn, today)
    .lte(dateColumn, windowEnd);
  query = statusFilter ? query.in("status", statusFilter) : query;

  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  const rowIds = rows.map((r) => r.id);
  const { data: existingReminders, error: remindersErr } = await supabaseAdmin
    .from("notifications")
    .select("related_id, created_at")
    .eq("type", "recurring_payment_due")
    .eq("related_type", relatedType)
    .in("related_id", rowIds)
    .order("created_at", { ascending: false });
  if (remindersErr) throw remindersErr;

  const lastReminderById = {};
  (existingReminders || []).forEach((n) => {
    const key = String(n.related_id);
    if (!lastReminderById[key]) lastReminderById[key] = n.created_at; // first hit per id = most recent, since ordered desc
  });

  const remindedIds = [];
  for (const row of rows) {
    const lastReminder = lastReminderById[String(row.id)];
    const sinceCycleStart = row.last_paid_date ? new Date(row.last_paid_date).getTime() : 0;
    if (lastReminder && new Date(lastReminder).getTime() >= sinceCycleStart) continue; // already reminded this cycle

    const { data: users, error: usersErr } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("company_id", row.company_id)
      .eq("status", "active");
    if (usersErr) throw usersErr;

    if (users && users.length > 0) {
      await createNotifications(
        users.map((u) => ({
          company_id: row.company_id,
          recipient_type: "team_member",
          recipient_id: u.id,
          type: "recurring_payment_due",
          title: `Due soon: ${row[titleField]} (${row[dateColumn]})`,
          body: `Amount: ${row.amount}`,
          related_type: relatedType,
          related_id: row.id,
        }))
      );
    }

    remindedIds.push(row.id);
  }

  return remindedIds;
}

/**
 * Runs daily (via an external scheduler hitting POST/GET /api/internal/cron/recurring-billing,
 * or `node scripts/run-recurring-reminders.mjs`): flags overdue recurring revenue, and reminds
 * the team about anything (revenue or expense) due within the next 7 days, once per billing cycle.
 */
export async function runRecurringBillingJob() {
  const overdueRevenueIds = await markRevenueOverdue();

  const [remindedRevenueIds, remindedExpenseIds] = await Promise.all([
    sendUpcomingReminders(
      "recurring_revenue",
      "next_renewal_date",
      "recurring_revenue",
      "id, company_id, type, amount, next_renewal_date, last_paid_date, status",
      "type",
      ["active", "overdue"]
    ),
    sendUpcomingReminders(
      "recurring_expenses",
      "next_due_date",
      "recurring_expense",
      "id, company_id, name, amount, next_due_date, last_paid_date, status",
      "name",
      ["active"]
    ),
  ]);

  return {
    overdueRevenueIds,
    remindedRevenueIds,
    remindedExpenseIds,
  };
}
