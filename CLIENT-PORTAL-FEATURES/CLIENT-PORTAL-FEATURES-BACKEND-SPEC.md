# ملف تنفيذ الباك إند — ميزات بوابة العميل الجديدة

يغطي الـ endpoints المطلوبة لتنفيذ فيتشرز [`../client-portal-spec.md`](../client-portal-spec.md) (Sprint 1-3: Notifications, Meetings, Project Links, Action Items, Pending on Client, Credentials, Micro-feedback). مبني على [`CLIENT-PORTAL-FEATURES-DATABASE-SUPABASE.md`](./CLIENT-PORTAL-FEATURES-DATABASE-SUPABASE.md) وبنفس أسلوب `PMS-PM-FEATURES/PMS-PM-FEATURES-BACKEND-SPEC.md` (شكل الأخطاء، الـ pagination، الـ auth الحالي).

**نقطة مهمة:** كل الـ endpoints تحت `/api/portal/*` محمية بـ middleware مصادقة بوابة العميل (منفصل تمامًا عن مصادقة الشركة) وكل استعلام فيها **لازم يتفلتر تلقائيًا** حسب `client_id` المستخرج من التوكن — العميل ميقدرش يشوف أي حاجة بره مشاريعه حتى لو خمّن الـ ID.

---

## 1. Notifications (أساس)

**Base:** `/api/notifications` (داشبورد) و`/api/portal/notifications` (بوابة) — نفس المنطق، endpoint مختلف حسب نوع الـ recipient.

```
GET /api/notifications?is_read=false&limit=10
    → { notifications: Notification[], unreadCount: number }
    يفلتر تلقائيًا: recipient_type='team_member', recipient_id = current user id

PATCH /api/notifications/:id/read       → 200، يحدد is_read=true, read_at=now()
PATCH /api/notifications/read-all       → 200، يحدد كل إشعارات المستخدم الحالي كمقروءة
```

```
GET /api/portal/notifications?is_read=false&limit=10
PATCH /api/portal/notifications/:id/read
PATCH /api/portal/notifications/read-all
```
نفس الـ shape، لكن `recipient_type='client_portal_user'` مأخوذة من توكن البوابة.

**Response shape (Notification):**
```json
{
  "id": "uuid", "type": "meeting_reminder", "title": "...", "body": "...",
  "related_type": "meeting", "related_id": "uuid",
  "is_read": false, "read_at": null, "created_at": "..."
}
```

### توليد الإشعارات (Internal — مش endpoint عام)
دالة داخلية `createNotification({ company_id, recipient_type, recipient_id, type, title, body, related_type?, related_id? })` تُستدعى من نقاط تانية في الكود (مش من الفرونت):
- عند اعتماد مرحلة (`phase_approved`) → إشعار لكل `team_member` مسؤول عن المشروع.
- عند إضافة محضر ميتنج (`meeting_note_added`) → إشعار لكل الحاضرين من نوع `client_portal_user`.
- عند إسناد Task لعميل (`task_assigned_to_client`) → إشعار للعميل نفسه.
- عند اقتراب موعد ميتنج (`meeting_reminder`) → عبر الـ Cron أدناه.

### Cron Job — تذكيرات الميتنجز
Job كل ساعة يفحص:
```sql
select * from meetings
where status = 'scheduled'
  and scheduled_at between now() and now() + interval '24 hours'
  and id not in (
    select related_id from notifications
    where type = 'meeting_reminder' and related_type = 'meeting'
  );
```
لكل نتيجة: يولّد إشعار `meeting_reminder` لكل الحاضرين (`meeting_attendees`) + **إيميل** (عبر SendGrid/Resend — استخدم أي خدمة الفريق مستخدمها بالفعل، لو مفيش حاليًا رشّح Resend لبساطة الـ API).

**Idempotency:** الشرط `id not in (...)` يمنع تكرار نفس التذكير أكتر من مرة حتى لو الـ Cron اتشغل أكتر من مرة في الساعة.

---

## 2. Meetings

**Base (Dashboard):** `/api/projects/:projectId/meetings`

```
POST /api/projects/:projectId/meetings
     body: { title, agenda?, scheduled_at, meeting_link?, attendee_ids: { team_member_ids?: string[], client_portal_user_ids?: string[] } }
     201 → Meeting كامل + attendees

GET  /api/projects/:projectId/meetings?status=
     → { meetings: Meeting[] }   (بدون pagination، عدد الميتنجات لكل مشروع صغير عادةً)

PATCH /api/meetings/:id
     body: { title?, agenda?, scheduled_at?, meeting_link?, status? }
     تغيير status لـ 'cancelled' يبعت إشعار لكل الحاضرين تلقائيًا (نوع جديد أو نستخدم title مخصص — قرار بسيط وقت التنفيذ)
```

### محاضر الميتنج

```
POST /api/meetings/:id/notes
     body: { content: string /* markdown */, action_items?: ActionItemInput[] }
     201 → MeetingNote

     ActionItemInput = { title, assignee_type: 'team_member'|'client', assignee_id, due_date? }
     كل عنصر في action_items بيتحول لـ Task بـ source='meeting', source_id=meeting.id
     (استخدم منطق POST /api/projects/:projectId/tasks الموجود داخليًا — لا تكرر منطق الـ validation)

GET  /api/meetings/:id/notes
     → { notes: MeetingNote[] }

GET  /api/meetings/:id/notes/export
     → يولّد ملف Word (.docx) على الطاير ويرجّعه كـ stream (Content-Disposition: attachment)
     المكتبة المقترحة: `docx` (Node) — لا تحتاج تخزين دائم، لكن لو حبيت تكاش النسخة الأولى خزّن الرابط في meeting_notes.word_file_url (Supabase Storage) وارجعه من نفس الـ endpoint في المرات الجاية بدل إعادة التوليد
```

**محتوى ملف الـ Word:** اسم المشروع، تاريخ الميتنج، قائمة الحضور، الأجندة، نص المحضر، وFooter بصيغة:
`"تم التصدير بتاريخ {export_date} لصالح {client_name}"`

### Endpoints (Portal — قراءة فقط)

```
GET  /api/portal/projects/:id/meetings                → { meetings: PortalMeeting[] }
GET  /api/portal/meetings/:id/notes                    → { notes: MeetingNote[] }
POST /api/portal/meeting-notes/:id/mark-read           → 200، INSERT INTO meeting_note_reads ... ON CONFLICT (meeting_note_id, portal_user_id) DO NOTHING
GET  /api/portal/meeting-notes/:id/export              → نفس منطق الـ Word export
```
> `mark-read` idempotent بفضل الـ `unique constraint` — النداء الأول بس هو اللي بيسجل `read_at`، الباقي بيرجع 200 من غير تعديل.

**عرض "Seen at" في الداشبورد:** endpoint الميتنج notes في الداشبورد (`GET /api/meetings/:id/notes`) يرجّع كمان `reads: { portal_user_id, portal_user_name, read_at }[]` لكل note — الفرونت بيعرضها كـ badge.

---

## 3. Project Links

```
POST   /api/projects/:id/links      body: { label, url, type? }     201 → ProjectLink
GET    /api/projects/:id/links      → { links: ProjectLink[] }
DELETE /api/project-links/:id       204

GET    /api/portal/projects/:id/links   → { links: ProjectLink[] }   (قراءة فقط)
```
**Validation:** `url` لازم يبدأ بـ `http://` أو `https://` — رفض بـ 400 لو مش كذلك (منع XSS عبر `javascript:` URLs).

---

## 4. توسعة Tasks — Action Items + Pending on Client

### 4.1 لا تعديل جذري على endpoints الموجودة
كل الـ Task endpoints الحالية (`PMS-PM-FEATURES-BACKEND-SPEC.md` قسم 2) تشتغل زي ما هي. الإضافة الوحيدة: حقول `source`, `source_id`, `assignee_type`, `client_assignee_id` في الـ request/response body.

```
POST /api/projects/:projectId/tasks
     body (إضافة): { ..., assignee_type?: 'team_member'|'client', client_assignee_id?: string }
     Validation:
       - assignee_type='client' → client_assignee_id مطلوب و assignee_id يترفض لو اتبعت (400)
       - assignee_type='team_member' (default) → assignee_id زي ما هو، client_assignee_id يترفض لو اتبعت
       - client_assignee_id لازم يكون portal user تابع لنفس عميل المشروع (join client_portal_users → clients → projects) وإلا 400
```

### 4.2 Pending on Client (Portal)

مفيش endpoint جديد بالكامل — نفس `GET /api/portal/projects/:id/tasks` (لو مش موجود، ضيفه كنسخة portal من tasks list) بفلتر:

```
GET /api/portal/projects/:id/tasks?assignee_type=client&status=ne:done
    → { tasks: Task[] }
```
لاحظ صيغة `status=ne:done` (not-equal) — لو الباك إند الحالي مش بيدعم operators في الـ query، أبسط حل: فلتر ثابت `status not in ('done')` جوه الكود نفسه بدل بارامتر عام، وسيب `assignee_type=client` بس كـ query param.

**هل العميل يقدر يقفل المهمة؟** القرار في الـ spec الأصلي مفتوح ("أو يفضل read-only"). التوصية: ابدأ **read-only** في أول نسخة (أبسط وأأمن)، وسيب endpoint منفصل جاهز لو الفريق قرر السماح لاحقًا:
```
POST /api/portal/tasks/:id/mark-done
     Validation: التاسك دي لازم تكون client_assignee_id = current portal user، وإلا 403
```
لا تنفّذه في Sprint 2 إلا لو الفريق أكّد الحاجة له صراحة.

---

## 5. Credentials

**Base:** `/api/projects/:id/credentials`

```
POST /api/projects/:id/credentials
     body: { label, username, password, panel_url?, notes? }
     السيرفر بيشفر password بـ AES-256-GCM قبل التخزين في password_encrypted، الـ plaintext ميتخزنش ولا يترجع في أي response تاني
     201 → { id, label, username, panel_url, notes, created_at }   (بدون password)

GET /api/projects/:id/credentials
     → { credentials: [{ id, label, username, panel_url, notes, created_at }] }   -- من غير الباسورد إطلاقًا

POST /api/credentials/:id/reveal
     → { password: string }   -- فك التشفير وقت الطلب فقط
     Side effect: INSERT INTO credential_access_logs (credential_id, accessed_by_type, accessed_by_id)

GET /api/credentials/:id/access-log     (داشبورد فقط، صلاحية company user)
     → { logs: [{ accessed_by_type, accessed_by_name, accessed_at }] }
```

### Portal (نفس المنطق، مفلتر على مشاريع العميل)
```
GET  /api/portal/projects/:id/credentials
POST /api/portal/credentials/:id/reveal
```

### تفاصيل الأمان (إلزامية، مش اختيارية)

1. **التشفير:** AES-256-GCM (مش ECB، مش base64 — base64 ترميز مش تشفير). استخدم مكتبة `crypto` المدمجة في Node (`crypto.createCipheriv`) — خزّن الـ IV مع الـ ciphertext (مثلاً `iv:authTag:ciphertext` بصيغة hex/base64 واحدة في نفس العمود).
2. **مفتاح التشفير (`ENCRYPTION_KEY`):** 32 بايت، في environment variable على السيرفر فقط — **ممنوع** يتحط في الكود أو في جدول إعدادات بالداتابيز.
3. **حماية الـ `/reveal`:** نفس الـ Auth middleware العادي + **rate limiting** صريح (مثلاً 10 طلبات/دقيقة لكل مستخدم) لمنع استخراج جماعي (bulk scraping) لو حصل تسريب توكن.
4. **صلاحية زمنية على الفرونت:** الباك إند مش مسؤول عن ده، لكن لازم يوثّق في الفرونت spec إن الباسورد يتخفي تلقائيًا بعد مهلة قصيرة حتى لو التاب فاضل مفتوح (تفصيل في `CLIENT-PORTAL-FEATURES-FRONTEND-SPEC.md`).
5. **لا تسجيل للباسورد في أي log عام** (تأكد إن الـ request/response logging middleware الحالي عندك مبيسجلش body بتاع `/credentials` و`/reveal`).

---

## 6. Micro-feedback

```
POST /api/portal/feedback
     body: { project_id, related_type: 'meeting'|'phase', related_id, rating: 1-5 }
     Validation: related_id لازم يتبع project_id المحدد، والمشروع لازم يتبع عميل التوكن الحالي
     على تكرار نفس (related_type, related_id, submitted_by) → UPSERT (تحديث التقييم بدل رفض 409)
     201/200

GET /api/projects/:id/feedback     (داشبورد)
     → { feedback: [{ id, related_type, related_id, rating, submitted_by_name, created_at }], averageRating: number }
```

**اقتراح widget بسيط للداشبورد الرئيسي:** إضافة حقل `recentFeedbackAverage` (متوسط آخر 5 تقييمات على مستوى الشركة كلها) لـ response الموجود في `GET /api/statistics/dashboard` — تعديل بسيط، مش endpoint جديد.

---

## 7. ملخص الـ endpoints الجديدة (مرجع سريع)

| Method | Path | الوصف |
|---|---|---|
| GET/PATCH | `/api/notifications*` , `/api/portal/notifications*` | الإشعارات |
| POST/GET/PATCH | `/api/projects/:id/meetings`, `/api/meetings/:id` | الميتنجز |
| POST/GET | `/api/meetings/:id/notes`, `.../export` | محاضر الميتنجز |
| GET/POST | `/api/portal/projects/:id/meetings`, `/api/portal/meeting-notes/:id/*` | ميتنجز البوابة |
| POST/GET/DELETE | `/api/projects/:id/links`, `/api/project-links/:id` | روابط المشروع |
| GET | `/api/portal/projects/:id/links` | روابط البوابة |
| GET | `/api/portal/projects/:id/tasks?assignee_type=client` | مطلوب من العميل |
| POST/GET | `/api/projects/:id/credentials`, `/api/credentials/:id/reveal`, `/api/credentials/:id/access-log` | بيانات الدخول |
| GET/POST | `/api/portal/projects/:id/credentials`, `/api/portal/credentials/:id/reveal` | بيانات دخول البوابة |
| POST/GET | `/api/portal/feedback`, `/api/projects/:id/feedback` | التقييمات |
