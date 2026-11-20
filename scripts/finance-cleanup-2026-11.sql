-- finance-cleanup-2026-11.sql
-- ============================================================================================
-- REVIEW BEFORE RUNNING — NOT APPLIED. Nothing here has been executed against the database.
-- Prerequisite: migrations/15_finance_integrity.sql (is_test, ad_budget, new expense categories).
-- Every statement is an UPDATE by explicit id (no deletes). Lines marked [CONFIRM] are guesses
-- from the expense titles — change the id/value if the guess is wrong before running.
-- Run it inside the transaction below; the final SELECTs show the result before COMMIT.
-- ============================================================================================

begin;

-- 1) Test / demo projects (confirmed by the owner): excluded from every report -----------------
update projects set is_test = true
where id in (1, 3, 24)
  and title in ('Website Redesign', 'Redesign', 'Test PR');
-- Not touched: "Zezo" (id 26, price 30,000, 2 invoices) — mark it too if it is a test project.

-- 2) Employee advances — recovered through salary deduction, so not a P&L expense -------------
--    (record salaries at their GROSS amount; the advance is only a receivable until deducted)
update expenses set cost_category = 'advance', type = 'operational'
where id in (38, 39, 45);                       -- سلفة زياد 4,000 · سلفة اسلام 12,000 · reyad سلفة 500

-- 3) Equipment — capital purchases, not running costs ---------------------------------------------
update expenses set cost_category = 'equipment', type = 'operational'
where id in (36, 37, 43, 18);                   -- PC 2,500 · GPU 500 · SSD 3,700 · mic/ring light 1,750

-- 4) Payroll ------------------------------------------------------------------------------------------
update expenses set cost_category = 'salary', type = 'operational'
where id in (22, 34);                           -- code headers Salary 28,000 · team bonuses 10,000

-- 5) Freelancers ------------------------------------------------------------------------------------
update expenses set cost_category = 'subcontractor', type = 'operational'
where id in (23, 31);                           -- Ghada Design 13,800 · designs 1,000 [CONFIRM: link to a project if specific]

-- 6) Client ad spend (the client pays the full package; ad spend is tracked against the package) ----
update expenses set cost_category = 'ad_spend', type = 'direct', project_id = 12
where id = 21;                                  -- Clinica ads 8,800 -> "Marketing Clinica" [CONFIRM project 12]
-- The company's own advertising is a normal operating cost, not client ad spend:
update expenses set cost_category = 'marketing', type = 'operational'
where id = 19;                                  -- code wars ads 1,000

-- 7) Legal, bank, tools -------------------------------------------------------------------------------
update expenses set cost_category = 'legal', type = 'operational'
where id in (12, 13, 17);                       -- contracts 930 · lawyer 13,500 · paper work + domain 6,000 [CONFIRM: 17 mixes a domain]
update expenses set cost_category = 'bank_fees', type = 'operational'
where id = 20;                                  -- Bank 3,300
update expenses set cost_category = 'software', type = 'operational'
where id in (2, 3, 10, 44);                     -- hosting x2 · vercel · ollama + vercel

-- 8) Client domain -> its project (direct cost) ---------------------------------------------------------
update expenses set cost_category = 'software', type = 'direct', project_id = 20
where id = 33;                                  -- دومين المحامى مستر كريم 700 -> "Mr kariem portfolio website" [CONFIRM project 20]

-- 9) Everything still "direct" but with no project cannot be a project cost: make it operational.
--    Give these a real project later (Expenses -> edit) if they belong to one.
update expenses set type = 'operational'
where type = 'direct' and project_id is null;

-- 10) Duplicate payment (same project / date / amount / method, no notes) — DELETE NOT INCLUDED -----
--     Payments 52 and 53: project 13 "fox booking system", 2026-09-14, 12,000 bank transfer.
--     If it is a double entry, run:   delete from payments where id = 53;
--     (project 13 is overpaid by 6,500 today; removing one 12,000 leaves it 5,500 short of its price.)

-- 11) Still to decide with the owner (no statement written) ----------------------------------------------
--     * Elite Hurghada (project 21): paid 26,000 vs price 23,000 -> raise the price or fix a payment.
--     * Cancelled projects (Sinbad 5,000 · Shadwan 3,500 · POP 4,500 collected): keep as income or refund?
--     * Cash payments have no notes: add who received each one.
--     * Months with no costs recorded (Aug 2025 – Jan 2026, Oct–Nov 2026) and recurring subscriptions.

-- Result check (review these, then COMMIT or ROLLBACK) -------------------------------------------------
select cost_category, type, count(*) n, sum(amount) total from expenses group by 1, 2 order by 1, 2;
select id, title, is_test from projects where is_test;

-- commit;
rollback;  -- <- replace with COMMIT once the checks above look right
