-- 05_triggers.sql
-- PMS Phase 1: DB-level auto-calculation triggers (source of truth safety net;
-- the backend performs the same calculations + validation before writing).

-- (a) sequential invoice number generator per company: INV-YYYY-0001
create sequence if not exists invoice_number_seq;

create or replace function generate_invoice_number(p_company_id uuid)
returns varchar language plpgsql as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_count int;
begin
  select count(*) + 1 into v_count
  from invoices
  where company_id = p_company_id
    and invoice_number like 'INV-' || v_year || '-%';

  return 'INV-' || v_year || '-' || lpad(v_count::text, 4, '0');
end;
$$;

-- (b) recalculate invoice paid/remaining/status from its payments
create or replace function recalc_invoice_totals(p_invoice_id uuid)
returns void language plpgsql as $$
declare
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_due_date date;
begin
  select total_amount, due_date into v_total, v_due_date
  from invoices where id = p_invoice_id;

  select coalesce(sum(amount), 0) into v_paid
  from payments where invoice_id = p_invoice_id;

  update invoices
  set paid_amount = v_paid,
      remaining_amount = v_total - v_paid,
      status = case
        when v_total - v_paid <= 0 then 'paid'
        when v_paid > 0 then 'partially_paid'
        when v_due_date < current_date then 'overdue'
        when status = 'draft' then 'draft'
        else 'sent'
      end,
      updated_at = now()
  where id = p_invoice_id
    and status <> 'cancelled';
end;
$$;

create or replace function trg_payments_after_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    if old.invoice_id is not null then
      perform recalc_invoice_totals(old.invoice_id);
    end if;
    return old;
  else
    if new.invoice_id is not null then
      perform recalc_invoice_totals(new.invoice_id);
    end if;
    if (tg_op = 'UPDATE') and old.invoice_id is not null and old.invoice_id is distinct from new.invoice_id then
      perform recalc_invoice_totals(old.invoice_id);
    end if;
    return new;
  end if;
end;
$$;

drop trigger if exists payments_after_change on payments;
create trigger payments_after_change
after insert or update or delete on payments
for each row execute function trg_payments_after_change();

-- (c) same logic for vendor_bills / vendor_payments
create or replace function recalc_vendor_bill_totals(p_bill_id uuid)
returns void language plpgsql as $$
declare
  v_total numeric(14,2);
  v_paid numeric(14,2);
  v_due_date date;
begin
  select total_amount, due_date into v_total, v_due_date
  from vendor_bills where id = p_bill_id;

  select coalesce(sum(amount), 0) into v_paid
  from vendor_payments where vendor_bill_id = p_bill_id;

  update vendor_bills
  set paid_amount = v_paid,
      remaining_amount = v_total - v_paid,
      status = case
        when v_total - v_paid <= 0 then 'paid'
        when v_paid > 0 then 'partially_paid'
        when v_due_date < current_date then 'overdue'
        else 'pending'
      end
  where id = p_bill_id
    and status <> 'cancelled';
end;
$$;

create or replace function trg_vendor_payments_after_change()
returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE') then
    perform recalc_vendor_bill_totals(old.vendor_bill_id);
    return old;
  else
    perform recalc_vendor_bill_totals(new.vendor_bill_id);
    return new;
  end if;
end;
$$;

drop trigger if exists vendor_payments_after_change on vendor_payments;
create trigger vendor_payments_after_change
after insert or update or delete on vendor_payments
for each row execute function trg_vendor_payments_after_change();

-- (d) compute subtotal/vat/wht/total automatically on invoice insert/update (before save)
create or replace function trg_invoices_before_write()
returns trigger language plpgsql as $$
begin
  new.vat_amount := round(new.subtotal * new.vat_rate / 100, 2);
  new.wht_amount := round(new.subtotal * new.wht_rate / 100, 2);
  new.total_amount := new.subtotal + new.vat_amount - new.wht_amount;
  new.remaining_amount := new.total_amount - coalesce(new.paid_amount, 0);
  new.updated_at := now();

  if new.invoice_number is null then
    new.invoice_number := generate_invoice_number(new.company_id);
  end if;

  return new;
end;
$$;

drop trigger if exists invoices_before_write on invoices;
create trigger invoices_before_write
before insert or update on invoices
for each row execute function trg_invoices_before_write();

-- (e) same auto-calculation for vendor_bills
create or replace function trg_vendor_bills_before_write()
returns trigger language plpgsql as $$
begin
  new.vat_amount := round(new.subtotal * new.vat_rate / 100, 2);
  new.wht_amount := round(new.subtotal * new.wht_rate / 100, 2);
  new.total_amount := new.subtotal + new.vat_amount - new.wht_amount;
  new.remaining_amount := new.total_amount - coalesce(new.paid_amount, 0);
  return new;
end;
$$;

drop trigger if exists vendor_bills_before_write on vendor_bills;
create trigger vendor_bills_before_write
before insert or update on vendor_bills
for each row execute function trg_vendor_bills_before_write();
