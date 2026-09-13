# ملف تنفيذ الفرونت إند — ميزات إدارة المشاريع

تنفيذ فعلي على **هذا الريبو** لـ 4 فجوات: **Task Management**, **Timeline/Gantt**, **Team & Resource Management**, **Client Portal** — بنفس الكونفنشنز المستخدمة فعليًا في الكود الحالي (React Query hooks، `Modal`+`formId`+footer، `Table`، `Badge`، `CustomSelect` القابل للبحث، توكينز `--primary`/`--accent`/إلخ، من غير أي مكتبة خارجية جديدة).

---

## 1. `lib/api.ts` — إضافات

```ts
// ---- Team & Resource Management ----
export type ProjectMemberRole = "owner" | "manager" | "contributor" | "viewer";

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  user_name: string;
  role_in_project: ProjectMemberRole;
  allocation_percent: number | null;
  created_at: string;
}

export interface AddProjectMemberInput {
  user_id: string;
  role_in_project?: ProjectMemberRole;
  allocation_percent?: number;
}

export interface WorkloadMember {
  user_id: string;
  name: string;
  active_projects_count: number;
  total_allocation_percent: number;
  open_tasks_count: number;
  overdue_tasks_count: number;
}

export const projectMembersApi = {
  list: (projectId: string) =>
    api.get<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`),
  add: (projectId: string, data: AddProjectMemberInput) =>
    api.post<ProjectMember>(`/api/projects/${projectId}/members`, data),
  update: (projectId: string, memberId: string, data: Partial<AddProjectMemberInput>) =>
    api.put<ProjectMember>(`/api/projects/${projectId}/members/${memberId}`, data),
  remove: (projectId: string, memberId: string) =>
    api.delete(`/api/projects/${projectId}/members/${memberId}`),
};

export const teamApi = {
  workload: () => api.get<{ members: WorkloadMember[] }>("/api/team/workload"),
};

// ---- Tasks ----
export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "blocked";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface ChecklistItem {
  id: string;
  task_id: string;
  title: string;
  is_done: boolean;
  position: number;
}

export interface Task {
  id: string;
  company_id: string;
  project_id: string;
  phase_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  assignee_name: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  position: number;
  subtasks_count: number;
  checklist_progress: { done: number; total: number };
  created_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  phase_id?: string | null;
  parent_task_id?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
}

export const tasksApi = {
  list: (projectId: string, params?: { status?: TaskStatus; assignee_id?: string; priority?: TaskPriority }) =>
    api.get<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks`, { params }),
  subtasks: (taskId: string) => api.get<{ tasks: Task[] }>(`/api/tasks/${taskId}/subtasks`),
  get: (id: string) => api.get<Task>(`/api/tasks/${id}`),
  create: (projectId: string, data: CreateTaskInput) =>
    api.post<Task>(`/api/projects/${projectId}/tasks`, data),
  update: (id: string, data: Partial<CreateTaskInput>) => api.put<Task>(`/api/tasks/${id}`, data),
  delete: (id: string) => api.delete(`/api/tasks/${id}`),
  setStatus: (id: string, status: TaskStatus) => api.post<Task>(`/api/tasks/${id}/status`, { status }),
  reorder: (projectId: string, taskIds: string[]) =>
    api.post(`/api/projects/${projectId}/tasks/reorder`, { taskIds }),
  checklist: {
    list: (taskId: string) => api.get<{ items: ChecklistItem[] }>(`/api/tasks/${taskId}/checklist`),
    add: (taskId: string, title: string) =>
      api.post<ChecklistItem>(`/api/tasks/${taskId}/checklist`, { title }),
    update: (id: string, data: Partial<Pick<ChecklistItem, "title" | "is_done" | "position">>) =>
      api.put<ChecklistItem>(`/api/checklist-items/${id}`, data),
    delete: (id: string) => api.delete(`/api/checklist-items/${id}`),
  },
  dependencies: {
    list: (taskId: string) => api.get<{ dependsOn: Task[] }>(`/api/tasks/${taskId}/dependencies`),
    add: (taskId: string, dependsOnTaskId: string) =>
      api.post(`/api/tasks/${taskId}/dependencies`, { depends_on_task_id: dependsOnTaskId }),
    remove: (taskId: string, dependsOnId: string) =>
      api.delete(`/api/tasks/${taskId}/dependencies/${dependsOnId}`),
  },
};

// ---- Timeline ----
export interface TimelineItem {
  id: string;
  item_type: "phase" | "task";
  title: string;
  start_date: string | null;
  due_date: string | null;
  progress_percent: number;
  parent_task_id: string | null;
  assignee_id: string | null;
}

export const timelineApi = {
  get: (projectId: string) =>
    api.get<{ items: TimelineItem[]; dependencies: { task_id: string; depends_on_task_id: string }[] }>(
      `/api/projects/${projectId}/timeline`
    ),
};

// ---- Client Portal (company-side management) ----
export type PortalUserStatus = "invited" | "active" | "disabled";

export interface ClientPortalUser {
  id: string;
  client_id: string;
  name: string;
  email: string;
  status: PortalUserStatus;
  last_login_at: string | null;
  created_at: string;
}

export const clientPortalApi = {
  list: (clientId: string) => api.get<{ portalUsers: ClientPortalUser[] }>(`/api/clients/${clientId}/portal-users`),
  invite: (clientId: string, data: { name: string; email: string }) =>
    api.post<ClientPortalUser>(`/api/clients/${clientId}/portal-users`, data),
  revoke: (clientId: string, id: string) => api.delete(`/api/clients/${clientId}/portal-users/${id}`),
};
```

> **الفواتير/المشاريع/المدفوعات جوه بوابة العميل** بتستخدم نفس الـ `Invoice`/`Project`/`ClientPaymentSummary` types الموجودة في `lib/api.ts` بالفعل — مفيش داعي لتكرارها، بس هتتنادى من `lib/portal-api.ts` منفصل (قسم 4) لأنه axios instance مختلف (توكن مختلف).

---

## 2. Hooks جديدة (نفس نمط `use-payments.ts`)

- `hooks/use-project-members.ts` → `useProjectMembers`, `useAddProjectMember`, `useUpdateProjectMember`, `useRemoveProjectMember`
- `hooks/use-team.ts` → `useTeamWorkload`
- `hooks/use-tasks.ts` → `useTasks`, `useSubtasks`, `useTask`, `useCreateTask`, `useUpdateTask`, `useDeleteTask`, `useSetTaskStatus`, `useReorderTasks`, `useTaskChecklist`, `useAddChecklistItem`, `useUpdateChecklistItem`, `useDeleteChecklistItem`, `useTaskDependencies`, `useAddTaskDependency`, `useRemoveTaskDependency`
- `hooks/use-timeline.ts` → `useProjectTimeline`
- `hooks/use-client-portal.ts` → `useClientPortalUsers`, `useInviteClientPortalUser`, `useRevokeClientPortalUser`

مثال (`useSetTaskStatus` — أهم واحد لأنه بيتنادى كتير من الـ Kanban):
```ts
export function useSetTaskStatus(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      tasksApi.setStatus(id, status).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["timeline", projectId] });
      qc.invalidateQueries({ queryKey: ["team", "workload"] });
    },
  });
}
```

---

## 3. مكوّن جديد: `components/ui/Tabs.tsx`

مطلوب لتنظيم صفحة تفاصيل المشروع (Overview / Phases / Invoices / **Tasks** / **Team** / **Timeline**) بدل تكديس كروت فوق بعض — يدويًا بدون مكتبة:

```tsx
"use client";
import { useState, type ReactNode } from "react";

interface Tab { key: string; label: string; content: ReactNode }
interface TabsProps { tabs: Tab[]; defaultTab?: string }

export function Tabs({ tabs, defaultTab }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.key);
  return (
    <div>
      <div className="flex gap-1 border-b border-(--card-border)">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active === t.key
                ? "border-(--primary) text-(--primary)"
                : "border-transparent text-(--muted) hover:text-(--foreground)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="pt-4">{tabs.find((t) => t.key === active)?.content}</div>
    </div>
  );
}
```

`app/dashboard/projects/[id]/page.tsx` يتحول لـ: Overview card فوق ثابت، وتحته `<Tabs tabs={[{key:"phases",...}, {key:"invoices",...}, {key:"tasks",...}, {key:"team",...}, {key:"timeline",...}]} />`.

---

## 4. المهام (Tasks) — الواجهة

### 4.1 `components/tasks/TaskForm.tsx` + `TaskFormModal.tsx`

نفس نمط الفورمز الجديد (`formId` + footer في `Modal`، بدون أزرار جوه الفورم):
- حقول: Title*, Description (Textarea), Status (CustomSelect: todo/in_progress/in_review/done/blocked), Priority (CustomSelect: low/medium/high/urgent), Assignee (CustomSelect **searchable** — من `useProjectMembers(projectId)`، مش كل مستخدمي الشركة، عشان الليستة تبقى ذات صلة)، Start date, Due date، Phase (اختياري، من `usePhases`).
- `size="lg"` (زي Invoice/VendorBill — عدد حقول مشابه).

### 4.2 لوحة Kanban — `components/tasks/KanbanBoard.tsx`

**بدون مكتبة drag-and-drop** (نفس مبدأ "مافيش تبعيات جديدة"). عمود لكل status، وكل كارت فيه زرار "→ نقل لـ [الحالة الجاية]" بدل السحب:

```tsx
const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "To Do" },
  { status: "in_progress", label: "In Progress" },
  { status: "in_review", label: "In Review" },
  { status: "done", label: "Done" },
];
```
- `blocked` بتتعرض كـ badge/فلتر منفصل مش عمود قائم بذاته (نادرة نسبيًا، وعمود خامس بيبوّظ التخطيط الأفقي على الموبايل).
- كل عمود: `<div className="min-w-64 flex-1 space-y-2">` جوه `<div className="flex gap-4 overflow-x-auto">` (scroll أفقي على الشاشات الصغيرة، نفس مبدأ الجداول).
- كل كارت (`TaskCard.tsx`): العنوان، `Badge` بالأولوية (priority→variant: low=neutral, medium=info, high=warning, urgent=danger)، اسم المكلّف (أول حرفين من الاسم في دائرة صغيرة بلون `--accent-muted`)، تاريخ الاستحقاق (أحمر لو فات)، شريط تقدّم صغير لو فيه checklist (`{done}/{total}`)، وعدد الـ subtasks لو فيها.
- زرار النقل بيستخدم `useSetTaskStatus` + تحديد الحالة الجاية من ترتيب `COLUMNS` (أو Select صغير لو عايز تنقل لحالة مش بالترتيب).

### 4.3 Subtasks & Checklist

جوه تفاصيل الـ Task (Modal تانية أو صفحة منفصلة `app/dashboard/tasks/[id]/page.tsx` — الأنسب Modal عشان السياق (المشروع) يفضل واضح):
- قائمة Subtasks (نفس شكل TaskCard مصغّر) + زرار "Add subtask" بيفتح نفس `TaskFormModal` مع `parent_task_id` مُمرَّر.
- `ChecklistPanel.tsx`: قائمة `checkbox` + عنوان + زرار حذف لكل بند، + input صغير تحت لإضافة بند جديد (Enter للإضافة).

### 4.4 صفحة/تبويب Team

جوه تبويب "Team" بصفحة المشروع:
- جدول (`Table` primitive) بأعضاء المشروع: الاسم، الدور، نسبة التخصيص، تاريخ الإضافة، زرار حذف.
- زرار "Add member" يفتح مودال صغير (`size="md"`): `CustomSelect searchable` لاختيار مستخدم من مستخدمي الشركة (مش أعضاء المشروع الحاليين — فلترهم من القايمة)، `CustomSelect` للدور، `Input` رقمي لنسبة التخصيص.

### 4.5 صفحة جديدة `/dashboard/team` — نظرة عامة على الفريق

`Table` بكل مستخدمي الشركة: الاسم، عدد المشاريع النشطة، إجمالي نسبة التخصيص (badge أحمر لو > 100%)، عدد المهام المفتوحة، عدد المهام المتأخرة (badge أحمر لو > 0). مبني على `useTeamWorkload`.

### 4.6 تبويب Timeline — Gantt يدوي بدون مكتبة رسم

`components/tasks/GanttChart.tsx`:
1. احسب مدى التاريخ الكامل للمشروع (`rangeStart` = أقدم `start_date`, `rangeEnd` = أبعد `due_date` بين كل الـ `items`).
2. لكل item: `left% = (item.start - rangeStart) / totalDays * 100`, `width% = (item.due - item.start) / totalDays * 100`.
3. صف واحد لكل item (اسم على الشمال بعرض ثابت + شريط ملوّن على اليمين بعرض نسبي داخل container بـ `overflow-x-auto`):
   - `phase` → لون `--primary` (Pine).
   - `task` → لون `--accent` (Mint)، وعرض تعبئة داخلي بنسبة `progress_percent`.
4. **v1 بدون خطوط اعتماديات مرسومة** (الـ arrows بين المهام) — بدالها، عرض نصي بسيط "Blocked by: [اسم المهمة]" كـ tooltip/badge صغير جنب المهمة اللي عندها dependency. رسم الخطوط الفعلي (SVG) يتأجل لو احتجناه لاحقًا، مش أولوية v1.
5. خط رأسي رفيع بلون `--destructive` يوضح "اليوم" (`current_date`) لمقارنة سريعة بصريًا.

---

## 5. بوابة العميل — تطبيق منفصل بالكامل

### 5.1 البنية

```
app/portal/
  layout.tsx              -- Layout مبسّط (شعار + اسم العميل + Logout)، بدون الـ Sidebar الداخلي
  login/page.tsx
  accept-invite/page.tsx
  page.tsx                 -- Dashboard: قائمة مشاريع العميل
  projects/[id]/page.tsx   -- تفاصيل مشروع (Phases + Timeline read-only + زرار Approve)
  invoices/page.tsx
  invoices/[id]/page.tsx

lib/
  portal-config.ts          -- PORTAL_TOKEN_KEY منفصل عن TOKEN_KEY (كوكي مختلف تمامًا)
  portal-api.ts             -- axios instance منفصل، baseURL نفسه لكن يبعت PORTAL_TOKEN_KEY في الهيدر
  portal-auth-context.tsx   -- AuthProvider منفصل (نفس شكل lib/auth-context.tsx لكن لـ portal user)

hooks/
  use-portal.ts             -- usePortalProjects, usePortalProject, usePortalInvoices, usePortalInvoice,
                                usePortalPaymentSummary, useApprovePhase
```

**أهم قرار تصميمي**: كوكي منفصل (`portal_token` بدل `token`) — عشان لو حد فتح تبويبين في نفس المتصفح (واحد داخلي كموظف وواحد كعميل)، الجلستين متتصادمش. `lib/portal-api.ts` نسخة طبق الأصل من `lib/api.ts` لكن بتقرا من الكوكي التاني، ولو حصل 401 بترجّع لـ `/portal/login` مش `/login`.

### 5.2 التصميم البصري

نفس التوكينز (Pine/Mint، الخطوط، Button/Card/Input/Badge) — العميل شايف نفس هوية CodeWars، لكن:
- بدون Sidebar داخلي (العميل مش محتاج Invoices/Vendors/Expenses بتوع كل الشركة).
- Header مبسّط: شعار + "مرحبًا، [اسم العميل]" + Logout بس.
- كل الشاشات read-only ما عدا زرار "Approve" على كل Phase.

### 5.3 صفحة تفاصيل مشروع العميل

- بطاقة معلومات المشروع (بدون تفاصيل مالية داخلية زي التكاليف — بس السعر الإجمالي والمدفوع والمتبقي، نفس `ClientPaymentSummary` الموجود بالفعل).
- قائمة Phases بحالتها + زرار "Approve this phase" (يظهر بس لو `client_approved_at` فاضي) → `useApprovePhase` → `POST /api/portal/phases/:id/approve`.
- Timeline مبسّط (نفس `GanttChart` لكن بدون تفاصيل المهام الداخلية التفصيلية — عرض الـ Phases بس، أو Phases + Tasks لو الشركة حابة تدّي شفافية أكتر، **قرار قابل للنقاش مع الفريق**).

### 5.4 صفحة الفواتير

نفس شكل `/dashboard/invoices` لكن read-only (بدون Send/Cancel)، وبدون عمود Client (كله لنفس العميل أصلًا).

---

## 6. تحديثات على شاشات موجودة

| الملف | التغيير |
|---|---|
| `components/layout/Sidebar.tsx` | إضافة لينك "Team" (`/dashboard/team`) بجانب Clients/Projects |
| `app/dashboard/projects/[id]/page.tsx` | إعادة هيكلة لـ `Tabs`: Overview (ثابت) + Phases + Invoices + **Tasks** + **Team** + **Timeline** |
| `app/dashboard/clients/[id]/page.tsx` | قسم جديد "Portal Access": قائمة `client_portal_users` + زرار "Invite to portal" (مودال Name+Email) |
| `lib/status-badges.ts` | إضافة `taskStatusVariant` و`taskPriorityVariant` (نفس فكرة `invoiceStatusVariant` الموجودة) |

```ts
export const taskStatusVariant: Record<TaskStatus, BadgeVariant> = {
  todo: "neutral", in_progress: "info", in_review: "warning", done: "success", blocked: "danger",
};
export const taskPriorityVariant: Record<TaskPriority, BadgeVariant> = {
  low: "neutral", medium: "info", high: "warning", urgent: "danger",
};
```

---

## 7. ترتيب تنفيذ الفرونت إند المقترح

```
[ ] 1. lib/api.ts (كل الأنواع + API objects) + lib/status-badges.ts إضافات — لا يكسر شيء
[ ] 2. hooks/use-project-members.ts, use-team.ts, use-tasks.ts, use-timeline.ts
[ ] 3. components/ui/Tabs.tsx (primitive جديد، بدون تبعيات على أي حاجة تانية)
[ ] 4. TaskForm + TaskFormModal + KanbanBoard + TaskCard (أعلى قيمة ملموسة للمستخدم)
[ ] 5. ChecklistPanel + Subtasks داخل تفاصيل المهمة
[ ] 6. تبويب Team داخل صفحة المشروع + صفحة /dashboard/team
[ ] 7. GanttChart + تبويب Timeline
[ ] 8. إعادة هيكلة صفحة تفاصيل المشروع بالكامل لاستخدام Tabs (آخر خطوة داخلية، بعد ما كل التبويبات جاهزة)
[ ] 9. بوابة العميل: lib/portal-config.ts + portal-api.ts + portal-auth-context.tsx (البنية التحتية الأمنية الأول)
[ ] 10. app/portal/login + accept-invite (لازم تشتغل قبل أي حاجة تانية في البوابة)
[ ] 11. app/portal/page.tsx (dashboard) + projects/[id] + invoices
[ ] 12. قسم "Portal Access" في صفحة تفاصيل العميل الداخلية (دعوة العملاء)
```

> **نصيحة تنفيذية**: ابدأ بالمهام (خطوات 1-8) لأنها بتشتغل بالكامل جوه النظام الداخلي الموجود وقيمتها ملموسة فورًا. بوابة العميل (9-12) نظام مستقل شبه كامل (auth + layout + صفحات منفصلة) — يصلح يتوزع لشخص/جلسة تانية تشتغل عليه بالتوازي من غير ما تتعارض مع شغل المهام.
