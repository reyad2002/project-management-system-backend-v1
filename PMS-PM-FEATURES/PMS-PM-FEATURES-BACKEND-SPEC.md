# ملف تنفيذ الباك إند — ميزات إدارة المشاريع

يغطي الـ endpoints المطلوبة لتنفيذ 4 فجوات: **Task Management**, **Timeline/Gantt**, **Team & Resource Management**, **Client Portal**. مبني على [`PMS-PM-FEATURES-DATABASE-SUPABASE.md`](./PMS-PM-FEATURES-DATABASE-SUPABASE.md) وبنفس أسلوب `PMS-PHASE1-BACKEND-SPEC.md` (شكل الأخطاء، الـ pagination، الـ auth الحالي بالنسبة لمسارات الشركة الداخلية).

**نقطة مهمة**: بوابة العميل (قسم 4) نظام مصادقة **مختلف تمامًا** — مش نفس الـ JWT ولا الـ middleware بتاع مستخدمي الشركة.

---

## 1. فريق المشروع (Team & Resource Management)

**Base:** `/api/projects/:projectId/members`

```
GET    /api/projects/:projectId/members
       → { members: [{ id, user_id, user_name, role_in_project, allocation_percent, added_at }] }

POST   /api/projects/:projectId/members
       body: { user_id, role_in_project?, allocation_percent? }
       201 → المُضاف. 409 لو المستخدم مضاف بالفعل (unique constraint).

PUT    /api/projects/:projectId/members/:memberId
       body: { role_in_project?, allocation_percent? }

DELETE /api/projects/:projectId/members/:memberId
       204. يُرفض بـ 409 لو عنده tasks مفتوحة مُسندة له في هذا المشروع تحديدًا (تحذير، مش منع صارم — الأفضل السماح مع تنبيه فقط في الفرونت إند بدل رفض من الباك إند).
```

### Workload على مستوى الشركة

```
GET /api/team/workload

Response 200:
{
  "members": [
    {
      "user_id": "uuid", "name": "...",
      "active_projects_count": 3,
      "total_allocation_percent": 130,   // فوق 100 = محمّل زيادة (تنبيه بصري في الفرونت)
      "open_tasks_count": 12,
      "overdue_tasks_count": 2
    }
  ]
}
```
مبني مباشرة على `v_user_workload`.

---

## 2. المهام (Tasks)

**Base:** `/api/projects/:projectId/tasks`

### 2.1 قائمة المهام

```http
GET /api/projects/:projectId/tasks?status=&assignee_id=&priority=&parent_task_id=
```
- بدون `parent_task_id` → يرجّع المهام الرئيسية بس (`parent_task_id IS NULL`)؛ مرره فاضي (`parent_task_id=root`) أو استخدم query منفصل `GET /api/tasks/:id/subtasks` للـ subtasks (أوضح للفرونت إند).

```
GET /api/tasks/:id/subtasks   → { tasks: Task[] }
```

**Response shape (Task):**
```json
{
  "id": "uuid", "company_id": "uuid", "project_id": "uuid", "phase_id": "uuid|null",
  "parent_task_id": "uuid|null", "title": "...", "description": "...",
  "status": "in_progress", "priority": "high",
  "assignee_id": "uuid|null", "assignee_name": "...",
  "start_date": "2026-09-01", "due_date": "2026-09-15", "completed_at": null,
  "position": 0, "subtasks_count": 3, "checklist_progress": { "done": 2, "total": 5 },
  "created_at": "..."
}
```
`subtasks_count` و`checklist_progress` محسوبين (aggregate)، مش أعمدة فعلية.

### 2.2 إنشاء / تعديل / حذف

```
POST   /api/projects/:projectId/tasks
       body: { title, description?, phase_id?, parent_task_id?, status?, priority?, assignee_id?, start_date?, due_date? }
       Validation: لو parent_task_id موجود، لازم يكون تابع لنفس project_id — وإلا 400.

PUT    /api/tasks/:id
DELETE /api/tasks/:id     -- بيحذف الـ subtasks تبعها تلقائيًا (cascade) — أظهر تحذير واضح في الفرونت قبل الحذف
```

### 2.3 تحديث الحالة بسرعة (لدعم الـ Kanban / drag-free move)

```
POST /api/tasks/:id/status
body: { status: "in_progress" }
200 → Task محدّثة (completed_at بيتحدث تلقائيًا في الـ DB trigger)
```

### 2.4 إعادة الترتيب (Kanban ordering)

```
POST /api/projects/:projectId/tasks/reorder
body: { taskIds: ["uuid1", "uuid2", "uuid3"] }   // بالترتيب الجديد داخل نفس الـ status column
```
يحدّث عمود `position` لكل task بترتيبها في المصفوفة (transaction واحدة).

### 2.5 Checklist

```
GET    /api/tasks/:taskId/checklist                → { items: ChecklistItem[] }
POST   /api/tasks/:taskId/checklist                body: { title }
PUT    /api/checklist-items/:id                     body: { title?, is_done?, position? }
DELETE /api/checklist-items/:id
```

### 2.6 الاعتماديات (Dependencies)

```
GET    /api/tasks/:taskId/dependencies              → { dependsOn: Task[] }
POST   /api/tasks/:taskId/dependencies              body: { depends_on_task_id, dependency_type? }
       Validation: نفس المشروع + لا يوجد circular dependency (استعلام تحقق: تتبع الاعتماديات من depends_on_task_id ولو رجعت لـ taskId نفسه → 400 "Circular dependency detected").
DELETE /api/tasks/:taskId/dependencies/:dependsOnId
```

---

## 3. الخط الزمني (Timeline / Gantt)

```
GET /api/projects/:projectId/timeline

Response 200:
{
  "items": [
    {
      "id": "uuid", "item_type": "phase", "title": "المرحلة الأولى",
      "start_date": "2026-09-01", "due_date": "2026-09-20",
      "progress_percent": 45, "parent_task_id": null, "assignee_id": null
    },
    {
      "id": "uuid", "item_type": "task", "title": "تصميم الواجهة",
      "start_date": "2026-09-02", "due_date": "2026-09-10",
      "progress_percent": 100, "parent_task_id": null, "assignee_id": "uuid"
    }
  ],
  "dependencies": [
    { "task_id": "uuid", "depends_on_task_id": "uuid" }
  ]
}
```
مبني على `v_project_timeline` + استعلام إضافي بسيط لـ `task_dependencies` الخاصة بمهام المشروع ده.

---

## 4. بوابة العميل (Client Portal) — مصادقة منفصلة بالكامل

### 4.1 دعوة عميل (من جانب الشركة — يحتاج توكن الشركة العادي)

```
POST /api/clients/:clientId/portal-users
body: { name, email }
```
- ينشئ `client_portal_users` بحالة `invited` + `invite_token` عشوائي (UUID) + `invite_expires_at` (+7 أيام).
- يبعت إيميل للعميل فيه لينك: `https://app.../portal/accept-invite?token=...` (تفاصيل إرسال الإيميل خارج نطاق هذا الملف — أي خدمة SMTP/Resend/SendGrid موجودة بالفعل في الباك إند).
- **201** — بيانات الدعوة (بدون الـ token في الـ response لو الإيميل هو قناة التسليم الوحيدة؛ لو محتاجينه للعرض في واجهة الشركة وقت الاختبار، رجّعه بس في بيئة dev).

```
GET    /api/clients/:clientId/portal-users        → { portalUsers: [...] }
DELETE /api/clients/:clientId/portal-users/:id     → 204 (تعطيل/حذف وصول العميل)
```

### 4.2 قبول الدعوة وتفعيل الحساب (عام، بدون توكن)

```
POST /api/portal/auth/accept-invite
body: { token, password }
```
- يتحقق من `invite_token` و`invite_expires_at`، يحدّث `password_hash` (bcrypt) و`status='active'`، يمسح الـ token.
- **400** لو التوكن منتهي أو غير صحيح.

### 4.3 تسجيل دخول العميل

```
POST /api/portal/auth/login
body: { email, password }

Response 200: { portalUser: {...}, token: "<portal-jwt>" }
```
- الـ JWT هنا **مختلف عن توكن الشركة** — الـ payload بيحتوي `{ sub: portal_user_id, client_id, scope: "portal" }`.
- كل الـ middleware بتاع مسارات `/api/portal/*` (ما عدا auth) لازم يتحقق إن `scope === "portal"` ويرفض أي توكن شركة عادي يحاول يدخل عليها، والعكس (توكن بوابة يحاول يدخل `/api/...` الداخلية) — **فصل صارم بين النظامين**.

```
GET  /api/portal/auth/me       → بيانات العميل الحالي (name, email, client info)
POST /api/portal/auth/logout
```

### 4.4 بيانات العميل (Read-only، مفلترة تلقائيًا بـ client_id من التوكن)

```
GET /api/portal/projects                     → { projects: [{ id, title, status, start_date, due_date }] }
GET /api/portal/projects/:id                 → تفاصيل + phases + timeline (نفس شكل قسم 3 لكن read-only)
GET /api/portal/invoices                     → { invoices: [...] }  -- فقط فواتير هذا العميل
GET /api/portal/invoices/:id                 → تفاصيل فاتورة + الدفعات المرتبطة
GET /api/portal/payment-summary              → نفس شكل ClientPaymentSummary الحالي
```

**كل استعلام هنا لازم يضيف `WHERE client_id = <من التوكن>` صراحة — ده أهم سطر أمان في الملف كله.** أي endpoint في `/api/portal/*` بيقبل `client_id` أو `project_id` كـ parameter من العميل نفسه لازم يتحقق إن الـ project/invoice فعلًا تابع للـ client_id بتاعه قبل ما يرجّع أي بيانات، مش يثق في الـ parameter المُرسَل.

### 4.5 موافقة العميل على مرحلة

```
POST /api/portal/phases/:id/approve
```
- يتحقق إن الـ phase تابعة لمشروع تابع لـ client_id بتاع صاحب التوكن.
- يحدّث `client_approved_at = now()`, `client_approved_by = portal_user_id`.
- **409** لو already approved.

---

## 5. تنسيق الأخطاء الخاصة بالميزات دي

| الحالة | كود | الرسالة |
|---|---|---|
| Subtask بمشروع مختلف عن الأب | 400 | `"Subtask must belong to the same project as its parent task"` |
| Circular task dependency | 400 | `"Circular dependency detected"` |
| توكن بوابة يحاول الوصول لمسار داخلي أو العكس | 403 | `"Invalid token scope for this endpoint"` |
| دعوة بوابة منتهية | 400 | `"Invite link has expired"` |
| عميل بوابة يحاول الوصول لمشروع/فاتورة مش بتاعته | 404 | (أرجع 404 مش 403 — عشان متأكدش المستخدم من وجود السجل أصلًا) |

---

## 6. ترتيب تنفيذ الباك إند المقترح

```
[ ] Team: project_members CRUD + /api/team/workload
[ ] Tasks: CRUD أساسي + subtasks + status update + reorder
[ ] Tasks: checklist endpoints
[ ] Tasks: dependencies endpoints + فحص circular dependency
[ ] Timeline: GET /api/projects/:id/timeline
[ ] Client Portal: middleware الـ scope الجديد (أهم خطوة أمنية قبل أي حاجة تانية)
[ ] Client Portal: auth endpoints (invite → accept-invite → login → me)
[ ] Client Portal: read-only data endpoints (projects/invoices/payment-summary)
[ ] Client Portal: phase approval
[ ] اختبار أمني: التأكد إن توكن عميل A مش قادر يشوف بيانات عميل B (أهم اختبار في الملف ده)
```
