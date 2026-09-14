# ملف تنفيذ الفرونت إند — ميزات بوابة العميل الجديدة

تنفيذ فعلي على **هذا الريبو** لفيتشرز [`../client-portal-spec.md`](../client-portal-spec.md) (Sprint 1-3)، بنفس الكونفنشنز المستخدمة فعليًا في الكود الحالي:
- React Query hooks لكل دومين (`hooks/use-*.ts`) بنفس نمط `invalidateQueries`.
- `Modal` + `formId` على الفورم + `footer` فيه Cancel/Submit (زي `TaskFormModal.tsx`).
- `Tabs`, `Table`, `Badge`, `Card`, `CustomSelect` الموجودين — من غير أي مكتبة خارجية جديدة على الفرونت (الـ docx export سيرفر-سايد بس).
- Design tokens الحالية: `--primary`, `--accent`, `--muted`, `--card-border`, `--destructive`, `--success`.
- عميلي axios منفصلين: `lib/api.ts` (داشبورد) و`lib/portal-api.ts` (بوابة) — كل فيتشر ليه إضافة في الاتنين حسب الحاجة.

---

## 1. `lib/api.ts` — إضافات (جانب الداشبورد)

### 1.1 Notifications

```ts
export type NotificationType =
  | "meeting_reminder" | "meeting_note_added" | "action_item_assigned"
  | "phase_approved" | "task_assigned_to_client" | "feedback_requested";

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  related_type: "meeting" | "task" | "phase" | "invoice" | null;
  related_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export const notificationsApi = {
  list: (params?: { is_read?: boolean; limit?: number }) =>
    api.get<{ notifications: AppNotification[]; unreadCount: number }>("/api/notifications", { params }),
  markRead: (id: string) => api.patch<AppNotification>(`/api/notifications/${id}/read`),
  markAllRead: () => api.patch("/api/notifications/read-all"),
};
```

### 1.2 Meetings

```ts
export type MeetingStatus = "scheduled" | "completed" | "cancelled";

export interface Meeting {
  id: string;
  project_id: string;
  title: string;
  agenda: string | null;
  scheduled_at: string;
  meeting_link: string | null;
  status: MeetingStatus;
  created_at: string;
}

export interface CreateMeetingInput {
  title: string;
  agenda?: string;
  scheduled_at: string;
  meeting_link?: string;
  attendee_ids: { team_member_ids?: string[]; client_portal_user_ids?: string[] };
}

export interface ActionItemInput {
  title: string;
  assignee_type: "team_member" | "client";
  assignee_id: string;
  due_date?: string;
}

export interface MeetingNoteRead {
  portal_user_id: string;
  portal_user_name: string;
  read_at: string;
}

export interface MeetingNote {
  id: string;
  meeting_id: string;
  content: string;
  word_file_url: string | null;
  created_at: string;
  reads: MeetingNoteRead[];
}

export const meetingsApi = {
  list: (projectId: string, params?: { status?: MeetingStatus }) =>
    api.get<{ meetings: Meeting[] }>(`/api/projects/${projectId}/meetings`, { params }),
  create: (projectId: string, data: CreateMeetingInput) =>
    api.post<Meeting>(`/api/projects/${projectId}/meetings`, data),
  update: (id: string, data: Partial<CreateMeetingInput> & { status?: MeetingStatus }) =>
    api.patch<Meeting>(`/api/meetings/${id}`, data),
  notes: {
    list: (meetingId: string) => api.get<{ notes: MeetingNote[] }>(`/api/meetings/${meetingId}/notes`),
    add: (meetingId: string, data: { content: string; action_items?: ActionItemInput[] }) =>
      api.post<MeetingNote>(`/api/meetings/${meetingId}/notes`, data),
    exportUrl: (meetingId: string) => `${API_BASE}api/meetings/${meetingId}/notes/export`,
  },
};
```
> `exportUrl` بيتفتح بـ `window.open(url, "_blank")` مع الكوكي/توكن — لو الباك إند محتاج `Authorization` header صريح بدل الكوكي، استخدم `api.get(..., { responseType: "blob" })` وحوّل الـ blob لرابط تنزيل بـ `URL.createObjectURL` بدل `window.open` المباشر.

### 1.3 Project Links

```ts
export type ProjectLinkType = "staging" | "live" | "dashboard" | "other";

export interface ProjectLink {
  id: string;
  project_id: string;
  label: string;
  url: string;
  type: ProjectLinkType;
  created_at: string;
}

export const projectLinksApi = {
  list: (projectId: string) => api.get<{ links: ProjectLink[] }>(`/api/projects/${projectId}/links`),
  create: (projectId: string, data: { label: string; url: string; type?: ProjectLinkType }) =>
    api.post<ProjectLink>(`/api/projects/${projectId}/links`, data),
  delete: (id: string) => api.delete(`/api/project-links/${id}`),
};
```

### 1.4 توسعة Task / CreateTaskInput

```ts
// في تعريف Task الحالي، أضف:
export interface Task {
  // ...الحقول الموجودة
  source: "manual" | "meeting";
  source_id: string | null;
  assignee_type: "team_member" | "client";
  client_assignee_id: string | null;
  client_assignee_name: string | null;
}

// في CreateTaskInput الحالي، أضف:
export interface CreateTaskInput {
  // ...الحقول الموجودة
  assignee_type?: "team_member" | "client";
  client_assignee_id?: string | null;
}
```
باقي `tasksApi` زي ما هو — مفيش endpoints جديدة هنا.

### 1.5 Credentials

```ts
export interface Credential {
  id: string;
  project_id: string;
  label: string;
  username: string;
  panel_url: string | null;
  notes: string | null;
  created_at: string;
}

export interface CreateCredentialInput {
  label: string;
  username: string;
  password: string;
  panel_url?: string;
  notes?: string;
}

export interface CredentialAccessLog {
  accessed_by_type: "team_member" | "client_portal_user";
  accessed_by_name: string;
  accessed_at: string;
}

export const credentialsApi = {
  list: (projectId: string) => api.get<{ credentials: Credential[] }>(`/api/projects/${projectId}/credentials`),
  create: (projectId: string, data: CreateCredentialInput) =>
    api.post<Credential>(`/api/projects/${projectId}/credentials`, data),
  reveal: (id: string) => api.post<{ password: string }>(`/api/credentials/${id}/reveal`),
  accessLog: (id: string) => api.get<{ logs: CredentialAccessLog[] }>(`/api/credentials/${id}/access-log`),
};
```

### 1.6 Feedback

```ts
export interface FeedbackEntry {
  id: string;
  related_type: "meeting" | "phase";
  related_id: string;
  rating: number;
  submitted_by_name: string;
  created_at: string;
}

export const feedbackApi = {
  list: (projectId: string) =>
    api.get<{ feedback: FeedbackEntry[]; averageRating: number }>(`/api/projects/${projectId}/feedback`),
};
```

---

## 2. `lib/portal-api.ts` — إضافات (جانب البوابة)

```ts
import type {
  Meeting, MeetingNote, ProjectLink, Task, Credential,
} from "./api";

// ---- Notifications ----
export const portalNotificationsApi = {
  list: (params?: { is_read?: boolean; limit?: number }) =>
    portalApi.get<{ notifications: import("./api").AppNotification[]; unreadCount: number }>(
      "/api/portal/notifications", { params }
    ),
  markRead: (id: string) => portalApi.patch(`/api/portal/notifications/${id}/read`),
  markAllRead: () => portalApi.patch("/api/portal/notifications/read-all"),
};

// ---- Meetings ----
export const portalMeetingsApi = {
  list: (projectId: string) => portalApi.get<{ meetings: Meeting[] }>(`/api/portal/projects/${projectId}/meetings`),
  notes: (meetingId: string) => portalApi.get<{ notes: MeetingNote[] }>(`/api/portal/meetings/${meetingId}/notes`),
  markNoteRead: (noteId: string) => portalApi.post(`/api/portal/meeting-notes/${noteId}/mark-read`),
  exportUrl: (noteId: string) => `${API_BASE}api/portal/meeting-notes/${noteId}/export`,
};

// ---- Project Links ----
export const portalProjectLinksApi = {
  list: (projectId: string) => portalApi.get<{ links: ProjectLink[] }>(`/api/portal/projects/${projectId}/links`),
};

// ---- Pending on Client (Tasks) ----
export const portalTasksApi = {
  pendingOnClient: (projectId: string) =>
    portalApi.get<{ tasks: Task[] }>(`/api/portal/projects/${projectId}/tasks`, {
      params: { assignee_type: "client" },
    }),
};

// ---- Credentials ----
export const portalCredentialsApi = {
  list: (projectId: string) => portalApi.get<{ credentials: Credential[] }>(`/api/portal/projects/${projectId}/credentials`),
  reveal: (id: string) => portalApi.post<{ password: string }>(`/api/portal/credentials/${id}/reveal`),
};

// ---- Feedback ----
export const portalFeedbackApi = {
  submit: (data: { project_id: string; related_type: "meeting" | "phase"; related_id: string; rating: number }) =>
    portalApi.post("/api/portal/feedback", data),
};
```
> استيراد `API_BASE` موجود بالفعل أعلى الملف من `./config`.

---

## 3. Hooks جديدة (`hooks/`)

اتّبع نفس نمط `use-tasks.ts` بالضبط (queryKey arrays، invalidate بعد mutation).

### `hooks/use-notifications.ts`
```ts
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { notificationsApi } from "@/lib/api";

export function useNotifications(params?: { is_read?: boolean; limit?: number }) {
  return useQuery({
    queryKey: ["notifications", params],
    queryFn: () => notificationsApi.list(params).then((r) => r.data),
    refetchInterval: 60_000, // polling كل دقيقة بدل WebSocket — كافي لهذا الحجم من الاستخدام
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
```
نفس الشكل بالظبط لـ `hooks/use-portal-notifications.ts` باستخدام `portalNotificationsApi`.

### `hooks/use-meetings.ts`
```ts
"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { meetingsApi, type CreateMeetingInput, type MeetingStatus, type ActionItemInput } from "@/lib/api";

export function useMeetings(projectId: string | null, params?: { status?: MeetingStatus }) {
  return useQuery({
    queryKey: ["meetings", projectId, params],
    queryFn: () => meetingsApi.list(projectId!, params).then((r) => r.data),
    enabled: !!projectId,
  });
}

export function useCreateMeeting(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMeetingInput) => meetingsApi.create(projectId, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", projectId] }),
  });
}

export function useUpdateMeeting(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Parameters<typeof meetingsApi.update>[1]) =>
      meetingsApi.update(id, data).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meetings", projectId] }),
  });
}

export function useMeetingNotes(meetingId: string | null) {
  return useQuery({
    queryKey: ["meetings", meetingId, "notes"],
    queryFn: () => meetingsApi.notes.list(meetingId!).then((r) => r.data),
    enabled: !!meetingId,
  });
}

export function useAddMeetingNote(meetingId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { content: string; action_items?: ActionItemInput[] }) =>
      meetingsApi.notes.add(meetingId, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meetings", meetingId, "notes"] });
      qc.invalidateQueries({ queryKey: ["tasks", projectId] }); // لو اتضاف action items
    },
  });
}
```

### `hooks/use-project-links.ts`
نفس نمط `hooks/use-phases.ts` (list + create + delete بس، بدون update).

### `hooks/use-credentials.ts`
```ts
export function useCredentials(projectId: string) { /* useQuery */ }
export function useCreateCredential(projectId: string) { /* useMutation + invalidate */ }
export function useRevealCredential() {
  return useMutation({ mutationFn: (id: string) => credentialsApi.reveal(id).then((r) => r.data.password) });
  // ملاحظة: من غير invalidate — القيمة دي مؤقتة في الـ component نفسه بس (useState)، مش React Query cache دائم
}
export function useCredentialAccessLog(id: string | null) { /* useQuery enabled: !!id */ }
```

### `hooks/use-feedback.ts` و`hooks/use-portal-feedback.ts`
بسيطة — `useQuery` للـ list (داشبورد بس) و`useMutation` للـ submit (بوابة بس).

### توسعة `hooks/use-portal.ts`
أضف: `usePortalMeetings`, `usePortalMeetingNotes`, `useMarkMeetingNoteRead`, `usePortalProjectLinks`, `usePendingOnClientTasks`, `usePortalCredentials`, `useRevealPortalCredential` — بنفس نمط `usePortalProject`/`useApprovePhase` الموجودين حاليًا في نفس الملف.

---

## 4. مكونات جديدة

### 4.1 جرس الإشعارات — `components/layout/NotificationBell.tsx`
مكون واحد مشترك يُستخدم في `Header.tsx` (بـ `useNotifications`) و`PortalHeader.tsx` (بـ `usePortalNotifications`) عبر prop:

```ts
interface NotificationBellProps {
  notifications: AppNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}
```
UI: أيقونة `Bell` من lucide-react + badge دائري أحمر بعدد `unreadCount` (يختفي لو 0) + dropdown (نفس نمط الـ profile dropdown في `Header.tsx`: `useState` + `useRef` + click-outside) يعرض آخر 10 إشعارات، كل واحد بيتنقر يوديك لـ `related_type`/`related_id` (رابط مبني بـ helper `notificationLink()` بسيط: `meeting` → `/dashboard/projects/:projectId?tab=meetings`... إلخ) وبيعمل `onMarkRead` تلقائيًا عند الفتح.

يتضاف في `Header.tsx` بجانب زرار البروفايل، وفي `PortalHeader.tsx` بجانب اسم المستخدم.

### 4.2 الميتنجز — `components/meetings/`
- `MeetingsTab.tsx` (تبويب داخل صفحة المشروع بالداشبورد): جدول (`Table`) بالميتنجات (العنوان، الموعد، الحالة كـ `Badge`، زرار "Add note" لو `status='completed'`).
- `MeetingFormModal.tsx`: نفس نمط `TaskFormModal.tsx` — `formId` + حقول (title, agenda كـ `Textarea`, scheduled_at كـ datetime-local input, meeting_link, واختيار الحضور عبر `CustomSelect` متعدد — واحد لأعضاء الفريق `useProjectMembers(projectId)` وواحد لمستخدمي بوابة العميل `useClientPortalUsers` — يتفعّل بس لو المشروع عنده client مع portal users).
- `MeetingNoteModal.tsx`: `Textarea` كبير للمحضر (markdown نص عادي، من غير rich text editor خارجي)، وقسم "Action Items" أسفله فيه زرار "+ Add item" يضيف صف `{ title, assignee_type, assignee_id, due_date }` (نفس فكرة `SubtaskList.tsx` من ناحية التكرار الديناميكي)، وزرار "Export as Word" (يفتح `meetingsApi.notes.exportUrl(meetingId)`).
- بادج "From meeting" في `TaskCard.tsx`: لو `task.source === 'meeting'` أضف `<Badge variant="secondary" className="text-[10px]">From meeting</Badge>` جنب العنوان.

### 4.3 روابط المشروع — `components/projects/ProjectLinksTab.tsx`
قائمة بسيطة (زي قسم Phases الحالي في `page.tsx`): كل صف Label + أيقونة حسب `type` (`ExternalLink` من lucide-react كـ default) + رابط يفتح `target="_blank" rel="noopener noreferrer"` + زرار حذف. فورم إضافة بسيط جوه نفس التبويب (من غير Modal منفصل — الحقول قليلة: label, url, type كـ `Select`).

### 4.4 بيانات الدخول — `components/credentials/CredentialsTab.tsx` + `RevealPasswordCell.tsx`

```tsx
// RevealPasswordCell.tsx — منطق الإخفاء التلقائي بعد مهلة
function RevealPasswordCell({ credentialId }: { credentialId: string }) {
  const [password, setPassword] = useState<string | null>(null);
  const reveal = useRevealCredential();

  useEffect(() => {
    if (!password) return;
    const t = setTimeout(() => setPassword(null), 15_000); // إخفاء تلقائي بعد 15 ثانية
    return () => clearTimeout(t);
  }, [password]);

  if (password) {
    return (
      <span className="flex items-center gap-2 font-mono text-sm">
        {password}
        <button onClick={() => navigator.clipboard.writeText(password)} aria-label="Copy">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </span>
    );
  }
  return (
    <Button
      variant="ghost" size="sm"
      loading={reveal.isPending}
      onClick={() => reveal.mutate(credentialId, { onSuccess: setPassword })}
    >
      •••••• Show
    </Button>
  );
}
```
`CredentialsTab.tsx`: جدول (Label, Username, Password عبر `RevealPasswordCell`, Panel URL كرابط) + `CredentialFormModal.tsx` (فورم عادي فيه حقل password كـ `<Input type="password">`) + زرار "View access log" (داشبورد بس) بيفتح `Modal` صغير يعرض `useCredentialAccessLog`.
نفس التبويب بيتكرر في بوابة العميل (`components/portal/PortalCredentialsTab.tsx`) بدون زرار الإضافة ولا access log — قراءة + reveal بس.

### 4.5 مطلوب منك — `components/portal/PendingOnClientTab.tsx`
جدول بسيط (اسم المهمة، تاريخ الاستحقاق كـ Badge أحمر لو متأخر) — **read-only** في هذا الإصدار (قرار الباك إند سبرنت 2)، من غير أي زرار تعديل حالة.

### 4.6 تقييم مصغّر — `components/portal/FeedbackModal.tsx`
`Modal` صغير (`size="sm"`) فيه 5 نجوم (زرار `Star`/`StarFilled` من lucide-react، `useState<number>`) وزرار submit واحد. بيتفتح تلقائيًا (مش عبر زرار) في حالتين:
1. مباشرة بعد نجاح `useApprovePhase` — في `onSuccess` بتاعها.
2. أول مرة تفتح فيها `MeetingNoteModal` (نفس لحظة نداء `markNoteRead`) — استخدم `localStorage` بمفتاح `feedback-shown-{noteId}` لمنع تكرار الظهور لنفس الجهاز في نفس الجلسة (تحسين بسيط، مش شرط من الباك إند بما إن الـ unique constraint موجود أصلًا هناك).

---

## 5. تعديلات على الصفحات الموجودة

### 5.1 `app/dashboard/projects/[id]/page.tsx`
أضف تبويبات جديدة لمصفوفة `tabs` الموجودة في الـ `Tabs`:
```tsx
{ key: "meetings", label: "Meetings", content: <MeetingsTab projectId={id} /> },
{ key: "links", label: "Links", content: <ProjectLinksTab projectId={id} /> },
{ key: "credentials", label: "Credentials", content: <CredentialsTab projectId={id} /> },
```
ضعها بعد تبويب "team" ("Meetings", "Links") وبعد "phases" ("Credentials") — ترتيب اجتهادي، عدّله حسب أولوية الاستخدام الفعلية عند الفريق.

### 5.2 `app/portal/projects/[id]/page.tsx`
الصفحة دي حاليًا Cards ثابتة (بدون `Tabs`) — حوّلها لنفس نمط صفحة المشروع بالداشبورد باستخدام `<Tabs>` بدل الـ Cards المتتالية، بحيث تحتوي:
```
Phases (الموجود حاليًا) | Timeline | Meetings | Links | Credentials | مطلوب منك
```
`Timeline` تبويب جديد كمان يستخدم بيانات `project.timeline.items` الموجودة بالفعل في `PortalProjectDetail` (كانت مش معروضة قبل كده في هذه الصفحة رغم وجودها في الـ API) — يمكن عرضها بمكوّن مبسّط للقراءة فقط (بدون drag/edit)، أو بإعادة استخدام `GanttChart.tsx` الحالي في وضع read-only لو بياناته متوافقة.

### 5.3 `components/layout/Header.tsx` و`components/portal/PortalHeader.tsx`
أضف `<NotificationBell />` (مع الـ hook المناسب لكل واحد) بجانب أيقونة/زرار البروفايل الموجود.

### 5.4 `components/tasks/TaskForm.tsx`
أضف حقل toggle "Assign to" بقيمتين (Team member / Client)، ولما تختار "Client" يظهر `CustomSelect` تاني بمستخدمي بوابة عميل هذا المشروع تحديدًا (`useClientPortalUsers(project.client_id)` — هوك جديد بسيط بيستخدم `clientPortalApi.list` الموجود بالفعل في `lib/api.ts`) بدل select الموظفين العادي.

---

## 6. ترتيب تنفيذ مقترح (يوافق الـ Sprints)

1. **Sprint 1:** `notifications` (hook + NotificationBell) → `meetings` (كل المكونات) → `project-links`.
2. **Sprint 2:** توسعة `Task`/`CreateTaskInput` وتعديل `TaskForm.tsx` → ربط Action Items من `MeetingNoteModal` → `PendingOnClientTab` في البوابة.
3. **Sprint 3:** `credentials` (مع الانتباه الكامل لمنطق الإخفاء التلقائي والـ reveal) → `feedback` (Modal + widget بسيط في Dashboard الرئيسي لو الباك إند ضاف `recentFeedbackAverage`).

لكل سبرنت: نفّذ الداشبورد الأول (فيه كل عمليات الإدارة)، وبعدين نسخة البوابة (قراءة فقط في الغالب) — نفس الترتيب المتبع في تنفيذ فيتشرز Tasks/Timeline الحالية بالريبو.
