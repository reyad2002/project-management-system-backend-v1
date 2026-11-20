-- 21: Task collaboration: comments (with @mentions), link attachments, smarter reminders.

create table task_comments (
  id bigint generated always as identity primary key,
  task_id bigint not null references tasks(id) on delete cascade,
  company_id bigint not null references company(id) on delete cascade,
  author_id bigint references users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  mentions bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index idx_task_comments_task on task_comments (task_id, created_at);
create index idx_task_comments_company on task_comments (company_id);

-- Attachments are links (Drive, Figma, ...), like project files.
create table task_attachments (
  id bigint generated always as identity primary key,
  task_id bigint not null references tasks(id) on delete cascade,
  company_id bigint not null references company(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  url text not null check (char_length(url) <= 2000),
  added_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_task_attachments_task on task_attachments (task_id);
create index idx_task_attachments_company on task_attachments (company_id);

-- Daily e-mail digest: opt-out per person, and a log so a day's digest is sent at most once.
alter table users add column task_digest_enabled boolean not null default true;
create table task_digest_log (
  user_id bigint not null references users(id) on delete cascade,
  digest_date date not null,
  primary key (user_id, digest_date)
);

-- Overdue-for-days tasks are escalated to managers once.
alter table tasks add column escalated_at timestamptz;

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (
  (type)::text = any ((array[
    'meeting_reminder', 'meeting_note_added', 'action_item_assigned', 'phase_approved',
    'task_assigned_to_client', 'feedback_requested', 'meeting_cancelled', 'file_uploaded',
    'file_status_changed', 'recurring_payment_due', 'task_assigned', 'task_overdue',
    'task_due_soon', 'task_escalated', 'task_comment', 'task_mention'
  ])::text[])
);

alter table task_comments enable row level security;
alter table task_attachments enable row level security;
alter table task_digest_log enable row level security;
revoke all on task_comments, task_attachments, task_digest_log from anon, authenticated;
