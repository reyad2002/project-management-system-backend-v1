-- 01_alter_expenses.sql
-- PMS Phase 1: add project/phase/vendor linkage + cost_category to expenses

alter table expenses
  add column if not exists project_id uuid references projects(id) on delete set null,
  add column if not exists phase_id   uuid references phases(id) on delete set null,
  add column if not exists vendor_id  uuid,  -- FK added after vendors table exists (03_create_vendors.sql)
  add column if not exists cost_category varchar(30) not null default 'other';

alter table expenses
  add constraint expenses_cost_category_check
  check (cost_category in ('labor','materials','subcontractor','software','travel','marketing','rent','utilities','other'));

create index if not exists idx_expenses_project on expenses(project_id);
create index if not exists idx_expenses_phase on expenses(phase_id);
