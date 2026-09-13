-- 04_create_invoices.sql
-- PMS Phase 1: invoices (Accounts Receivable)

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete restrict,
  project_id        uuid not null references projects(id) on delete restrict,
  phase_id          uuid references phases(id) on delete set null,

  invoice_number    varchar(30) not null,
  issue_date        date not null,
  due_date          date not null,

  currency          varchar(3) not null default 'EGP',
  subtotal          numeric(14,2) not null check (subtotal >= 0),
  vat_rate          numeric(5,2)  not null default 14.00,
  vat_amount        numeric(14,2) not null default 0,
  wht_rate          numeric(5,2)  not null default 0,
  wht_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null,
  paid_amount       numeric(14,2) not null default 0,
  remaining_amount  numeric(14,2) not null,

  status            varchar(20) not null default 'draft'
    check (status in ('draft','sent','partially_paid','paid','overdue','cancelled')),

  retainage_percent numeric(5,2),
  eta_uuid          varchar(100),
  eta_status        varchar(20) check (eta_status in ('not_submitted','submitted','accepted','rejected')),

  notes             text,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  cancelled_at      timestamptz,

  unique (company_id, invoice_number)
);

create index idx_invoices_company_status on invoices(company_id, status);
create index idx_invoices_project on invoices(project_id);
create index idx_invoices_client on invoices(client_id);
create index idx_invoices_due_date on invoices(due_date) where status not in ('paid','cancelled');

-- now link payments.invoice_id now that invoices exists
alter table payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references invoices(id) on delete set null;
