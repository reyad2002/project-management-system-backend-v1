# ملف تنفيذ قاعدة البيانات (Supabase/Postgres) — ميزات إدارة المشاريع

هذا الملف بيغطي تنفيذ قاعدة البيانات لـ 4 فجوات من قسم "Project Management Gaps" في [`PMS-DEVELOPMENT-ROADMAP.md`](../PMS-DEVELOPMENT-ROADMAP.md):

| # | الميزة |
|---|---|
| 1 | Task Management حقيقي (Tasks/Subtasks/Checklist/Priority/Assignee) |
| 2 | Timeline / Gantt View |
| 3 | Team & Resource Management (فريق المشروع + Workload) |
| 6 | Client Portal (بوابة العميل) |

نفس كونفنشنز الباك إند الحالي المستخدمة في ملفات المرحلة المحاسبية (`PMS-PHASE1-DATABASE-SUPABASE.md`): uuid PKs، snake_case، `company_id` على كل جدول، اتصال الباك إند بالـ DB عبر service role/direct connection (مش Supabase client من الفرونت مباشرة).

---

## 0. افتراضات

1. جدول `users` الحالي (مستخدمي الشركة الداخليين) موجود بالفعل وهيتم إعادة استخدامه كـ "أعضاء الفريق" — مفيش داعي لجدول "Employee" منفصل.
2. جداول `projects`, `phases`, `clients` موجودة بالفعل (من النظام الأساسي + مرحلة المحاسبة).
3. **بوابة العميل نظام مصادقة منفصل تمامًا** عن مستخدمي الشركة — جدول مستخدمين جديد بالكامل (`client_portal_users`)، مش امتداد لجدول `users`.
4. خد Backup قبل التنفيذ زي أي migration سابقة.

---

## 1. Migration 07 — فريق المشروع (Team & Resource Management)

```sql
-- 07_create_project_members.sql

create table project_members (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  user_id           uuid not null references users(id) on delete cascade,
  role_in_project   varchar(20) not null default 'contributor'
    check (role_in_project in ('owner','manager','contributor','viewer')),
  allocation_percent numeric(5,2) check (allocation_percent between 0 and 100),
  added_by          uuid not null references users(id),
  created_at        timestamptz not null default now(),

  unique (project_id, user_id)
);

create index idx_project_members_project on project_members(project_id);
create index idx_project_members_user on project_members(user_id);
```

**ملاحظات:**
- `allocation_percent` اختياري — نسبة وقت الموظف المخصصة لهذا المشروع (مفيدة لحساب الـ Workload لو الموظف موزّع على أكتر من مشروع في نفس الوقت).
- `role_in_project` منفصل تمامًا عن أي نظام صلاحيات عام على مستوى الشركة (RBAC — بند 4 في الـ roadmap، خارج نطاق هذا الملف) — هو بس بيوضح دور الشخص جوه المشروع ده تحديدًا (مثلاً محاسب ممكن يبقى `owner` على مستوى الشركة لكن `viewer` على مشروع معين).

### View: أعباء العمل (Workload)

```sql
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
left join tasks t on t.assignee_id = u.id and t.company_id = u.company_id
group by u.id, u.company_id, u.name;
```

> View دي بتتعرف بعد إنشاء جدول `tasks` في Migration 08 — نفّذها بعده.

---

## 2. Migration 08 — المهام (Tasks / Subtasks / Checklist / Dependencies)

```sql
-- 08_create_tasks.sql

create table tasks (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  phase_id          uuid references phases(id) on delete set null,
  parent_task_id    uuid references tasks(id) on delete cascade,

  title             varchar(200) not null,
  description       text,

  status            varchar(20) not null default 'todo'
    check (status in ('todo','in_progress','in_review','done','blocked')),
  priority          varchar(10) not null default 'medium'
    check (priority in ('low','medium','high','urgent')),

  assignee_id       uuid references users(id) on delete set null,
  start_date        date,
  due_date          date,
  completed_at      timestamptz,

  position          integer not null default 0,
  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint chk_task_dates check (start_date is null or due_date is null or due_date >= start_date)
);

create index idx_tasks_project on tasks(project_id, status);
create index idx_tasks_assignee on tasks(assignee_id) where status <> 'done';
create index idx_tasks_parent on tasks(parent_task_id);
create index idx_tasks_due_date on tasks(due_date) where status not in ('done');

-- Subtask لازم يبقى تابع لنفس المشروع بتاع الأب (اتصالها بمنطق تطبيقي في الباك إند + قيد اختياري هنا)
-- (Postgres مش بيسمح بـ self-referencing FK check مباشر بسهولة، فالتحقق ده هيتعمل application-level)

create or replace function trg_tasks_before_write()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'done' and (old is null or old.status is distinct from 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_before_write on tasks;
create trigger tasks_before_write
before insert or update on tasks
for each row execute function trg_tasks_before_write();
```

### Checklist بنود فرعية داخل كل Task

```sql
create table task_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references tasks(id) on delete cascade,
  title         varchar(200) not null,
  is_done       boolean not null default false,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_checklist_task on task_checklist_items(task_id);
```

### اعتماديات المهام (Dependencies) — لازمة لخطوط الربط في الـ Gantt

```sql
create table task_dependencies (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references tasks(id) on delete cascade,
  depends_on_task_id  uuid not null references tasks(id) on delete cascade,
  dependency_type     varchar(20) not null default 'finish_to_start'
    check (dependency_type in ('finish_to_start','start_to_start')),
  created_at          timestamptz not null default now(),

  check (task_id <> depends_on_task_id),
  unique (task_id, depends_on_task_id)
);

create index idx_task_deps_task on task_dependencies(task_id);
create index idx_task_deps_depends_on on task_dependencies(depends_on_task_id);
```

> **ملاحظة**: منع الـ circular dependencies (A يعتمد على B وB يعتمد على A) بيتحقق منه في الباك إند وقت الإنشاء (استعلام تحقق بسيط)، مش constraint على مستوى الـ DB (يحتاج recursive query أعقد من قيمته هنا).

---

## 3. Migration 09 — Timeline موحّد (Phases + Tasks)

الـ Gantt محتاج يعرض المراحل المالية (Phases) والمهام التنفيذية (Tasks) على نفس الخط الزمني. بدل ما الفرونت إند يعمل استعلامين ويدمجهم يدويًا، الأنسب view واحدة موحّدة:

```sql
create or replace view v_project_timeline as
select
  p.id, p.company_id, p.project_id,
  'phase'::text as item_type,
  p.title, p.start_date, p.end_date as due_date,
  null::uuid as parent_task_id,
  null::varchar as assignee_id,
  case when p.start_date is null then 0
       when current_date < p.start_date then 0
       when current_date > p.end_date then 100
       else round(100.0 * (current_date - p.start_date) / nullif(p.end_date - p.start_date, 0))
  end as progress_percent
from phases p

union all

select
  t.id, t.company_id, t.project_id,
  'task'::text as item_type,
  t.title, t.start_date, t.due_date,
  t.parent_task_id,
  t.assignee_id::varchar,
  case t.status
    when 'todo' then 0
    when 'in_progress' then 50
    when 'in_review' then 75
    when 'done' then 100
    when 'blocked' then 25
  end as progress_percent
from tasks t;
```

> `progress_percent` للمهام مُشتق من الـ `status` مباشرة (v1 بسيطة) — مفيش حقل تقدّم يدوي منفصل دلوقتي؛ ممكن يتضاف لاحقًا لو احتجنا دقة أكتر.

---

## 4. Migration 10 — بوابة العميل (Client Portal)

نظام مصادقة **منفصل بالكامل** عن `users` (مستخدمي الشركة) — عميل خارجي، صلاحياته محدودة جدًا وread-only في الأساس.

```sql
-- 10_create_client_portal.sql

create table client_portal_users (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,

  name              varchar(150) not null,
  email             varchar(150) not null,
  password_hash     text,                     -- null لحد ما يقبل الدعوة ويحدد كلمة سر

  status            varchar(20) not null default 'invited'
    check (status in ('invited','active','disabled')),
  invite_token      varchar(100),
  invite_expires_at timestamptz,

  last_login_at     timestamptz,
  invited_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),

  unique (client_id, email)
);

create index idx_portal_users_client on client_portal_users(client_id);
create unique index idx_portal_users_email on client_portal_users(company_id, email);
```

### موافقة العميل على مرحلة (اختياري لكن قيمته عملية عالية)

عمود إضافي على `phases` (موجودة من النظام الأساسي) يسمح للعميل يوافق على مرحلة من داخل البوابة قبل ما تتقفل/تتفوتر:

```sql
alter table phases
  add column if not exists client_approved_at timestamptz,
  add column if not exists client_approved_by uuid references client_portal_users(id);
```

---

## 5. مخطط العلاقات المضاف (ERD مبسّط)

```
projects ──1:N── project_members ──N:1── users
                                              │
projects ──1:N── tasks ──1:N── task_checklist_items
             │        │
             │        └──N:N── tasks (via task_dependencies)
             │
             └──1:N── phases ──── client_approved_by ──N:1── client_portal_users

clients ──1:N── client_portal_users
```

---

## 6. RLS (ملاحظة احتياطية — نفس مبدأ Phase 1)

لو فيه أي استدعاء مباشر لـ Supabase client (مش الباك إند بس)، فعّل RLS خصوصًا على `client_portal_users` والجداول اللي بيشوفها العميل — العزل هنا **حساس جدًا** لأنه بيمنع عميل يشوف بيانات عميل تاني. لو الباك إند هو الوسيط الوحيد (زي المفترض حاليًا)، العزل بيتم بالكامل في الـ middleware بتاع الـ portal auth (تفاصيله في ملف الباك إند، قسم 4).

```sql
alter table client_portal_users enable row level security;
-- مثال: لو استخدمتوا Supabase Auth فعليًا للبوابة بدل الـ JWT المخصص
-- create policy portal_isolation on client_portal_users
--   for all using (id = auth.uid());
```

---

## 7. ترتيب التنفيذ (Checklist)

```
[ ] Backup / Snapshot
[ ] 07_create_project_members.sql
[ ] 08_create_tasks.sql            (يشمل tasks + task_checklist_items + task_dependencies + trigger)
[ ] v_user_workload                (بعد إنشاء tasks، لأنها بتعتمد عليها)
[ ] 09_view_project_timeline.sql
[ ] 10_create_client_portal.sql    (يشمل client_portal_users + أعمدة الموافقة على phases)
[ ] استعلام تحقق: إنشاء task تجريبية + subtask ليها + checklist item + التأكد من trigger الـ completed_at
[ ] استعلام تحقق: إنشاء client_portal_user تجريبي والتأكد من الـ unique constraint على الإيميل
```

### استعلام تحقق سريع

```sql
insert into tasks (company_id, project_id, title, status, created_by)
values ('<company_id>', '<project_id>', 'تصميم الشاشة الرئيسية', 'in_progress', '<user_id>')
returning id;

update tasks set status = 'done' where id = '<task_id>';
select status, completed_at from tasks where id = '<task_id>';
-- المتوقع: completed_at اتحطت تلقائيًا
```
