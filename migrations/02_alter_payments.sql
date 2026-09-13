-- 02_alter_payments.sql
-- PMS Phase 1: link payments to invoices + advance/settlement type

alter table payments
  add column if not exists invoice_id uuid,  -- FK added after invoices table exists (04_create_invoices.sql)
  add column if not exists type varchar(20) not null default 'invoice_settlement';

alter table payments
  add constraint payments_type_check
  check (type in ('advance','invoice_settlement'));

create index if not exists idx_payments_invoice on payments(invoice_id);
