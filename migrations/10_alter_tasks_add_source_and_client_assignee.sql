-- 10_alter_tasks_add_source_and_client_assignee.sql
-- Client Portal Sprint 2: action items created from meetings + tasks assignable to the client

alter table tasks
  add column source             varchar(10) not null default 'manual' check (source in ('manual','meeting')),
  add column source_id          bigint references meetings(id) on delete set null,
  add column assignee_type      varchar(15) not null default 'team_member' check (assignee_type in ('team_member','client')),
  add column client_assignee_id bigint references client_portal_users(id) on delete set null;

-- exactly one of assignee_id / client_assignee_id may be set, matching assignee_type
alter table tasks add constraint chk_tasks_assignee_matches_type check (
  (assignee_type = 'team_member' and client_assignee_id is null)
  or
  (assignee_type = 'client' and assignee_id is null)
);

create index idx_tasks_source on tasks(source_id) where source = 'meeting';
create index idx_tasks_client_assignee on tasks(client_assignee_id) where client_assignee_id is not null;

-- v_user_workload joined on tasks.assignee_id — restrict to team_member assignments so
-- client-assigned tasks (client_assignee_id) don't get pulled into a team member's workload.
create or replace view v_user_workload as
select
  u.id as user_id,
  u.company_id,
  u.name,
  count(distinct pm.project_id) filter (where p.status = 'active') as active_projects_count,
  coalesce(sum(pm.allocation_percent) filter (where p.status = 'active'), 0) as total_allocation_percent,
  count(t.id) filter (where t.status not in ('done')) as open_tasks_count,
  count(t.id) filter (where t.status not in ('done') and t.due_date < current_date) as overdue_tasks_count
from users u
left join project_members pm on pm.user_id = u.id
left join projects p on p.id = pm.project_id
left join tasks t on t.assignee_id = u.id and t.assignee_type = 'team_member' and t.company_id = u.company_id
group by u.id, u.company_id, u.name;
