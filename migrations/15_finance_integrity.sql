-- 15_finance_integrity.sql
-- Finance clean-up support (applied to Supabase as 27_finance_integrity):
--  * projects.is_test      — test/demo projects are excluded from every dashboard/report figure
--  * projects.ad_budget    — the part of a marketing package price that is the client's ad budget
--                            (the client pays one package; ad spend is tracked against this budget)
--  * new expense categories:
--      salary, ad_spend, legal, bank_fees  -> normal P&L costs
--      advance   (employee advance, recovered through salary deduction) -> NOT a P&L expense
--      equipment (capital purchase: PCs, SSDs, GPUs...)                 -> NOT a P&L expense
-- Additive only; no existing row is changed by this migration.

alter table projects
  add column is_test boolean not null default false,
  add column ad_budget numeric(14, 2) not null default 0 check (ad_budget >= 0);

alter table expenses drop constraint expenses_cost_category_check;
alter table expenses add constraint expenses_cost_category_check check (
  (cost_category)::text = any (array[
    'labor','materials','subcontractor','software','travel','marketing','rent','utilities','other',
    'salary','ad_spend','equipment','legal','bank_fees','advance'
  ]::text[])
);
