-- 13_extend_notifications_for_files_and_recurring.sql
--
-- project_files, project_file_comments, recurring_revenue, recurring_expenses, investments and
-- investment_returns were already created directly against Supabase by whoever owns the DB side
-- of this feature (confirmed live on 2026-09-14, schema pulled via PostgREST introspection) —
-- their actual columns/enums differ from a first draft of this migration, which has been
-- removed. This file only extends `notifications`, which this repo owns, to support the two new
-- event sources (project files, recurring billing reminders).
--
-- Verified live before this migration:
--   notifications_type_check         allows: meeting_reminder, meeting_note_added,
--                                     action_item_assigned, phase_approved,
--                                     task_assigned_to_client, feedback_requested,
--                                     meeting_cancelled
--   notifications_related_type_check allows: meeting, task, phase, invoice,
--                                     recurring_revenue, recurring_expense  (already added by
--                                     the DB side — only 'file' is missing here)

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'meeting_reminder','meeting_note_added','action_item_assigned',
  'phase_approved','task_assigned_to_client','feedback_requested','meeting_cancelled',
  'file_uploaded','file_status_changed','recurring_payment_due'
));

alter table notifications drop constraint if exists notifications_related_type_check;
alter table notifications add constraint notifications_related_type_check check (related_type in (
  'meeting','task','phase','invoice','recurring_revenue','recurring_expense','file'
));
