-- 20: Task templates (ready-made task lists per project type) and recurring tasks.
-- ids are bigint like the rest of the live schema. RLS on, no client grants (the API uses the service role).

create table task_templates (
  id bigint generated always as identity primary key,
  company_id bigint not null references company(id) on delete cascade,
  name text not null,
  description text,
  project_type text,                      -- the project type it is meant for (informational)
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_task_templates_company on task_templates (company_id);

create table task_template_items (
  id bigint generated always as identity primary key,
  template_id bigint not null references task_templates(id) on delete cascade,
  position integer not null default 0,
  title text not null,
  description text,
  priority varchar not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  -- due date = project start date + this many days
  due_offset_days integer not null default 0 check (due_offset_days between 0 and 3650),
  checklist jsonb not null default '[]'::jsonb
);
create index idx_task_template_items_template on task_template_items (template_id, position);

create table recurring_tasks (
  id bigint generated always as identity primary key,
  company_id bigint not null references company(id) on delete cascade,
  project_id bigint references projects(id) on delete cascade,   -- null = internal company task
  title text not null,
  description text,
  priority varchar not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  assignee_id bigint references users(id) on delete set null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday integer check (weekday between 0 and 6),                -- 0 = Sunday ... 6 = Saturday (weekly)
  day_of_month integer check (day_of_month between 1 and 31),     -- monthly; 31 = last day of shorter months
  due_in_days integer not null default 0 check (due_in_days between 0 and 365),
  checklist jsonb not null default '[]'::jsonb,
  start_date date not null default current_date,
  end_date date,
  next_run_date date not null,
  last_run_date date,
  status text not null default 'active' check (status in ('active', 'paused')),
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_recurring_task_shape check (
    (frequency = 'weekly' and weekday is not null)
    or (frequency = 'monthly' and day_of_month is not null)
    or frequency = 'daily'
  ),
  constraint chk_recurring_task_dates check (end_date is null or end_date >= start_date)
);
create index idx_recurring_tasks_company on recurring_tasks (company_id);
create index idx_recurring_tasks_due on recurring_tasks (next_run_date) where status = 'active';
create index idx_recurring_tasks_project on recurring_tasks (project_id);
create index idx_recurring_tasks_assignee on recurring_tasks (assignee_id);

-- where a task came from
alter table tasks add column recurring_task_id bigint references recurring_tasks(id) on delete set null;
alter table tasks add column recurrence_date date;
alter table tasks add column template_id bigint references task_templates(id) on delete set null;
-- a cycle of a recurring task is generated at most once, however often the generator runs
create unique index tasks_recurrence_uidx on tasks (recurring_task_id, recurrence_date) where recurring_task_id is not null;
create index idx_tasks_template on tasks (template_id) where template_id is not null;
create index idx_tasks_recurring on tasks (recurring_task_id) where recurring_task_id is not null;

-- default templates are added once per company (lazily, by the API)
alter table company add column task_templates_seeded boolean not null default false;

alter table task_templates enable row level security;
alter table task_template_items enable row level security;
alter table recurring_tasks enable row level security;
revoke all on task_templates, task_template_items, recurring_tasks from anon, authenticated;
