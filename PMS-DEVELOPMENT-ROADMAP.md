# تقرير تطوير نظام إدارة المشاريع (PMS) — من نظام بسيط إلى نظام عالمي المستوى

هذا التقرير تحليل شامل لحالة النظام الحالية، والفجوات مقارنة بأنظمة إدارة المشاريع العالمية (Asana, ClickUp, Monday, Jira, Zoho Projects, Odoo)، مع تركيز خاص على تطوير الجزء المحاسبي بمنطق محاسبي احترافي حقيقي. الهدف منه أن يكون مرجع عمل (backlog) يُبنى عليه التخطيط والتنفيذ بالتدريج.

---

## 1. تحليل الوضع الحالي (Current State)

بناءً على مراجعة الكود الفعلي (`lib/api.ts`, `app/dashboard/*`, `hooks/*`):

### الكيانات (Entities) الموجودة حاليًا
- **Client**: name, email, phone, address, notes, feedback.
- **Project**: title, details, start_date, due_date, **price واحد ثابت للمشروع كله**, status (draft/active/on_hold/cancelled/completed).
- **Phase**: مرحلة داخل المشروع لها amount + start/end date (تقسيم للسعر، مش تتبع تنفيذي حقيقي).
- **Payment**: دفعة من عميل على مشروع (amount, payment_date, payment_method: cash/bank_transfer/credit_card/other).
- **Expense**: مصروف على مستوى الشركة (amount, type: direct/operational) — **غير مربوط بمشروع معيّن**.
- **Statistics**: Dashboard stats + Financial stats (Revenue, Direct/Operational Expenses, Gross/Operating/Net Profit + Margins).

### طبيعة النظام الحالي
النظام حاليًا عبارة عن **دفتر قيد نقدي مبسّط (simplified cash ledger)**:
> Payments (تدفق داخل) − Expenses (تدفق خارج) = Profit

وهذا منطق تشغيلي بسيط، وليس نظامًا محاسبيًا بالمعنى الاحترافي (لا يوجد قيد مزدوج، لا يوجد فصل بين "المستحق" و"المُحصَّل"، لا يوجد ربط تكلفة بمشروع).

### أهم 3 قيود بنيوية حالية يجب الانتباه لها من البداية
1. **`Expense` بدون `project_id`** — هذا يمنع حساب ربحية أي مشروع بمفرده (Job Costing) وهي وظيفة أساسية لأي شركة تعمل بنظام مشاريع.
2. **لا يوجد كيان `Invoice` منفصل عن `Payment`** — الفاتورة (المستحق) شيء، والتحصيل (المدفوع فعلًا) شيء آخر؛ خلطهما يمنع حساب "أعمار الديون" (Aging) بدقة.
3. **الإيراد يُحسب Cash Basis** (وقت استلام الفلوس) وليس على أساس **نسبة الإنجاز** (Percentage of Completion) وهو الأنسب لأعمال المشاريع.

---

## 2. الفجوات كنظام إدارة مشاريع (Project Management Gaps)

مقارنة بمعايير الأنظمة العالمية:

| # | الميزة الناقصة | الوصف | الأولوية المقترحة |
|---|---|---|---|
| 1 | **Task Management حقيقي** | لا يوجد Tasks/Subtasks بحالة (To Do/In Progress/Done)، Assignee، Priority، Due Date، Checklist. الموجود حاليًا (Phase) هو تقسيم مالي وليس تتبع تنفيذي | عالية |
| 2 | **Timeline / Gantt View** | متابعة تداخل المراحل/المهام والتأخيرات بصريًا | متوسطة |
| 3 | **Team & Resource Management** | لا يوجد موظفين/أعضاء فريق مرتبطين بالمشروع، ولا توزيع حمل عمل (Workload) | عالية |
| 4 | **Roles & Permissions (RBAC)** | كل شيء مرتبط بـ `company_id` بدون صلاحيات متدرجة (Admin/Manager/Accountant/Member) | عالية |
| 5 | **Time Tracking / Timesheets** | لا يوجد تسجيل ساعات عمل الموظفين على المشاريع — أساسي لاحقًا لحساب التكلفة الحقيقية للمشروع | متوسطة |
| 6 | **Client Portal** | العميل لا يرى حالة مشروعه أو فواتيره أو المدفوعات المطلوبة منه بنفسه | متوسطة |
| 7 | **Files / Documents Management** | لا يوجد مرفقات (عقود، تصاميم، ملفات تسليم) مرتبطة بالمشروع | متوسطة |
| 8 | **Comments / Activity Feed** | لا يوجد تعاون أو سجل أحداث على مستوى المشروع/المهمة | منخفضة |
| 9 | **Notifications** | لا يوجد تنبيهات (بريد/داخل النظام) لمواعيد استحقاق أو دفعات متأخرة | متوسطة |
| 10 | **Risk & Issue Tracking** | لا يوجد تسجيل للمخاطر/العوائق في المشروع | منخفضة |
| 11 | **Contracts / SOW Management** | لا يوجد ربط للعقود ونطاق العمل بالمشروع | منخفضة |
| 12 | **Recurring Projects / Templates** | لا يوجد قوالب مشاريع متكررة (مفيدة لشركات الخدمات) | منخفضة |
| 13 | **تقارير متقدمة** | ربحية لكل عميل/مشروع، Aging Reports، توقعات (Forecasting) | عالية (مرتبطة بالمحاسبة) |
| 14 | **Automation** | مثلاً: تغيير حالة المرحلة تلقائيًا عند اكتمال الدفع | منخفضة |
| 15 | **Multi-language / RTL polish** | دعم كامل ثنائي اللغة لو فيه عملاء أجانب | منخفضة |

---

## 3. تطوير الجزء المحاسبي (الأهم) — بمنطق محاسبي احترافي

هذا الجزء مبني على أساسيات المحاسبة المالية ومحاسبة التكاليف لشركات المشاريع (Project-Based Accounting)، مع مراعاة أن الشركة مصرية (تطبيق شرط الفوترة الإلكترونية والضرائب المصرية).

### 3.1 المشكلة الجوهرية: لا يوجد فصل بين "المستحق" و"المُحصَّل"

**الوضع الحالي:** Payment = الحدث المالي الوحيد.

**الوضع الصحيح محاسبيًا:**
```
Invoice (فاتورة/مستحق) ──generates──> Accounts Receivable (AR)
                                              │
                                    Payment (تحصيل فعلي) ──reduces──> AR
```

- **Invoice**: مستند رسمي يمثل "حق الشركة في التحصيل" وقت إصداره (وقت اكتمال مرحلة مثلاً)، بصرف النظر عن وقت الدفع.
- **Payment**: تخصيص فعلي لمبلغ محصَّل مقابل فاتورة (أو أكثر) أو كدفعة مقدمة.
- **الفرق العملي**: يمكّنك من عمل تقرير "أعمار ديون العملاء" (AR Aging: 0-30 / 31-60 / 61-90 / +90 يوم) وهو من أهم تقارير أي إدارة مالية.

**الحقول المطلوبة لـ Invoice:**
```
id, company_id, client_id, project_id, phase_id (nullable),
invoice_number (تسلسلي رسمي), issue_date, due_date,
subtotal, vat_amount, vat_rate, wht_amount, wht_rate,
total_amount, status (draft/sent/partially_paid/paid/overdue/cancelled),
eta_uuid (مرجع الفاتورة الإلكترونية), eta_submission_status,
notes
```

### 3.2 الضرائب المصرية (غير موجودة إطلاقًا حاليًا)

| الضريبة | التفاصيل | التطبيق المطلوب |
|---|---|---|
| **ضريبة القيمة المضافة (VAT)** | 14% على معظم الخدمات في مصر | حقل `vat_rate` + `vat_amount` على كل Invoice، وإمكانية استثناء بعض الخدمات المعفاة |
| **ضريبة الخصم والإضافة (Withholding Tax - WHT)** | تُخصم عادة من المدفوعات للموردين/المقاولين (نسب تتراوح 0.5%–5% حسب نوع الخدمة) | حقل `wht_rate` + `wht_amount` على Vendor Bills، وتقرير تجميعي شهري/ربع سنوي لتوريدها لمصلحة الضرائب |
| **الفوترة الإلكترونية (e-Invoice)** | إلزامية لمصلحة الضرائب المصرية (ETA) لأي B2B/B2G منذ 2020، وامتدت لتشمل B2C (e-Receipt) | كل Invoice يُصدر لازم يتبعت لمنظومة ETA عبر API والحصول على UUID، ويُطبع عليه QR Code |

> **ملاحظة مهمة**: بند الفوترة الإلكترونية لازم يتحسب من الأول في تصميم الـ data model حتى لو التكامل الفعلي مع ETA API هيتأجل لمرحلة لاحقة — إضافته بأثر رجعي مكلفة جدًا.

### 3.3 الإيراد: من Cash Basis إلى Percentage of Completion

**المشكلة الحالية:** `totalRevenue` = مجموع الـ Payments المستلمة فعليًا في الفترة. هذا مقياس تدفق نقدي (Cash Flow) وليس مقياس أداء مالي حقيقي (Revenue).

**الطريقة المحاسبية الصحيحة لشركات المشاريع (مطابقة لـ IFRS 15 / ASC 606):**
- الإيراد يُعترف به تدريجيًا مع **إنجاز كل Phase** (أو نسبة الإنجاز الفعلية)، بصرف النظر عن توقيت التحصيل.
- عند اكتمال Phase → يتم إصدار Invoice بقيمتها → هذا هو "الإيراد المُعترف به" (Recognized Revenue).
- الدفعة المقدمة (قبل إنجاز أي Phase) تُسجَّل كـ **Unearned Revenue / Deferred Revenue** (التزام على الشركة، وليس إيراد) لحين إنجاز العمل المقابل لها.

**التأثير العملي:**
```
Old model:  Revenue = SUM(Payments)                     ← تدفق نقدي فقط
New model:  Revenue = SUM(Invoices issued/completed)     ← أداء مالي حقيقي
            Unearned Revenue = SUM(Payments) − SUM(Invoices matched)
            Accounts Receivable = SUM(Invoices) − SUM(Payments matched)
```

### 3.4 محاسبة التكاليف على مستوى المشروع (Job Costing)

**المشكلة الحالية:** `Expense` بدون `project_id` → مستحيل معرفة ربحية مشروع منفرد.

**التعديل المطلوب:**
```
Expense {
  ...existing fields,
  project_id: string | null,   // null = مصروف تشغيلي عام على مستوى الشركة
  phase_id: string | null,     // اختياري لتفصيل أدق
  cost_category: enum          // labor / materials / subcontractor / software / travel / other
}
```

هذا يفتح الباب لـ:
- **Gross Margin لكل مشروع** = إيرادات المشروع − التكاليف المباشرة المرتبطة بيه.
- **Budget vs Actual**: إضافة `budgeted_cost` على مستوى المشروع/المرحلة، ومقارنته بالمصروفات الفعلية أول بأول (تنبيه عند تجاوز الميزانية).
- **تقرير ربحية العملاء** (Client Profitability Report) — عميل معين ممكن يكون عنده أكتر من مشروع، والتقرير يجمعهم.

### 3.5 حسابات الموردين (Accounts Payable) — غير موجودة إطلاقًا

حاليًا كل مصروف = `Expense` مدفوع فورًا بلا فرق بين "التزام مستحق للمورد" و"دفع فعلي".

**الكيانات المطلوبة:**
```
Vendor { id, name, tax_id, contact_info, wht_category }
VendorBill { id, vendor_id, project_id, amount, due_date,
             status: pending/partially_paid/paid, wht_amount }
VendorPayment { id, vendor_bill_id, amount, payment_date, method }
```

هذا يمكّن من:
- تقرير **AP Aging** (التزامات مستحقة للموردين وموعد استحقاقها).
- التمييز بين "مصروف تشغيلي فوري" (زي فاتورة كهرباء) و"التزام تجاه مقاول من الباطن" له شروط دفع.

### 3.6 الدفعات المقدمة والـ Retainage

- **Advance/Deposit Payment**: دفعة يحصّلها العميل قبل بدء العمل → تُسجَّل كـ Unearned Revenue (التزام) حتى تُخصم تدريجيًا عند إصدار الفواتير.
- **Retainage (نسبة محتجزة)**: شائعة في مشاريع الإنشاءات/التصميم — نسبة من كل فاتورة (مثلاً 10%) تُحتجز لحين التسليم النهائي. يحتاج حقل `retainage_percent` و`retainage_released_at` على مستوى Invoice.

### 3.7 حسابات البنك والخزينة (Bank & Cash Accounts)

**المشكلة الحالية:** `payment_method` مجرد enum نصي (cash/bank_transfer/...)، بدون ربط بحساب فعلي.

**التعديل المطلوب:**
```
BankAccount { id, company_id, name, type: cash/bank/wallet, currency, opening_balance }
```
كل Payment/Expense/VendorPayment يُربط بـ `bank_account_id` بدلًا من نص حر → يفتح الباب لـ:
- رصيد فعلي لكل حساب/خزينة لحظيًا.
- **Bank Reconciliation** (تسوية بنكية) لاحقًا.
- تحويلات بين الحسابات (Cash → Bank) كحركة داخلية وليست إيراد/مصروف.

### 3.8 دليل الحسابات والقيد المزدوج (Chart of Accounts & Double-Entry)

هذه هي **البنية التحتية النهائية** لأي نظام محاسبي حقيقي، وأنصح بيها كمرحلة لاحقة (مش أولوية فورية) لكن لازم تتصمم الداتابيز من الأول بطريقة تسمح بالانتقال ليها بسهولة:

```
Account (Chart of Accounts): id, code, name, type (Asset/Liability/Equity/Revenue/Expense), parent_id
JournalEntry: id, date, description, reference_type, reference_id
JournalLine: id, journal_entry_id, account_id, debit, credit
```

كل حدث مالي (Invoice, Payment, Expense, VendorBill...) يُترجم تلقائيًا لقيد محاسبي (Journal Entry) بمنطق مدين/دائن. هذا يفتح الباب لـ:
- **Trial Balance** (ميزان المراجعة)
- **Balance Sheet** (قائمة المركز المالي)
- **Cash Flow Statement** (قائمة التدفقات النقدية) بالطريقة غير المباشرة أو المباشرة
- **Audit Trail** كامل لكل حركة مالية

> هذه الخطوة كبيرة ومكلفة تقنيًا، فالمقترح: تُبنى كـ "طبقة داخلية" تعمل في الخلفية تلقائيًا من الأحداث الموجودة (Invoice/Payment/Expense) دون تغيير واجهة المستخدم الحالية البسيطة، بحيث المستخدم العادي يفضل يشتغل بنفس السهولة لكن النظام يبقى قادر على إخراج تقارير محاسبية رسمية عند الحاجة (تسليم لمحاسب/مراجع خارجي).

### 3.9 الرواتب وتوزيع تكلفة الموظفين (Payroll & Labor Costing)

- ربط ساعات العمل (من Time Tracking، بند 2.5) بتكلفة الموظف (Salary/Hour) → توزيعها كتكلفة على المشروع المرتبط.
- هذا يجعل **Gross Margin الحقيقي** يشمل تكلفة العمالة، مش بس المصروفات المباشرة (زي شراء مواد أو دفع لمقاول خارجي).

### 3.10 الأصول الثابتة والإهلاك (Fixed Assets & Depreciation)

لو الشركة عندها أصول (أجهزة كمبيوتر، معدات تصوير، إلخ) — يُسجَّل الأصل بتكلفته وعمره الافتراضي، ويُحسب إهلاك شهري/سنوي يُقيَّد كمصروف تلقائي (مرتبط بدليل الحسابات في 3.8).

### 3.11 القوائم المالية الرسمية المطلوبة تدريجيًا

| القائمة | الحالة الحالية | المطلوب |
|---|---|---|
| **Income Statement (P&L)** | موجود مبسّط (Revenue − Expenses) | تفصيل حسب Cost Category + مقارنة فترات (Period over Period) |
| **Balance Sheet** | غير موجود | يحتاج Chart of Accounts (بند 3.8) |
| **Cash Flow Statement** | غير موجود | يحتاج تصنيف الحركات (تشغيلي/استثماري/تمويلي) |
| **Trial Balance** | غير موجود | يحتاج Double-Entry (بند 3.8) |
| **AR Aging Report** | غير موجود | يحتاج Invoice منفصل (بند 3.1) |
| **AP Aging Report** | غير موجود | يحتاج Vendor Bills (بند 3.5) |
| **Client Profitability Report** | غير موجود | يحتاج Job Costing (بند 3.4) |
| **Project Budget vs Actual** | غير موجود | يحتاج حقل budgeted_cost (بند 3.4) |

### 3.12 نقاط تحكم إدارية إضافية

- **Approval Workflow للمصروفات**: مصروف فوق مبلغ معين يحتاج موافقة مدير قبل التسجيل النهائي.
- **Credit Notes / Refunds**: التعامل مع استرجاع مبالغ للعميل أو تصحيح فاتورة بعد إصدارها (بدل تعديل/حذف السجل الأصلي مباشرة — للحفاظ على الأثر التدقيقي).
- **Multi-Currency**: لو فيه عملاء أجانب، يحتاج حقل `currency` + `exchange_rate` على كل Invoice/Payment، وحساب "فروق العملة" (FX Gain/Loss).
- **Cost Centers / Departments**: لو الشركة كبرت لأكثر من قسم (تصميم/تطوير/تسويق) — لتوزيع المصروفات التشغيلية عليهم.
- **Recurring Expenses**: اشتراكات شهرية (استضافة، أدوات SaaS) تتسجل تلقائيًا بدل الإدخال اليدوي كل مرة.

---

## 4. خارطة طريق مقترحة (Phased Roadmap)

### المرحلة 1 — أساسيات محاسبية سريعة التأثير (Quick Wins)
- [ ] إضافة `project_id` (اختياري) لـ `Expense` + `cost_category`.
- [ ] فصل `Invoice` عن `Payment` (Invoice = مستحق، Payment = تحصيل ويُخصص لفاتورة).
- [ ] إضافة حقول `vat_rate`/`vat_amount` و`wht_rate`/`wht_amount` على Invoice/VendorBill.
- [ ] `Vendor` + `VendorBill` + `VendorPayment` بسيطين (Accounts Payable أولي).
- [ ] تقرير AR Aging بسيط بناءً على Invoices غير المسددة بالكامل.

### المرحلة 2 — تكلفة ومراقبة المشاريع
- [ ] `budgeted_cost` على مستوى Project/Phase + مقارنة Actual vs Budget.
- [ ] تقرير ربحية لكل مشروع ولكل عميل (Job Costing / Client Profitability).
- [ ] Unearned Revenue للدفعات المقدمة قبل إنجاز أي Phase.
- [ ] BankAccount entity + ربط كل حركة مالية بحساب فعلي.
- [ ] Retainage على مستوى Invoice (لو مطلوب في نوع العملاء).

### المرحلة 3 — البنية التحتية المحاسبية الكاملة
- [ ] Chart of Accounts + Double-Entry Journal (طبقة خلفية تلقائية).
- [ ] Trial Balance, Balance Sheet, Cash Flow Statement.
- [ ] تكامل فعلي مع منظومة الفوترة الإلكترونية المصرية (ETA e-Invoice/e-Receipt API).
- [ ] Fixed Assets & Depreciation.
- [ ] Multi-Currency (لو مطلوب).

### المرحلة 4 — ميزات إدارة المشاريع (PM Features)
- [ ] Task Management حقيقي (Tasks/Subtasks/Assignee/Status).
- [ ] Time Tracking / Timesheets + ربطها بتكلفة العمالة (Payroll costing).
- [ ] Roles & Permissions (RBAC).
- [ ] Team & Resource Management + Workload.
- [ ] Client Portal.
- [ ] Files/Documents + Comments/Activity Feed.
- [ ] Notifications.
- [ ] Gantt/Timeline View.
- [ ] Automation Rules.

---

## 5. ملاحظة ختامية

الأولوية العملية المقترحة: **المرحلة 1 و2 أولًا** لأنهما بيحلّوا أكبر فجوة حقيقية (معرفة ربحية كل مشروع ومتابعة المستحقات بدقة) بأقل تغيير بنيوي، وبيؤسسوا Data Model سليم يسهّل الانتقال للمرحلة 3 (القيد المزدوج) لاحقًا من غير Rewrite كامل. المرحلة 4 (ميزات الـ PM) يمكن تتوازى مع المراحل المحاسبية حسب أولوية العمل واحتياج الفريق.
