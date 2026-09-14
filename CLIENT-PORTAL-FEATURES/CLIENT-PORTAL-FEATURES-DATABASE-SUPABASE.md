# ملف تنفيذ قاعدة البيانات (Supabase/Postgres) — ميزات بوابة العميل الجديدة

هذا الملف بيغطي تنفيذ قاعدة البيانات للفيتشرز المطلوبة في [`../client-portal-spec.md`](../client-portal-spec.md)، مقسّمة على نفس الـ 3 Sprints الموجودة هناك:

| Sprint | الميزة |
|---|---|
| 1 | Notifications (أساس) + Meetings + Project Links |
| 2 | توسعة Tasks لدعم Action Items من الميتنجز + Pending on Client |
| 3 | Credentials + Micro-feedback |

نفس كونفنشنز الباك إند الحالي المستخدمة في `PMS-PM-FEATURES/PMS-PM-FEATURES-DATABASE-SUPABASE.md`: uuid PKs، snake_case، `company_id` على كل جدول شركة، الباك إند بيتصل بالـ DB عبر service role/direct connection (مش Supabase client من الفرونت مباشرة) — يعني **لا داعي لـ Row Level Security policies** طالما الفلترة بتتم في الباك إند، لكن لو الفريق قرر تفعيل RLS مستقبلًا لازم يتغطى بجدول ملاحظات منفصل.

---

## 0. افتراضات

1. الجداول التالية موجودة بالفعل من مراحل سابقة: `companies`, `users`, `clients`, `projects`, `phases`, `tasks`, `client_portal_users` (بوابة العميل نظام مصادقة منفصل تمامًا عن `users`).
2. `tasks` الحالي فيه: `id, company_id, project_id, phase_id, parent_task_id, title, description, status, priority, assignee_id, start_date, due_date, completed_at, position, created_at` (راجع `PMS-PM-FEATURES-DATABASE-SUPABASE.md` Migration 08).
3. خد Backup قبل تنفيذ أي migration.
4. رقم الـ migrations هنا يبدأ من `09` على افتراض إن `07` و`08` (Team + Tasks) اتنفذوا بالفعل — عدّل الترقيم حسب آخر migration فعلي عندك في الباك إند.

---

## 1. Migration 09 — Notifications

```sql
-- 09_create_notifications.sql

create table notifications (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  recipient_type  varchar(20) not null check (recipient_type in ('team_member','client_portal_user')),
  recipient_id    uuid not null,          -- يشير لـ users.id أو client_portal_users.id حسب recipient_type (بدون FK عشان الجدولين مختلفين)
  type            varchar(40) not null
    check (type in (
      'meeting_reminder','meeting_note_added','action_item_assigned',
      'phase_approved','task_assigned_to_client','feedback_requested'
    )),
  title           varchar(200) not null,
  body            text,
  related_type    varchar(20) check (related_type in ('meeting','task','phase','invoice')),
  related_id      uuid,
  is_read         boolean not null default false,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index idx_notifications_recipient on notifications(recipient_type, recipient_id, is_read);
create index idx_notifications_company on notifications(company_id);
```

**ملاحظات:**
- `recipient_id` بدون foreign key لأنه بيشاور لجدولين مختلفين حسب `recipient_type` — التكامل (integrity) بيتضمن على مستوى الباك إند بس، مش الـ DB.
- فهرس `(recipient_type, recipient_id, is_read)` عشان أكتر استعلام هيتنفذ هو "جيب غير المقروء لمستخدم معين".

---

## 2. Migration 10 — Meetings

```sql
-- 10_create_meetings.sql

create table meetings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  project_id      uuid not null references projects(id) on delete cascade,
  title           varchar(200) not null,
  agenda          text,
  scheduled_at    timestamptz not null,
  meeting_link    text,
  status          varchar(20) not null default 'scheduled'
    check (status in ('scheduled','completed','cancelled')),
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);

create index idx_meetings_project on meetings(project_id);
create index idx_meetings_scheduled_at on meetings(scheduled_at) where status = 'scheduled';

create table meeting_attendees (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references meetings(id) on delete cascade,
  attendee_type   varchar(20) not null check (attendee_type in ('team_member','client_portal_user')),
  attendee_id     uuid not null,

  unique (meeting_id, attendee_type, attendee_id)
);

create index idx_meeting_attendees_meeting on meeting_attendees(meeting_id);

create table meeting_notes (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references meetings(id) on delete cascade,
  content         text not null,          -- markdown
  word_file_url   text,                    -- بيتحدث بعد أول export
  created_by      uuid not null references users(id),
  created_at      timestamptz not null default now()
);

create index idx_meeting_notes_meeting on meeting_notes(meeting_id);

create table meeting_note_reads (
  id                uuid primary key default gen_random_uuid(),
  meeting_note_id   uuid not null references meeting_notes(id) on delete cascade,
  portal_user_id    uuid not null references client_portal_users(id) on delete cascade,
  read_at           timestamptz not null default now(),

  unique (meeting_note_id, portal_user_id)
);
```

**ملاحظات:**
- الفهرس الجزئي (`partial index`) على `scheduled_at where status = 'scheduled'` بيسرّع الـ Cron Job اللي بيدوّر على ميتنجز قريبة بدون ما يفحص القديمة/الملغية.
- `meeting_attendees.attendee_id` نفس منطق `notifications.recipient_id` — بدون FK لأنه polymorphic.
- `meeting_note_reads` هي أساس فيتشر "Seen at [تاريخ]" — صف واحد لكل (محضر × مستخدم بوابة)، أول مرة بس (بسبب الـ `unique`)، أي محاولة تسجيل تانية تتجاهل (`ON CONFLICT DO NOTHING`) عشان `read_at` يفضل أول وقت فتح فعلي.

---

## 3. Migration 11 — Project Links

```sql
-- 11_create_project_links.sql

create table project_links (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  label       varchar(100) not null,
  url         text not null,
  type        varchar(20) not null default 'other'
    check (type in ('staging','live','dashboard','other')),
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now()
);

create index idx_project_links_project on project_links(project_id);
```

---

## 4. Migration 12 — توسعة Tasks (Action Items من الميتنجز + Client Assignee)

```sql
-- 12_alter_tasks_add_source_and_client_assignee.sql

alter table tasks
  add column source            varchar(10) not null default 'manual' check (source in ('manual','meeting')),
  add column source_id         uuid references meetings(id) on delete set null,
  add column assignee_type     varchar(15) not null default 'team_member' check (assignee_type in ('team_member','client')),
  add column client_assignee_id uuid references client_portal_users(id) on delete set null;

-- lازم يتحدد إما assignee_id أو client_assignee_id حسب assignee_type، مش الاتنين مع بعض
alter table tasks add constraint chk_tasks_assignee_matches_type check (
  (assignee_type = 'team_member' and client_assignee_id is null)
  or
  (assignee_type = 'client' and assignee_id is null)
);

create index idx_tasks_source on tasks(source_id) where source = 'meeting';
create index idx_tasks_client_assignee on tasks(client_assignee_id) where client_assignee_id is not null;
```

**ملاحظة مهمة:** الـ `v_user_workload` view (Migration 07) بتعتمد على `t.assignee_id` — لازم تتعدّل لتضيف `and t.assignee_type = 'team_member'` في شرط الـ join حتى ما تتأثرش بالمهام المُسندة للعميل:

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
left join tasks t on t.assignee_id = u.id and t.assignee_type = 'team_member' and t.company_id = u.company_id
group by u.id, u.company_id, u.name;
```

---

## 5. Migration 13 — Credentials

```sql
-- 13_create_credentials.sql

create table credentials (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  label               varchar(100) not null,
  username            varchar(200) not null,
  password_encrypted  text not null,      -- AES-256-GCM ciphertext (base64) — التشفير/فك التشفير على الباك إند فقط
  panel_url           text,
  notes               text,
  created_by          uuid not null references users(id),
  created_at          timestamptz not null default now()
);

create index idx_credentials_project on credentials(project_id);

create table credential_access_logs (
  id                uuid primary key default gen_random_uuid(),
  credential_id     uuid not null references credentials(id) on delete cascade,
  accessed_by_type  varchar(20) not null check (accessed_by_type in ('team_member','client_portal_user')),
  accessed_by_id    uuid not null,
  accessed_at       timestamptz not null default now()
);

create index idx_credential_access_logs_credential on credential_access_logs(credential_id);
```

**تنبيه أمني (على مستوى DB):**
- عمود `password_encrypted` **لا يُخزَّن مطلقًا كنص صريح** — التشفير مسؤولية الباك إند (AES-256، مفتاح في env variable — تفاصيل كاملة في `CLIENT-PORTAL-FEATURES-BACKEND-SPEC.md` قسم Credentials).
- `credential_access_logs` جدول append-only فقط — لا `UPDATE` ولا `DELETE` من الباك إند، عشان يفضل سجل تدقيق (audit trail) موثوق.

---

## 6. Migration 14 — Micro-feedback

```sql
-- 14_create_feedback.sql

create table feedback (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  related_type  varchar(10) not null check (related_type in ('meeting','phase')),
  related_id    uuid not null,
  rating        smallint not null check (rating between 1 and 5),
  submitted_by  uuid not null references client_portal_users(id) on delete cascade,
  created_at    timestamptz not null default now(),

  unique (related_type, related_id, submitted_by)
);

create index idx_feedback_project on feedback(project_id);
```

**ملاحظة:** `unique (related_type, related_id, submitted_by)` بيمنع نفس العميل يبعت تقييم مكرر لنفس الميتنج/المرحلة — لو حابب تسمح بالتحديث بدل المنع، استخدم `ON CONFLICT ... DO UPDATE` في الباك إند بدل `INSERT` بسيط.

---

## 7. ترتيب التنفيذ الموصى به

1. `09_create_notifications.sql`
2. `10_create_meetings.sql`
3. `11_create_project_links.sql`
4. `12_alter_tasks_add_source_and_client_assignee.sql` (يشمل تحديث `v_user_workload`)
5. `13_create_credentials.sql`
6. `14_create_feedback.sql`

كل migration مستقل عن التاني ماعدا (4) اللي محتاج جدول `meetings` (رقم 2) يكون موجود قبله بسبب FK على `source_id`.
