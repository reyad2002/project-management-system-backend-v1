-- 23: project budgets (expected cost), client contact log, budget alerts.

-- Expected cost of delivering the project. NULL = no budget set.
alter table projects add column budget_cost numeric check (budget_cost is null or budget_cost >= 0);
-- Which budget warning was already sent: 0 none, 1 reached 80%, 2 went over budget (so each is sent once).
alter table projects add column budget_alert_level smallint not null default 0 check (budget_alert_level in (0, 1, 2));

-- "Last contact" for the client health score: calls, WhatsApp, emails, visits logged by the team.
create table client_contacts (
  id bigint generated always as identity primary key,
  company_id bigint not null references company(id) on delete cascade,
  client_id bigint not null references clients(id) on delete cascade,
  user_id bigint references users(id) on delete set null,
  kind text not null default 'call' check (kind in ('call', 'whatsapp', 'email', 'meeting', 'visit', 'other')),
  note text check (note is null or char_length(note) <= 1000),
  contacted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_client_contacts_client on client_contacts (client_id, contacted_at desc);
create index idx_client_contacts_company on client_contacts (company_id);
create index idx_client_contacts_user on client_contacts (user_id);

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (
  (type)::text = any ((array[
    'meeting_reminder', 'meeting_note_added', 'action_item_assigned', 'phase_approved',
    'task_assigned_to_client', 'feedback_requested', 'meeting_cancelled', 'file_uploaded',
    'file_status_changed', 'recurring_payment_due', 'task_assigned', 'task_overdue',
    'task_due_soon', 'task_escalated', 'task_comment', 'task_mention', 'project_budget'
  ])::text[])
);
alter table notifications drop constraint if exists notifications_related_type_check;
alter table notifications add constraint notifications_related_type_check check (
  related_type is null or (related_type)::text = any ((array[
    'meeting', 'task', 'phase', 'invoice', 'recurring_revenue', 'recurring_expense', 'file', 'project'
  ])::text[])
);

alter table client_contacts enable row level security;
revoke all on client_contacts from anon, authenticated;
