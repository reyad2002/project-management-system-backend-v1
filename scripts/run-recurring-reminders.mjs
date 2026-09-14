// Runs the recurring billing cron job directly (no HTTP hop). Invoke from an external
// scheduler once a day:
//   node scripts/run-recurring-reminders.mjs
import { runRecurringBillingJob } from "../api/lib/recurringReminders.js";

runRecurringBillingJob()
  .then((result) => {
    console.log(
      `[recurring-billing-cron] overdue: ${result.overdueRevenueIds.length} revenue; reminded: ${result.remindedRevenueIds.length} revenue, ${result.remindedExpenseIds.length} expenses`
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("[recurring-billing-cron] failed:", err);
    process.exit(1);
  });
