import { supabaseAdmin } from "../../db_connection.js";
import {
  costCategories,
  vendorBillStatuses,
  paymentMethods,
  computeTaxAmounts,
  recalcVendorBillTotals,
} from "../lib/finance.js";

const table = "vendor_bills";
const vendorsTable = "vendors";
const projectsTable = "projects";
const paymentsTable = "vendor_payments";

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { vendor_id, project_id, status, page = "1", limit = "20" } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("bill_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (vendor_id) query = query.eq("vendor_id", vendor_id);
    if (project_id) query = query.eq("project_id", project_id);
    if (status) {
      if (!vendorBillStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      vendorBills: data || [],
      pagination: { page: pageNum, limit: limitNum, total: count ?? 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    const { data: payments, error: payErr } = await supabaseAdmin
      .from(paymentsTable)
      .select("*")
      .eq("vendor_bill_id", id)
      .order("payment_date", { ascending: false });
    if (payErr) throw payErr;

    return res.json({ ...data, payments: payments || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id || req.user?.sub;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const {
      vendor_id,
      project_id,
      bill_number,
      bill_date,
      due_date,
      subtotal,
      vat_rate,
      wht_rate,
      cost_category,
      notes,
    } = req.body;

    if (!vendor_id || !bill_date || !due_date) {
      return res.status(400).json({ error: "vendor_id, bill_date and due_date are required" });
    }

    const sub = Number(subtotal);
    if (!Number.isFinite(sub) || sub < 0) {
      return res.status(400).json({ error: "subtotal must be a non-negative number" });
    }

    if (new Date(due_date) < new Date(bill_date)) {
      return res.status(400).json({ error: "due_date must be on or after bill_date" });
    }

    if (cost_category != null && !costCategories.includes(cost_category)) {
      return res.status(400).json({ error: "Invalid cost_category" });
    }

    const { data: vendor, error: vendorErr } = await supabaseAdmin
      .from(vendorsTable)
      .select("id, default_wht_rate")
      .eq("id", vendor_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (vendorErr) throw vendorErr;
    if (!vendor) return res.status(400).json({ error: "Invalid vendor_id for this company" });

    if (project_id) {
      const { data: project, error: projectErr } = await supabaseAdmin
        .from(projectsTable)
        .select("id")
        .eq("id", project_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (projectErr) throw projectErr;
      if (!project) return res.status(400).json({ error: "Invalid project_id for this company" });
    }

    const vatRate = vat_rate != null ? Number(vat_rate) : 14.0;
    const whtRate = wht_rate != null ? Number(wht_rate) : Number(vendor.default_wht_rate ?? 0);
    if (!Number.isFinite(vatRate) || !Number.isFinite(whtRate)) {
      return res.status(400).json({ error: "vat_rate and wht_rate must be numbers" });
    }

    const amounts = computeTaxAmounts(sub, vatRate, whtRate, 0);

    const payload = {
      company_id: companyId,
      vendor_id,
      project_id: project_id ?? null,
      bill_number: bill_number ? String(bill_number).trim() : null,
      bill_date,
      due_date,
      subtotal: sub,
      vat_rate: vatRate,
      wht_rate: whtRate,
      ...amounts,
      paid_amount: 0,
      status: "pending",
      cost_category: cost_category ?? "other",
      notes: notes ? String(notes).trim() : null,
      created_by: userId,
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return res.status(404).json({ error: "Not found" });

    if (existing.status !== "pending") {
      return res
        .status(409)
        .json({ error: "Vendor bill cannot be edited once payments have started" });
    }

    const {
      vendor_id,
      project_id,
      bill_number,
      bill_date,
      due_date,
      subtotal,
      vat_rate,
      wht_rate,
      cost_category,
      notes,
    } = req.body;

    if (vendor_id !== undefined) {
      const { data: vendor, error: vendorErr } = await supabaseAdmin
        .from(vendorsTable)
        .select("id")
        .eq("id", vendor_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (vendorErr) throw vendorErr;
      if (!vendor) return res.status(400).json({ error: "Invalid vendor_id for this company" });
    }

    if (project_id !== undefined && project_id !== null) {
      const { data: project, error: projectErr } = await supabaseAdmin
        .from(projectsTable)
        .select("id")
        .eq("id", project_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (projectErr) throw projectErr;
      if (!project) return res.status(400).json({ error: "Invalid project_id for this company" });
    }

    if (cost_category !== undefined && cost_category !== null && !costCategories.includes(cost_category)) {
      return res.status(400).json({ error: "Invalid cost_category" });
    }

    const finalBillDate = bill_date !== undefined ? bill_date : existing.bill_date;
    const finalDueDate = due_date !== undefined ? due_date : existing.due_date;
    if (new Date(finalDueDate) < new Date(finalBillDate)) {
      return res.status(400).json({ error: "due_date must be on or after bill_date" });
    }

    let finalSubtotal = existing.subtotal;
    if (subtotal !== undefined) {
      const sub = Number(subtotal);
      if (!Number.isFinite(sub) || sub < 0) {
        return res.status(400).json({ error: "subtotal must be a non-negative number" });
      }
      finalSubtotal = sub;
    }

    let finalVatRate = existing.vat_rate;
    if (vat_rate !== undefined) {
      const v = Number(vat_rate);
      if (!Number.isFinite(v)) return res.status(400).json({ error: "vat_rate must be a number" });
      finalVatRate = v;
    }

    let finalWhtRate = existing.wht_rate;
    if (wht_rate !== undefined) {
      const w = Number(wht_rate);
      if (!Number.isFinite(w)) return res.status(400).json({ error: "wht_rate must be a number" });
      finalWhtRate = w;
    }

    const amounts = computeTaxAmounts(finalSubtotal, finalVatRate, finalWhtRate, existing.paid_amount);

    const payload = {
      ...(vendor_id !== undefined ? { vendor_id } : {}),
      ...(project_id !== undefined ? { project_id } : {}),
      ...(bill_number !== undefined ? { bill_number: bill_number ? String(bill_number).trim() : null } : {}),
      ...(bill_date !== undefined ? { bill_date } : {}),
      ...(due_date !== undefined ? { due_date } : {}),
      ...(subtotal !== undefined ? { subtotal: finalSubtotal } : {}),
      ...(vat_rate !== undefined ? { vat_rate: finalVatRate } : {}),
      ...(wht_rate !== undefined ? { wht_rate: finalWhtRate } : {}),
      ...amounts,
      ...(cost_category !== undefined ? { cost_category } : {}),
      ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("id, status")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return res.status(404).json({ error: "Not found" });

    if (existing.status === "paid") {
      return res.status(409).json({ error: "Cannot cancel a fully paid vendor bill" });
    }

    const { error } = await supabaseAdmin
      .from(table)
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("company_id", companyId);
    if (error) throw error;

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/vendor-bills/:id/payments
 */
export async function addPayment(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id || req.user?.sub;
    const billId = req.params.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const { amount, payment_date, payment_method, notes } = req.body;

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (!payment_method) {
      return res.status(400).json({ error: "payment_method is required" });
    }
    if (!paymentMethods.includes(payment_method)) {
      return res.status(400).json({ error: "Invalid payment_method" });
    }

    const { data: bill, error: billErr } = await supabaseAdmin
      .from(table)
      .select("id, total_amount, paid_amount, status")
      .eq("id", billId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (billErr) throw billErr;
    if (!bill) return res.status(404).json({ error: "Vendor bill not found" });

    if (bill.status === "cancelled") {
      return res.status(409).json({ error: "Cannot add payment to a cancelled vendor bill" });
    }

    const remaining = Number(bill.total_amount) - Number(bill.paid_amount);
    if (amt > remaining) {
      return res.status(400).json({ error: "Payment amount exceeds vendor bill remaining balance" });
    }

    const payload = {
      company_id: companyId,
      vendor_bill_id: billId,
      amount: amt,
      payment_date: payment_date ?? new Date().toISOString().slice(0, 10),
      payment_method,
      notes: notes ? String(notes).trim() : null,
      created_by: userId,
    };

    const { data: payment, error } = await supabaseAdmin
      .from(paymentsTable)
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;

    const updatedBill = await recalcVendorBillTotals(billId);

    return res.status(201).json({ payment, vendorBill: updatedBill });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
