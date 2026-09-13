-- 06_views.sql
-- PMS Phase 1: reporting views (AR aging, AP aging, project profitability)

create or replace view v_ar_aging as
select
  i.id, i.company_id, i.invoice_number, i.client_id, c.name as client_name,
  i.project_id, i.due_date, i.remaining_amount,
  greatest((current_date - i.due_date), 0) as days_overdue,
  case
    when current_date <= i.due_date then 'current'
    when current_date - i.due_date between 1 and 30 then '1_30'
    when current_date - i.due_date between 31 and 60 then '31_60'
    when current_date - i.due_date between 61 and 90 then '61_90'
    else 'over_90'
  end as bucket
from invoices i
join clients c on c.id = i.client_id
where i.status not in ('paid','cancelled') and i.remaining_amount > 0;

create or replace view v_ap_aging as
select
  b.id, b.company_id, b.bill_number, b.vendor_id, v.name as vendor_name,
  b.project_id, b.due_date, b.remaining_amount,
  greatest((current_date - b.due_date), 0) as days_overdue,
  case
    when current_date <= b.due_date then 'current'
    when current_date - b.due_date between 1 and 30 then '1_30'
    when current_date - b.due_date between 31 and 60 then '31_60'
    when current_date - b.due_date between 61 and 90 then '61_90'
    else 'over_90'
  end as bucket
from vendor_bills b
join vendors v on v.id = b.vendor_id
where b.status not in ('paid','cancelled') and b.remaining_amount > 0;

create or replace view v_project_profitability as
select
  p.id as project_id, p.company_id, p.title,
  coalesce((select sum(i.subtotal) from invoices i where i.project_id = p.id and i.status <> 'cancelled'), 0) as recognized_revenue,
  coalesce((select sum(e.amount) from expenses e where e.project_id = p.id), 0)
    + coalesce((select sum(vb.subtotal) from vendor_bills vb where vb.project_id = p.id and vb.status <> 'cancelled'), 0) as total_cost
from projects p;
