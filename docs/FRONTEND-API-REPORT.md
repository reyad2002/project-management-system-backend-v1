# تقرير API للفرونت إند — نظام إدارة المشاريع

هذا الملف يوضح كل تفاصيل الـ Backend API حتى يستطيع فريق الفرونت إند البدء فوراً بدون الرجوع للكود.

---

## 1. معلومات عامة

| البند | القيمة |
|--------|--------|
| **Base URL** | `http://localhost:3001` (أو حسب `PORT` في `.env`) |
| **البنية** | REST API — JSON |
| **المصادقة** | JWT في الهيدر: `Authorization: Bearer <token>` |
| **CORS** | مسموح للأورجن: `http://localhost:3000` فقط (يُفضّل إضافة دومين الفرونت عند النشر) |
| **Health Check** | `GET /health` — لا يحتاج توكن |

---

## 2. المصادقة (Auth)

جميع المسارات التالية تحت `/api/...` ما عدا `/api/auth/*` و `/health` تحتاج إلى توكن في الهيدر.

### 2.1 تسجيل الدخول (مستخدم شركة)

```http
POST /api/auth/login
Content-Type: application/json
```

**Body:**

```json
{
  "email": "user@example.com",
  "password": "********"
}
```

**Response 200:**

```json
{
  "user": {
    "id": "uuid",
    "created_at": "ISO8601",
    "name": "اسم المستخدم",
    "email": "user@example.com",
    "status": "active",
    "company_id": "uuid",
    "company": { "name": "اسم الشركة" }
  },
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

- **400** — `Email and password required`
- **401** — `Invalid email or password`
- **403** — `Account is blocked or inactive`
- **503** — `Database not configured` أو `Auth not configured (JWT_SECRET)`

---

### 2.2 تسجيل الدخول كـ Owner (اختياري)

```http
POST /api/auth/login-as-owner
Content-Type: application/json
```

**Body:** `email`, `password` (يُقارَنان مع `OWNER_EMAIL` و `OWNER_PASSWORD` في السيرفر)

**Response 200:** `{ "token": "..." }` (بدون كائن `user`)

---

### 2.3 المستخدم الحالي (تحتاج توكن)

```http
GET /api/auth/me
Authorization: Bearer <token>
```

**Response 200:** كائن المستخدم (مثل الحقول في `login` بدون `password`).

---

### 2.4 تسجيل الخروج

```http
POST /api/auth/logout
```

**Response 200:** `{ "message": "Logged out successfully" }` (السيرفر لا يلغي التوكن؛ الفرونت يزيله من التخزين).

---

## 3. العملاء (Clients)

**Base:** `GET/POST /api/clients` و `GET/PUT/DELETE /api/clients/:id`  
**كل الطلبات تحتاج:** `Authorization: Bearer <token>`

### 3.1 قائمة العملاء (مع صفحة)

```http
GET /api/clients?page=1&limit=20&q=بحث
```

| Query | النوع | الوصف |
|-------|--------|--------|
| `page` | number | رقم الصفحة (افتراضي 1) |
| `limit` | number | عدد النتائج (1–100، افتراضي 20) |
| `q` | string | بحث في الاسم والـ email |

**Response 200:**

```json
{
  "clients": [
    {
      "id": "uuid",
      "created_at": "ISO8601",
      "name": "string",
      "email": "string | null",
      "phone": "string | null",
      "address": "string | null",
      "notes": "string | null",
      "feedback": "string | null",
      "company_id": "uuid",
      "created_by": "uuid"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 42 }
}
```

---

### 3.2 قائمة مختصرة (للـ dropdown)

```http
GET /api/clients/shortList
```

**Response 200:** `{ "clients": [ { "id": "uuid", "name": "string" } ] }`

---

### 3.3 عميل واحد

```http
GET /api/clients/:id
```

**Response 200:** كائن العميل كامل. **404** إن لم يُوجَد.

---

### 3.4 إنشاء عميل

```http
POST /api/clients
Content-Type: application/json
Authorization: Bearer <token>
```

**Body (مطلوب: name فقط، الباقي اختياري):**

```json
{
  "name": "اسم العميل",
  "email": "email@example.com",
  "phone": "رقم الهاتف",
  "address": "العنوان",
  "notes": "ملاحظات",
  "feedback": "تقييم/ملاحظة"
}
```

- **201** — يُرجَع العميل المُنشأ (بدون كل الحقول إن كان الـ select محدوداً؛ الحقول الأساسية: id, created_at, name, email, phone, address, notes, feedback, company_id, created_by).
- **400** — `Client name is required`
- **409** — `Client email already exists`

---

### 3.5 تحديث عميل

```http
PUT /api/clients/:id
Content-Type: application/json
```

**Body:** أي مجموعة من: `name`, `email`, `phone`, `address`, `notes`, `feedback` (كلها اختيارية لكن يفضّل إرسال الحقول المراد تحديثها فقط).

**200** — العميل المحدَّث. **404** — غير موجود.

---

### 3.6 حذف عميل

```http
DELETE /api/clients/:id
```

**Response:** **204** بدون body أو **404**.

---

## 4. المشاريع (Projects)

**Base:** `GET/POST /api/projects` و `GET/PUT/DELETE /api/projects/:id`  
**كل الطلبات تحتاج توكن.**

### 4.1 قائمة المشاريع

```http
GET /api/projects?page=1&limit=20&client_id=uuid&status=active&q=بحث
```

| Query | النوع | الوصف |
|-------|--------|--------|
| `page` | number | رقم الصفحة |
| `limit` | number | 1–100 |
| `client_id` | uuid | فلترة حسب العميل |
| `status` | string | أحد: `draft`, `active`, `on_hold`, `done`, `cancelled` |
| `q` | string | بحث في title و details |

**Response 200:**

```json
{
  "projects": [
    {
      "id": "uuid",
      "created_at": "ISO8601",
      "company_id": "uuid",
      "client_id": "uuid",
      "title": "string",
      "details": "string | null",
      "start_date": "YYYY-MM-DD | null",
      "due_date": "YYYY-MM-DD | null",
      "price": number | null,
      "status": "draft | active | on_hold | cancelled | completed",
      "created_by": "uuid"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 15 }
}
```

**قيم status في النظام:** `draft` | `active` | `on_hold` | `cancelled` | `completed`  
(في الفلتر يُقبَل أيضاً `done` كمرادف في بعض الـ endpoints.)

---

### 4.2 قائمة مختصرة للمشاريع

```http
GET /api/projects/shortList
```

**Response 200:** `{ "projects": [ { "id": "uuid", "title": "string" } ] }`

---

### 4.3 مشروع واحد

```http
GET /api/projects/:id
```

**Response 200:** كائن المشروع كامل. **404** إن لم يُوجَد.

---

### 4.4 إنشاء مشروع

```http
POST /api/projects
Content-Type: application/json
```

**Body (مطلوب: client_id, title):**

```json
{
  "client_id": "uuid",
  "title": "عنوان المشروع",
  "details": "تفاصيل",
  "start_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "price": 10000.50,
  "status": "active"
}
```

- `status` اختياري، افتراضي `active`. القيم: `draft`, `active`, `on_hold`, `cancelled`, `completed`.
- **201** — المشروع المُنشأ.
- **400** — `client_id and title are required` أو `Invalid client_id for this company` أو `due_date must be after start_date` أو `Invalid status`.

---

### 4.5 تحديث مشروع

```http
PUT /api/projects/:id
Content-Type: application/json
```

**Body:** أي مجموعة من: `client_id`, `title`, `details`, `start_date`, `due_date`, `price`, `status`.  
**200** — المشروع المحدَّث. **404** — غير موجود.

---

### 4.6 حذف مشروع

```http
DELETE /api/projects/:id
```

**Response:** **204** أو **404**.

---

### 4.7 مدفوعات مشروع معين

```http
GET /api/projects/:id/payments
```

**Response 200:** `{ "payments": [ ... ] }` — قائمة مدفوعات المشروع (بدون pagination).

---

## 5. المدفوعات (Payments)

**Base:** `GET/POST /api/payments` و `GET/PUT/DELETE /api/payments/:id`  
**كل الطلبات تحتاج توكن.**

### 5.1 قائمة المدفوعات

```http
GET /api/payments?page=1&limit=20&project_id=uuid&client_id=uuid
```

| Query | الوصف |
|-------|--------|
| `page`, `limit` | ترقيم الصفحات (افتراضي 1, 20) |
| `project_id` | فلترة حسب المشروع |
| `client_id` | فلترة حسب العميل (مدفوعات مشاريع هذا العميل فقط) |

**Response 200:**

```json
{
  "payments": [
    {
      "id": "uuid",
      "company_id": "uuid",
      "project_id": "uuid",
      "amount": number,
      "payment_date": "YYYY-MM-DD",
      "payment_method": "cash | bank_transfer | credit_card | other",
      "notes": "string | null",
      "created_at": "ISO8601"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 50 }
}
```

**payment_method:** يجب أن يكون أحد: `cash` | `bank_transfer` | `credit_card` | `other`

---

### 5.2 مدفوعات مشروع (مختصر)

يُستخدم أيضاً: `GET /api/projects/:id/payments` (انظر 4.7).

---

### 5.3 دفعة واحدة

```http
GET /api/payments/:id
```

**Response 200:** كائن الدفعة. **404** إن لم تُوجَد.

---

### 5.4 إنشاء دفعة

```http
POST /api/payments
Content-Type: application/json
```

**Body (مطلوب: project_id, amount, payment_method):**

```json
{
  "project_id": "uuid",
  "amount": 5000,
  "payment_date": "YYYY-MM-DD",
  "payment_method": "cash",
  "notes": "ملاحظة"
}
```

- `payment_date` اختياري؛ إن لم يُرسَل يُستخدم تاريخ اليوم (YYYY-MM-DD).
- **201** — الدفعة المُنشأة.
- **400** — `project_id is required` أو `amount must be a positive number` أو `payment_method is required` أو `Invalid payment_method` أو `Total payments would exceed project price. Remaining: X`

---

### 5.5 تحديث دفعة

```http
PUT /api/payments/:id
Content-Type: application/json
```

**Body:** أي من: `project_id`, `amount`, `payment_date`, `payment_method`, `notes`.  
**200** — الدفعة المحدَّثة. **404** — غير موجودة. قد يُرجَع **400** إذا تجاوزت المدفوعات سعر المشروع.

---

### 5.6 حذف دفعة

```http
DELETE /api/payments/:id
```

**Response:** **204** أو **404**.

---

## 6. المصروفات (Expenses)

**Base:** `GET/POST /api/expenses` و `GET/PUT/DELETE /api/expenses/:id`  
**كل الطلبات تحتاج توكن.**

### 6.1 قائمة المصروفات

```http
GET /api/expenses?page=1&limit=20&type=direct|operational&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&q=بحث
```

| Query | الوصف |
|-------|--------|
| `page`, `limit` | ترقيم الصفحات |
| `type` | `direct` أو `operational` |
| `from_date`, `to_date` | نطاق تاريخ المصروف (expense_date) |
| `q` | بحث في title و description |

**Response 200:**

```json
{
  "expenses": [
    {
      "id": "uuid",
      "company_id": "uuid",
      "amount": number,
      "expense_date": "YYYY-MM-DD",
      "title": "string",
      "description": "string | null",
      "type": "direct | operational",
      "created_at": "ISO8601"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 30 }
}
```

**type:** `direct` | `operational` فقط.

---

### 6.2 مصروف واحد

```http
GET /api/expenses/:id
```

**Response 200:** كائن المصروف. **404** إن لم يُوجَد.

---

### 6.3 إنشاء مصروف

```http
POST /api/expenses
Content-Type: application/json
```

**Body (مطلوب: amount, type, title):**

```json
{
  "amount": 1000,
  "expense_date": "YYYY-MM-DD",
  "title": "عنوان المصروف",
  "description": "وصف",
  "type": "direct"
}
```

- `expense_date` اختياري؛ افتراضي اليوم.
- **201** — المصروف المُنشأ.
- **400** — `amount must be a positive number` أو `type is required` أو `title is required` أو `Invalid type (direct | operational)`.

---

### 6.4 تحديث مصروف

```http
PUT /api/expenses/:id
Content-Type: application/json
```

**Body:** أي من: `amount`, `expense_date`, `title`, `description`, `type`.  
**200** — المصروف المحدَّث. **404** — غير موجود.

---

### 6.5 حذف مصروف

```http
DELETE /api/expenses/:id
```

**Response:** **204** أو **404**.

---

## 7. المرفقات (Attachments)

**Base:** `GET/POST /api/attachments` و `GET/PUT/DELETE /api/attachments/:id`  
**تحتاج توكن.** المرفقات تُربط بـ `company_id` واختيارياً `entity_type` و `entity_id` (مثلاً مشروع أو عميل).

### 7.1 قائمة المرفقات

```http
GET /api/attachments?company_id=uuid&entity_type=project&entity_id=uuid
```

| Query | الوصف |
|-------|--------|
| `company_id` | فلترة حسب الشركة (يُفضّل إرسالها من المستخدم الحالي) |
| `entity_type` | نوع الكيان (مثلاً project, client) |
| `entity_id` | معرف الكيان |

**Response 200:** مصفوفة مرفقات، كل عنصر مثل:

```json
{
  "id": "uuid",
  "company_id": "uuid",
  "entity_type": "string",
  "entity_id": "string",
  "file_name": "string",
  "file_url": "string",
  "created_at": "ISO8601"
}
```

---

### 7.2 مرفق واحد

```http
GET /api/attachments/:id
```

**Response 200:** كائن المرفق. **404** إن لم يُوجَد.

---

### 7.3 إنشاء مرفق

```http
POST /api/attachments
Content-Type: application/json
```

**Body:** يُفضّل إرسال كل الحقول من الفرونت (بعد رفع الملف لـ storage واستلام `file_url`):

```json
{
  "company_id": "uuid",
  "entity_type": "project",
  "entity_id": "uuid",
  "file_name": "اسم الملف.pdf",
  "file_url": "https://..."
}
```

**201** — المرفق المُنشأ.

---

### 7.4 تحديث مرفق

```http
PUT /api/attachments/:id
Content-Type: application/json
```

**Body:** أي مجموعة من: `company_id`, `entity_type`, `entity_id`, `file_name`, `file_url`.  
**200** — المرفق المحدَّث. **404** — غير موجود.

---

### 7.5 حذف مرفق

```http
DELETE /api/attachments/:id
```

**Response:** **204** بدون body أو **404**.

---

## 8. الإحصائيات والمالية (Statistics)

**Base:** `GET /api/statistics` ومسارات فرعية.  
**كل الطلبات تحتاج توكن.**  
اختياري: `from_date`, `to_date` (YYYY-MM-DD) لتصفية المدفوعات والمصروفات حسب التاريخ.

### 8.1 لوحة الإحصائيات (Dashboard)

```http
GET /api/statistics?from_date=2025-01-01&to_date=2025-12-31
```

**Response 200:**

```json
{
  "overview": {
    "totalClients": 10,
    "totalProjects": 25,
    "totalProjectValue": 150000,
    "totalPaymentsReceived": 80000,
    "totalPaymentsCount": 45,
    "totalExpenses": 20000,
    "totalExpensesCount": 30,
    "dateRange": { "from_date": "2025-01-01", "to_date": "2025-12-31" }
  },
  "projectsByStatus": {
    "draft": 2,
    "active": 10,
    "on_hold": 3,
    "cancelled": 1,
    "completed": 9
  },
  "paymentsSummary": { "total": 80000, "count": 45 },
  "expensesSummary": {
    "total": 20000,
    "count": 30,
    "byType": { "direct": 12000, "operational": 8000 }
  },
  "financial": {
    "totalRevenue": 80000,
    "directExpenses": 12000,
    "operationalExpenses": 8000,
    "totalExpenses": 20000,
    "grossProfit": 68000,
    "grossMargin": { "amount": 68000, "percent": 85 },
    "operatingIncome": 60000,
    "operatingMargin": { "amount": 60000, "percent": 75 },
    "netProfit": 60000,
    "profitMargin": { "amount": 60000, "percent": 75 }
  }
}
```

بدون `from_date`/`to_date` يكون `dateRange: null` وتكون الأرقام لكل الفترات.

---

### 8.2 الملخص المالي فقط

```http
GET /api/statistics/financial?from_date=2025-01-01&to_date=2025-12-31
```

**Response 200:** نفس كائن `financial` أعلاه مع إضافة `dateRange` إن وُجد.

---

### 8.3 نظرة عامة (أعداد فقط)

```http
GET /api/statistics/overview
```

**Response 200:**

```json
{
  "totalClients": 10,
  "totalProjects": 25,
  "totalPaymentsCount": 45,
  "totalExpensesCount": 30
}
```

---

### 8.4 إحصائيات المشاريع

```http
GET /api/statistics/projects
```

**Response 200:**

```json
{
  "byStatus": { "draft": 2, "active": 10, "on_hold": 3, "cancelled": 1, "completed": 9 },
  "totalCount": 25,
  "totalValue": 150000
}
```

---

### 8.5 إحصائيات المدفوعات

```http
GET /api/statistics/payments?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
```

**Response 200:** `{ "total": number, "count": number, "dateRange": { "from_date", "to_date" } | null }`

---

### 8.6 إحصائيات المصروفات

```http
GET /api/statistics/expenses?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
```

**Response 200:**

```json
{
  "total": number,
  "count": number,
  "byType": { "direct": number, "operational": number },
  "dateRange": { "from_date", "to_date" } | null
}
```

---

## 9. الشركات (Companies) — إن وُجدت في السيناريو

**Base:** `GET/POST /api/companies` و `GET/PUT/DELETE /api/companies/:id`  
**ملاحظة:** مسارات الشركات قد لا تكون محمية بنفس الـ auth؛ تحقق من السيرفر.  
تتضمن أيضاً: إنشاء/تحديث/حذف مستخدمين و إدارة كلمة المرور والحالة:

- `GET /api/companies` — قائمة شركات  
- `GET /api/companies/:id` — شركة واحدة  
- `POST /api/companies` — إنشاء شركة  
- `PUT /api/companies/:id` — تحديث شركة  
- `DELETE /api/companies/:id` — حذف شركة  
- `GET /api/companies/:id/users` — قائمة مستخدمي الشركة  
- `GET /api/companies/:id/users/:userId` — مستخدم واحد  
- `POST /api/companies/:id/users` — إنشاء مستخدم  
- `PUT /api/companies/:id/users/:userId` — تحديث مستخدم  
- `DELETE /api/companies/:id/users/:userId` — حذف مستخدم  
- `PATCH /api/companies/:id/users/:userId/status` — تحديث حالة المستخدم  
- `PATCH /api/companies/:id/users/:userId/password` — تحديث كلمة المرور  

(تفاصيل الـ body والـ response تحتاج مراجعة الـ controllers إن احتجتمها.)

---

## 10. تنسيق الأخطاء

معظم الـ endpoints تُرجع الأخطاء بالشكل:

```json
{ "error": "رسالة الخطأ بالإنجليزي" }
```

أمثلة رسائل:

- `Not authenticated` — 401  
- `Authorization token required` — 401  
- `Invalid or expired token` — 401  
- `Not found` — 404  
- `Client name is required`, `Invalid status`, إلخ — 400  
- `Client email already exists` — 409  
- `Database not configured` — 503  

---

## 11. ملخص سريع للمسارات (بدون Companies)

| المسار | الوصف |
|--------|--------|
| `GET /health` | صحة السيرفر (بدون توكن) |
| `POST /api/auth/login` | تسجيل دخول → `user` + `token` |
| `POST /api/auth/login-as-owner` | دخول owner → `token` |
| `GET /api/auth/me` | المستخدم الحالي (يتطلب توكن) |
| `POST /api/auth/logout` | تسجيل خروج (رمزي) |
| `GET|POST /api/clients` | قائمة/إنشاء عملاء |
| `GET /api/clients/shortList` | عملاء للقوائم المنسدلة |
| `GET|PUT|DELETE /api/clients/:id` | عميل واحد |
| `GET|POST /api/projects` | قائمة/إنشاء مشاريع |
| `GET /api/projects/shortList` | مشاريع للقوائم المنسدلة |
| `GET|PUT|DELETE /api/projects/:id` | مشروع واحد |
| `GET /api/projects/:id/payments` | مدفوعات المشروع |
| `GET|POST /api/payments` | قائمة/إنشاء مدفوعات |
| `GET|PUT|DELETE /api/payments/:id` | دفعة واحدة |
| `GET|POST /api/expenses` | قائمة/إنشاء مصروفات |
| `GET|PUT|DELETE /api/expenses/:id` | مصروف واحد |
| `GET|POST /api/attachments` | قائمة/إنشاء مرفقات |
| `GET|PUT|DELETE /api/attachments/:id` | مرفق واحد |
| `GET /api/statistics` | لوحة إحصائيات + مالية |
| `GET /api/statistics/financial` | مالية فقط |
| `GET /api/statistics/overview` | أعداد عامة |
| `GET /api/statistics/projects` | إحصائيات مشاريع |
| `GET /api/statistics/payments` | إحصائيات مدفوعات |
| `GET /api/statistics/expenses` | إحصائيات مصروفات |

---

## 12. خطوات البدء السريع للفرونت إند

1. **البيئة:** ضبط `VITE_API_URL` أو ما شابه على `http://localhost:3001` (أو البورت الفعلي).  
2. **التوكن:** بعد `POST /api/auth/login` حفظ `token` في `localStorage` أو حالة التطبيق، وإرساله في كل طلب:  
   `headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }`  
3. **الصفحة الرئيسية / الداشبورد:** استدعاء `GET /api/statistics` لعرض الملخص والمالية.  
4. **العملاء:** استخدام `GET /api/clients` و `shortList` للقوائم، و CRUD للتفاصيل.  
5. **المشاريع:** نفس الأسلوب مع `GET /api/projects` و `shortList` وفلترة `client_id` و `status`.  
6. **المدفوعات:** قائمة عامة من `/api/payments`، ومدفوعات مشروع من `/api/projects/:id/payments`.  
7. **المصروفات:** قائمة وفلترة من `/api/expenses`، ونوع `direct`/`operational` للعرض والمالية.  
8. **المرفقات:** رفع الملف إلى Storage (خارج هذا الـ API)، ثم إنشاء سجل عبر `POST /api/attachments` مع `company_id` من المستخدم الحالي و `entity_type` و `entity_id` و `file_url`.  
9. **التواريخ:** استخدام `YYYY-MM-DD` في كل من الـ API (تواريخ المشاريع، المدفوعات، المصروفات، و query الإحصائيات).

بهذا التقرير يمكن للفرونت إند البدء بالتكامل مع الـ Backend فوراً. لأي تفاصيل إضافية (مثل شكل استجابات Companies/Users) يمكن الرجوع إلى مجلد `api/controllers` و `api/routes` في المشروع.
