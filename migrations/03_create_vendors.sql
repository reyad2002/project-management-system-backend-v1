-- 03_create_vendors.sql
-- PMS Phase 1: vendors, vendor_bills, vendor_payments (Accounts Payable)

create table vendors (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  name              varchar(150) not null,
  tax_id            varchar(50),
  email             varchar(150),
  phone             varchar(30),
  address           text,
  default_wht_rate  numeric(5,2) not null default 0,
  notes             text,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now()
);

create index idx_vendors_company on vendors(company_id);

-- now link expenses.vendor_id now that vendors exists
alter table expenses
  add constraint expenses_vendor_id_fkey
  foreign key (vendor_id) references vendors(id) on delete set null;

create table vendor_bills (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  vendor_id         uuid not null references vendors(id) on delete restrict,
  project_id        uuid references projects(id) on delete set null,

  bill_number       varchar(50),
  bill_date         date not null,
  due_date          date not null,

  subtotal          numeric(14,2) not null check (subtotal >= 0),
  vat_rate          numeric(5,2)  not null default 14.00,
  vat_amount        numeric(14,2) not null default 0,
  wht_rate          numeric(5,2)  not null default 0,
  wht_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null,
  paid_amount       numeric(14,2) not null default 0,
  remaining_amount  numeric(14,2) not null,

  status            varchar(20) not null default 'pending'
    check (status in ('pending','partially_paid','paid','overdue','cancelled')),
  cost_category     varchar(30) not null default 'other'
    check (cost_category in ('labor','materials','subcontractor','software','travel','marketing','rent','utilities','other')),

  notes             text,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now()
);

create index idx_vendor_bills_company_status on vendor_bills(company_id, status);
create index idx_vendor_bills_vendor on vendor_bills(vendor_id);
create index idx_vendor_bills_project on vendor_bills(project_id);

create table vendor_payments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  vendor_bill_id  uuid not null references vendor_bills(id) on delete cascade,
  amount          numeric(14,2) not null check (amount > 0),
  payment_date    date not null,
  payment_method  varchar(20) not null
    check (payment_method in ('cash','bank_transfer','credit_card','other')),
  notes           text,
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);

create index idx_vendor_payments_bill on vendor_payments(vendor_bill_id);
