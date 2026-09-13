import { supabaseAdmin } from "../../db_connection.js";

export const costCategories = [
  "labor",
  "materials",
  "subcontractor",
  "software",
  "travel",
  "marketing",
  "rent",
  "utilities",
  "other",
];

export const invoiceStatuses = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];

export const vendorBillStatuses = [
  "pending",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];

export const paymentMethods = ["cash", "bank_transfer", "credit_card", "other"];

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * subtotal -> vat -> wht -> total -> remaining, matching the DB trigger formula exactly.
 */
export function computeTaxAmounts(subtotal, vatRate, whtRate, paidAmount = 0) {
  const sub = Number(subtotal) || 0;
  const vat = Number(vatRate) || 0;
  const wht = Number(whtRate) || 0;
  const paid = Number(paidAmount) || 0;

  const vat_amount = round2((sub * vat) / 100);
  const wht_amount = round2((sub * wht) / 100);
  const total_amount = round2(sub + vat_amount - wht_amount);
  const remaining_amount = round2(total_amount - paid);

  return { vat_amount, wht_amount, total_amount, remaining_amount };
}

/**
 * Generate the next sequential invoice number for a company: INV-YYYY-0001
 */
export async function generateInvoiceNumber(companyId) {
  const year = new Date().getFullYear().toString();
  const { count, error } = await supabaseAdmin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .like("invoice_number", `INV-${year}-%`);
  if (error) throw error;
  const next = (count ?? 0) + 1;
  return `INV-${year}-${String(next).padStart(4, "0")}`;
}

/**
 * Recompute paid_amount/remaining_amount/status on an invoice from its payments.
 * Mirrors the recalc_invoice_totals() DB trigger. No-op if the invoice is cancelled.
 * Returns the updated invoice row, or null if the invoice no longer exists / is cancelled.
 */
export async function recalcInvoiceTotals(invoiceId) {
  const { data: invoice, error: invErr } = await supabaseAdmin
    .from("invoices")
    .select("id, total_amount, due_date, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) throw invErr;
  if (!invoice || invoice.status === "cancelled") return null;

  const { data: payments, error: payErr } = await supabaseAdmin
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoiceId);
  if (payErr) throw payErr;

  const paid = round2((payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0));
  const total = Number(invoice.total_amount);
  const remaining = round2(total - paid);
  const today = new Date().toISOString().slice(0, 10);

  let status;
  if (remaining <= 0) status = "paid";
  else if (paid > 0) status = "partially_paid";
  else if (invoice.due_date && invoice.due_date < today) status = "overdue";
  else if (invoice.status === "draft") status = "draft";
  else status = "sent";

  const { data, error } = await supabaseAdmin
    .from("invoices")
    .update({
      paid_amount: paid,
      remaining_amount: remaining,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .neq("status", "cancelled")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Same as recalcInvoiceTotals but for vendor_bills / vendor_payments.
 */
export async function recalcVendorBillTotals(billId) {
  const { data: bill, error: billErr } = await supabaseAdmin
    .from("vendor_bills")
    .select("id, total_amount, due_date, status")
    .eq("id", billId)
    .maybeSingle();
  if (billErr) throw billErr;
  if (!bill || bill.status === "cancelled") return null;

  const { data: payments, error: payErr } = await supabaseAdmin
    .from("vendor_payments")
    .select("amount")
    .eq("vendor_bill_id", billId);
  if (payErr) throw payErr;

  const paid = round2((payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0));
  const total = Number(bill.total_amount);
  const remaining = round2(total - paid);
  const today = new Date().toISOString().slice(0, 10);

  let status;
  if (remaining <= 0) status = "paid";
  else if (paid > 0) status = "partially_paid";
  else if (bill.due_date && bill.due_date < today) status = "overdue";
  else status = "pending";

  const { data, error } = await supabaseAdmin
    .from("vendor_bills")
    .update({
      paid_amount: paid,
      remaining_amount: remaining,
      status,
    })
    .eq("id", billId)
    .neq("status", "cancelled")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}
