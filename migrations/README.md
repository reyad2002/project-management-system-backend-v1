# Phase 1 Migrations

**Status: already applied.** The connected Supabase database already has `vendors`,
`vendor_bills`, `vendor_payments`, `invoices`, plus the new `expenses`/`payments` columns
(`project_id`, `phase_id`, `vendor_id`, `cost_category` on expenses; `invoice_id`, `type` on
payments) and the `v_ar_aging`/`v_ap_aging` reporting views — verified directly against the live
DB while implementing the backend below. **You do not need to run anything in this folder.**

The `.sql` files here are kept as a **reference copy of the original design** in
`PMS-PHASE1-DATABASE-SUPABASE.md`, written with `uuid` primary/foreign keys. The database that is
actually live uses `bigint` ids throughout (matching the pre-existing `company`/`users`/`clients`/
`projects` tables), so **do not run these files as-is** — they'd conflict with the tables that
already exist and use the wrong key type besides. If you ever need to re-derive the schema (e.g.
for a second environment), adapt the id types to `bigint`/`bigserial` first and drop the
`gen_random_uuid()` defaults.

Confirmed by querying the live schema (2026-09-13):

```
vendors, vendor_bills, vendor_payments, invoices  -> exist, bigint ids
expenses.project_id/phase_id/vendor_id/cost_category -> exist
payments.invoice_id/type                              -> exist
v_ar_aging, v_ap_aging                                -> exist
```

The application code does **not** rely on the DB-trigger auto-calculation described in section 6
of `PMS-PHASE1-DATABASE-SUPABASE.md` (`invoices_before_write`, `payments_after_change`, etc.) —
`api/lib/finance.js` performs the same subtotal → vat → wht → total → status logic explicitly in
the backend (tax computation, invoice-number generation, and post-payment recalculation), so the
implementation works correctly whether or not those specific triggers were also deployed.
