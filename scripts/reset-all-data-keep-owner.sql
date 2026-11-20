-- reset-all-data-keep-owner.sql
-- ============================================================================================
-- DESTRUCTIVE AND IRREVERSIBLE. Deletes every row of business data and keeps only the owner
-- account (reyad@gmail.com) and its company. Run it in the Supabase SQL editor, ONLY after you
-- have a backup (one was saved to Documents\pms-backups\pms-supabase-backup-2026-11-20-14-09-20.json).
-- Everything runs in one transaction: if any statement fails, nothing is deleted.
-- ============================================================================================

begin;

-- audit_logs is append-only; lift the guard only for this reset, then restore it.
alter table audit_logs disable trigger audit_logs_no_update_delete;
alter table audit_logs disable trigger audit_logs_no_truncate;

truncate table
  audit_logs, notifications, feedback, credential_access_logs, credentials,
  project_file_comments, project_files, project_reports, project_links,
  meeting_note_reads, meeting_notes, meeting_attendees, meetings,
  task_checklist_items, task_dependencies, tasks, project_members, phases,
  payments, invoices, vendor_payments, vendor_bills, vendors, expenses,
  recurring_revenue, recurring_expenses, investment_returns, investments,
  attachments, client_portal_users, projects, clients
restart identity cascade;

alter table audit_logs enable trigger audit_logs_no_update_delete;
alter table audit_logs enable trigger audit_logs_no_truncate;

-- keep only the owner (reyad@gmail.com) and their company
delete from users where lower(email) <> 'reyad@gmail.com';
delete from company where id <> (select company_id from users where lower(email) = 'reyad@gmail.com');

-- first entry of the fresh audit trail
insert into audit_logs (company_id, actor_type, action, entity_type, outcome, summary, metadata)
select company_id, 'system', 'data_reset', 'database', 'success',
  'All data was deleted at the owner''s request; only the owner account (reyad@gmail.com) and its company were kept. A backup was saved locally before the reset.',
  jsonb_build_object('kept_user_id', id)
from users where lower(email) = 'reyad@gmail.com';

commit;

-- Check: expect users = 1, company = 1, everything else 0, audit_logs = 1
select 'users' t, count(*) n from users
union all select 'company', count(*) from company
union all select 'clients', count(*) from clients
union all select 'projects', count(*) from projects
union all select 'payments', count(*) from payments
union all select 'expenses', count(*) from expenses
union all select 'audit_logs', count(*) from audit_logs;
