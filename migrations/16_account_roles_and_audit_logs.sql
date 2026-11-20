-- 16_account_roles_and_audit_logs.sql  (applied to Supabase as 28_account_roles_and_audit_logs)
--
-- Accounts: users get a role (owner / admin / manager / accountant / member), a forced password
-- change flag (set whenever an admin creates the account or resets its password) and last_login_at.
-- Audit: audit_logs is an append-only record of who did what — UPDATE/DELETE/TRUNCATE are rejected
-- by triggers. The table is closed to anon/authenticated; only the backend (service role) writes it.
--
-- Role assignment for the accounts that existed when this ran (change them from Accounts afterwards):
--   owner   : user 7 "reyad mohamed" (company 7) and user 6 "ahmed" (company 8, its only user)
--   manager : users 5, 8, 9 — same access as before, minus account administration and the audit log

alter table users
  add column role text not null default 'member'
    check (role in ('owner', 'admin', 'manager', 'accountant', 'member')),
  add column must_change_password boolean not null default false,
  add column last_login_at timestamptz;

update users set role = 'owner' where id in (6, 7);
update users set role = 'manager' where id in (5, 8, 9);

create table audit_logs (
  id           bigint generated always as identity primary key,
  company_id   bigint,
  occurred_at  timestamptz not null default now(),
  actor_type   text not null check (actor_type in ('user', 'client_portal_user', 'system', 'anonymous')),
  actor_id     bigint,
  actor_name   text,
  action       text not null,
  entity_type  text,
  entity_id    text,
  outcome      text not null default 'success' check (outcome in ('success', 'failure')),
  status_code  integer,
  method       text,
  path         text,
  ip           text,
  user_agent   text,
  summary      text,
  before       jsonb,
  after        jsonb,
  metadata     jsonb not null default '{}'::jsonb
);

create index idx_audit_logs_company_time on audit_logs (company_id, occurred_at desc);
create index idx_audit_logs_entity on audit_logs (entity_type, entity_id);
create index idx_audit_logs_actor on audit_logs (actor_type, actor_id);
create index idx_audit_logs_action on audit_logs (action);

create function audit_logs_immutable() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_logs is append-only';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on audit_logs
  for each row execute function audit_logs_immutable();

create trigger audit_logs_no_truncate
  before truncate on audit_logs
  for each statement execute function audit_logs_immutable();

alter table audit_logs enable row level security;
revoke all on audit_logs from anon, authenticated;
