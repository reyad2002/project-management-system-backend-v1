-- 18: indexes for foreign keys and the filters the app actually uses (company + date lists, joins by project/client).
-- Additive only and idempotent. Audit/"created_by" foreign keys are left unindexed on purpose (never filtered on).
CREATE INDEX IF NOT EXISTS idx_payments_project ON public.payments (project_id);
CREATE INDEX IF NOT EXISTS idx_payments_company_date ON public.payments (company_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_company_date ON public.expenses (company_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON public.expenses (vendor_id);
CREATE INDEX IF NOT EXISTS idx_phases_project ON public.phases (project_id);
CREATE INDEX IF NOT EXISTS idx_phases_company ON public.phases (company_id);
CREATE INDEX IF NOT EXISTS idx_projects_client ON public.projects (client_id);
CREATE INDEX IF NOT EXISTS idx_clients_company ON public.clients (company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_company ON public.tasks (company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON public.tasks (phase_id);
CREATE INDEX IF NOT EXISTS idx_invoices_phase ON public.invoices (phase_id);
CREATE INDEX IF NOT EXISTS idx_meetings_company ON public.meetings (company_id);
CREATE INDEX IF NOT EXISTS idx_users_company ON public.users (company_id);
CREATE INDEX IF NOT EXISTS idx_vendor_payments_company ON public.vendor_payments (company_id);
CREATE INDEX IF NOT EXISTS idx_project_members_company ON public.project_members (company_id);
CREATE INDEX IF NOT EXISTS idx_project_reports_company ON public.project_reports (company_id);
CREATE INDEX IF NOT EXISTS idx_attachments_company ON public.attachments (company_id);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_project ON public.recurring_expenses (linked_project_id);
CREATE INDEX IF NOT EXISTS idx_recurring_revenue_project ON public.recurring_revenue (project_id);
