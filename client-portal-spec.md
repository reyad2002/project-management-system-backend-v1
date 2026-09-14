# Client Portal — Feature Spec (Sprint 1-3)
## Integration on existing PMS (CodeWars)

---

## Sprint 1: Notifications Foundation + Meetings + Project Links

### 1.1 Notifications (Foundation)

**Data Model:**
```
Notification
- id
- company_id
- recipient_type: 'team_member' | 'client_portal_user'
- recipient_id
- type: 'meeting_reminder' | 'meeting_note_added' | 'action_item_assigned' | 'phase_approved' | ...
- title
- body
- related_type: 'meeting' | 'task' | 'phase' | 'invoice' | null
- related_id
- is_read: boolean
- read_at: timestamp | null
- created_at
```

**Endpoints:**
- `GET /notifications` — قائمة إشعارات المستخدم الحالي (فلترة تلقائية حسب recipient)
- `PATCH /notifications/:id/read` — تعليم كمقروء
- `PATCH /notifications/read-all`

**Delivery:**
- Email على الأقل في المرحلة دي (عبر خدمة زي SendGrid/Resend)
- Cron Job (كل ساعة) على الباك إند يفحص المواعيد القريبة ويولّد إشعارات `meeting_reminder`

**Frontend:**
- أيقونة جرس في الـ Header (dashboard + portal) مع badge عدد غير المقروء
- Dropdown بسيط يعرض آخر 10 إشعارات

---

### 1.2 Meetings

**Data Model:**
```
Meeting
- id
- company_id
- project_id (FK → Project)
- title
- agenda: text
- scheduled_at: timestamp
- meeting_link: string | null
- status: 'scheduled' | 'completed' | 'cancelled'
- created_by (team member)
- created_at

MeetingAttendee
- id
- meeting_id
- attendee_type: 'team_member' | 'client_portal_user'
- attendee_id

MeetingNote
- id
- meeting_id
- content: text (rich text / markdown)
- created_by
- created_at
- word_file_url: string | null   // بعد الـ export

MeetingNoteRead
- id
- meeting_note_id
- portal_user_id
- read_at: timestamp
```

**Endpoints (Dashboard):**
- `POST /projects/:id/meetings` — إنشاء ميتنج (title, agenda, scheduled_at, meeting_link, attendee_ids)
- `GET /projects/:id/meetings`
- `PATCH /meetings/:id` — تعديل/إلغاء
- `POST /meetings/:id/notes` — إضافة محضر
- `GET /meetings/:id/notes/export` — توليد وتنزيل Word (docx)

**Endpoints (Portal):**
- `GET /portal/projects/:id/meetings` — قراءة فقط، مفلترة تلقائيًا
- `GET /portal/meetings/:id/notes`
- `POST /portal/meeting-notes/:id/mark-read` — يسجل `read_at`
- `GET /portal/meeting-notes/:id/export` — تنزيل Word

**Word Export:**
- سيرفر-سايد، مكتبة زي `docx` (Node) أو `python-docx` لو فيه سيرفس منفصل
- الملف يتضمن: اسم المشروع، تاريخ الميتنج، الحضور، الأجندة، المحضر، Footer فيه "تم التصدير بتاريخ [X] لصالح [اسم العميل]"

**Frontend:**
- Dashboard: تبويب "Meetings" جديد في `/dashboard/projects/[id]` — جدول بالمواعيد + زرار "Add Note" لكل ميتنج completed
- Portal: تبويب "Meetings" في `/portal/projects/[id]` — لما العميل يفتح المحضر، يتسجل `read_at` تلقائيًا (call `mark-read` عند فتح الصفحة)، وفي المكان ده تظهر أيقونة "Seen at [تاريخ ووقت]" في صفحة الداشبورد للموظف

---

### 1.3 Project Links

**Data Model:**
```
ProjectLink
- id
- project_id (FK)
- label: string        // "Staging", "Live", "Admin Dashboard"...
- url: string
- type: 'staging' | 'live' | 'dashboard' | 'other'
- created_at
```

**Endpoints:**
- `POST /projects/:id/links`
- `GET /projects/:id/links`
- `DELETE /project-links/:id`
- Portal: `GET /portal/projects/:id/links` (قراءة فقط)

**Frontend:**
- تبويب/قسم صغير "Links" في تفاصيل المشروع (داشبورد + بورتال)، كل لينك بيتفتح في تاب جديد، مع أيقونة تناسب الـ type

---

## Sprint 2: Action Items + Pending on Client

### 2.1 توسعة نظام Tasks

**تعديلات على `Task` الموجود:**
```
Task (إضافات)
- source: 'manual' | 'meeting'          (default: 'manual')
- source_id: meeting_id | null
- assignee_type: 'team_member' | 'client'    (جديد)
- client_assignee_id: portal_user_id | null  (جديد، nullable)
```
> ملاحظة: `assignee_id` الحالي (لو موجود) يفضل للـ team members بس؛ بيتحدد المستخدَم إما `assignee_id` أو `client_assignee_id` حسب `assignee_type`، مش الاتنين مع بعض.

**Endpoints (تعديل الموجود):**
- `POST /meetings/:id/notes` — يقبل إضافة `action_items[]` اختياري في نفس الـ request: `{ title, assignee_type, assignee_id, due_date }` → كل عنصر بيتحول لـ Task تلقائيًا بـ `source: 'meeting'`
- باقي الـ Task endpoints الموجودة (`update status`, إلخ) تشتغل زي ما هي، مفيش تغيير على المنطق الأساسي

**Frontend:**
- Dashboard: لما تفتح محضر ميتنج، فيه قسم "Action Items" تقدر تضيف منه Tasks مباشرة (بيتفتح نفس الـ Task creation form بس مع `source_id` متعبي مسبقًا)
- الـ Kanban Board الموجود: إضافة فلتر/badge بسيط "From Meeting" على الكروت اللي `source = 'meeting'`

---

### 2.2 Pending on Client

مفيش Entity جديد — ده View مبني على نفس جدول Task بفلتر.

**Endpoint:**
- `GET /portal/projects/:id/tasks?assignee_type=client&status=ne:done`

**Frontend:**
- تبويب جديد "مطلوب منك" في `/portal/projects/[id]` — بيسحب نفس الـ endpoint، عرض بسيط (اسم المهمة، تاريخ الاستحقاق، زرار "Mark as done" لو حابب تدي العميل صلاحية يقفلها بنفسه، أو يفضل read-only ويقفلها موظفك بعد ما يتأكد)

---

## Sprint 3: Credentials + Micro-feedback

### 3.1 Credentials

**Data Model:**
```
Credential
- id
- project_id (FK)
- label: string              // "cPanel", "Domain Registrar", "Server SSH"...
- username: string
- password_encrypted: text   // AES-256 encryption, مفتاح التشفير في env variable على الباك إند
- panel_url: string | null
- notes: text | null
- created_by
- created_at

CredentialAccessLog
- id
- credential_id
- accessed_by_type: 'team_member' | 'client_portal_user'
- accessed_by_id
- accessed_at: timestamp
```

**Endpoints:**
- `POST /projects/:id/credentials` — إنشاء (الباك إند بيشفر الباسورد قبل التخزين)
- `GET /projects/:id/credentials` — بيرجع username + label + panel_url بس، **من غير** الباسورد
- `POST /credentials/:id/reveal` — بيرجع الباسورد مفكوك التشفير + يسجل سطر في `CredentialAccessLog`
- `GET /credentials/:id/access-log` — (داشبورد بس) يعرض مين شاف الباسورد وإمتى
- Portal: نفس منطق `GET` و`reveal` بس مفلترة على مشاريع العميل

**أمان — نقاط لازم تتاخد بجدية:**
- التشفير AES-256 مش base64 (base64 مش تشفير، ده ترميز بس)
- مفتاح التشفير (`ENCRYPTION_KEY`) في environment variable على السيرفر، مش في الكود ولا في الداتابيز
- الـ `reveal` endpoint لازم يكون محمي بنفس الـ Auth العادي + يفضل تضيف rate limiting عليه (يمنع محاولات استخراج جماعية)
- فكّر في صلاحية زمنية: لو عايز الباسورد يتخفي تلقائي بعد X ثانية في الـ Frontend حتى لو الـ tab فاضل مفتوح

**Frontend:**
- تبويب "Credentials" في تفاصيل المشروع (داشبورد + بورتال)
- كل صف: Label + Username + Password مخفي (••••••) + زرار "Show" (بيعمل call لـ `/reveal`) + زرار "Copy"
- في الداشبورد بس: زرار/لينك "View Access Log" يعرض جدول بسيط (مين/إمتى)

---

### 3.2 Micro-feedback

**Data Model:**
```
Feedback
- id
- project_id (FK)
- related_type: 'meeting' | 'phase'
- related_id
- rating: integer (1-5)
- submitted_by: portal_user_id
- created_at
```

**Endpoints:**
- `POST /portal/feedback` — `{ project_id, related_type, related_id, rating }`
- `GET /projects/:id/feedback` — (داشبورد) عرض كل التقييمات، ومتوسط عام للمشروع

**Frontend:**
- Portal: Modal بسيط (5 نجوم أو 1-5) يظهر تلقائيًا:
  - بعد `approvePhase` مباشرة
  - بعد أول مرة يفتح فيها `MeetingNote` (مرتبط بنفس فعل الـ mark-read)
- Dashboard: مؤشر صغير في تفاصيل المشروع أو حتى في الـ Dashboard الرئيسي (متوسط تقييم آخر 5 تفاعلات) — ده ممكن يتضاف كـ widget بسيط في `statisticsApi.dashboard`
