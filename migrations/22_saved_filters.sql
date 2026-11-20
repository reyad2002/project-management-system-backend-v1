-- 22: Saved filters ("my overdue tasks", "active marketing projects"): a named set of a page's filters, per person.
create table saved_filters (
  id bigint generated always as identity primary key,
  company_id bigint not null references company(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  page text not null,
  name text not null check (char_length(name) between 1 and 60),
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index saved_filters_user_page_name_uidx on saved_filters (user_id, page, lower(name));
create index idx_saved_filters_user_page on saved_filters (user_id, page);
create index idx_saved_filters_company on saved_filters (company_id);

alter table saved_filters enable row level security;
revoke all on saved_filters from anon, authenticated;
