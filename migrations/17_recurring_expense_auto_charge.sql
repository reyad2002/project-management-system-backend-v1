-- 17_recurring_expense_auto_charge.sql  (applied to Supabase as 29_recurring_expense_auto_charge)
--
-- Subscriptions can charge themselves: when a recurring expense (monthly or yearly) reaches its
-- next_due_date, the daily job — or anyone opening Subscriptions / the dashboard — records the
-- expense and moves next_due_date forward one billing cycle. See api/lib/recurringCharges.js.

alter table recurring_expenses add column auto_charge boolean not null default true;

-- Each generated expense points back at its subscription. One expense per subscription per due date,
-- enforced by the database, so re-running the job (or a manual "mark paid") can never double-charge.
alter table expenses add column recurring_expense_id bigint references recurring_expenses(id) on delete set null;
create unique index expenses_recurring_cycle_uidx
  on expenses (recurring_expense_id, expense_date)
  where recurring_expense_id is not null;
