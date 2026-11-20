-- 19: Task management module.
--  * a task may now be internal (no project): project_id becomes nullable
--  * two new notification types: task_assigned, task_overdue
--  * indexes for "my tasks" and "due soon" lookups
ALTER TABLE public.tasks ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  (type)::text = ANY ((ARRAY[
    'meeting_reminder', 'meeting_note_added', 'action_item_assigned', 'phase_approved',
    'task_assigned_to_client', 'feedback_requested', 'meeting_cancelled', 'file_uploaded',
    'file_status_changed', 'recurring_payment_due', 'task_assigned', 'task_overdue'
  ])::text[])
);

CREATE INDEX IF NOT EXISTS idx_tasks_company_assignee ON public.tasks (company_id, assignee_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_company_due ON public.tasks (company_id, due_date) WHERE status <> 'done';
CREATE INDEX IF NOT EXISTS idx_tasks_company_created_by ON public.tasks (company_id, created_by);
