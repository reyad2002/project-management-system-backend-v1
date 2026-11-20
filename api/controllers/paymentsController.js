import { supabaseAdmin } from "../../db_connection.js";
import { paymentMethods, recalcInvoiceTotals } from "../lib/finance.js";

const table = "payments";
const projectsTable = "projects";
const invoicesTable = "invoices";
const paymentTypes = ["advance", "invoice_settlement"];

/**
 * Validate an invoice_id against the given project and current payment amount.
 * Returns { invoice } on success, or { errorStatus, errorMessage } on failure.
 */
async function validateInvoiceForPayment(companyId, invoiceId, projectId, amount, excludePaymentAmount = 0) {
  const { data: invoice, error } = await supabaseAdmin
    .from(invoicesTable)
    .select("id, project_id, status, total_amount, paid_amount")
    .eq("id", invoiceId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) {
    return { errorStatus: 400, errorMessage: "Invalid invoice_id for this company" };
  }
  if (String(invoice.project_id) !== String(projectId)) {
    return { errorStatus: 400, errorMessage: "invoice_id does not belong to the specified project" };
  }
  if (invoice.status === "cancelled") {
    return { errorStatus: 409, errorMessage: "Cannot add payment to a cancelled invoice" };
  }
  const alreadyPaid = Number(invoice.paid_amount) - Number(excludePaymentAmount);
  const remaining = Number(invoice.total_amount) - alreadyPaid;
  if (amount > remaining) {
    return { errorStatus: 400, errorMessage: "Payment amount exceeds invoice remaining balance" };
  }
  return { invoice };
}

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { project_id, client_id, invoice_id, page = "1", limit = "20" } = req.query;

    let query = supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (project_id) {
      query = query.eq("project_id", project_id);
    }

    if (invoice_id) {
      query = query.eq("invoice_id", invoice_id);
    }

    // Filter by client: payments for projects that belong to this client
    if (client_id) {
      const { data: projectIds, error: projErr } = await supabaseAdmin
        .from(projectsTable)
        .select("id")
        .eq("company_id", companyId)
        .eq("client_id", client_id);
      if (projErr) throw projErr;
      const ids = (projectIds || []).map((p) => p.id);
      if (ids.length === 0) {
        return res.json({
          payments: [],
          pagination: { page: 1, limit: parseInt(limit, 10) || 20, total: 0 },
        });
      }
      query = query.in("project_id", ids);
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      payments: data ?? [],
      pagination: { page: pageNum, limit: limitNum, total: count ?? 0 },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
export async function listByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!id) {
      return res.status(400).json({ error: "Missing id" }); // project id
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("project_id", id)
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.json({
      payments: data ?? [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res
      .status(err.code === "PGRST116" ? 404 : 500)
      .json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { project_id, amount, payment_date, payment_method, notes, invoice_id, type } = req.body;

    if (!project_id) {
      return res.status(400).json({ error: "project_id is required" });
    }

    // validate amount
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    if (!payment_method) {
      return res.status(400).json({ error: "payment_method is required" });
    }
    // Cash leaves no bank trail: record who received it / the receipt number.
    if (payment_method === "cash" && !(notes && String(notes).trim())) {
      return res.status(400).json({
        error: "Cash payments need a note (who received the cash / receipt number).",
      });
    }
    if (!paymentMethods.includes(payment_method)) {
      return res.status(400).json({ error: "Invalid payment_method" });
    }

    if (type !== undefined && type !== null && !paymentTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid type (advance | invoice_settlement)" });
    }

    // ✅ get project (id + price) in ONE query and ensure company ownership
    const { data: project, error: projectErr } = await supabaseAdmin
      .from(projectsTable)
      .select("id, price")
      .eq("id", project_id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (projectErr) throw projectErr;
    if (!project) {
      return res.status(400).json({ error: "Invalid project_id for this company" });
    }

    // ✅ invoice_id validation (cancelled invoice / overpayment / project match) —
    // checked before the generic project-price cap so the more specific, actionable
    // error surfaces when a payment would violate both.
    let finalInvoiceId = null;
    if (invoice_id) {
      const check = await validateInvoiceForPayment(companyId, invoice_id, project_id, amt);
      if (check.errorMessage) {
        return res.status(check.errorStatus).json({ error: check.errorMessage });
      }
      finalInvoiceId = invoice_id;
    }

    const projectPrice = Number(project.price ?? 0);

    // ✅ sum existing payments for this project
    const { data: rows, error: rowsErr } = await supabaseAdmin
    .from(table)
    .select("amount")
    .eq("company_id", companyId)
    .eq("project_id", project_id);

  if (rowsErr) throw rowsErr;

  const alreadyPaid = (rows || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);

    // ✅ enforce total payments <= project price (if price is set)
    if (projectPrice > 0 && alreadyPaid + amt > projectPrice) {
      return res.status(400).json({
        error: `Total payments would exceed project price. Remaining: ${projectPrice - alreadyPaid}`,
      });
    }

    // Same project + date + amount + method + note is almost certainly a double entry.
    const paymentDay = payment_date ?? new Date().toISOString().slice(0, 10);
    const wantedNote = notes ? String(notes).trim() : "";
    const { data: sameDay, error: sameDayErr } = await supabaseAdmin
      .from(table)
      .select("id, notes")
      .eq("company_id", companyId)
      .eq("project_id", project_id)
      .eq("payment_date", paymentDay)
      .eq("amount", amt)
      .eq("payment_method", payment_method);
    if (sameDayErr) throw sameDayErr;
    const duplicate = (sameDay || []).find((r) => (r.notes ?? "").trim() === wantedNote);
    if (duplicate) {
      return res.status(409).json({
        error: `This looks like a duplicate of payment #${duplicate.id} (same project, date, amount and method). If it is a genuine second payment, add a note that tells them apart.`,
      });
    }

    const finalType = type ?? (finalInvoiceId ? "invoice_settlement" : "advance");

    const payload = {
      company_id: companyId,
      project_id,
      invoice_id: finalInvoiceId,
      amount: amt,
      payment_date: payment_date ?? new Date().toISOString().slice(0, 10), // default today YYYY-MM-DD
      payment_method,
      type: finalType,
      notes: notes ? String(notes).trim() : null,
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    if (finalInvoiceId) {
      await recalcInvoiceTotals(finalInvoiceId);
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const { project_id, amount, payment_date, payment_method, notes, invoice_id, type } = req.body;

    // ✅ fetch existing payment (must belong to same company)
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("id, company_id, project_id, amount, invoice_id")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (existingErr) throw existingErr;
    if (!existing) return res.status(404).json({ error: "Not found" });

    // ✅ validate payment_method ONLY if provided
    if (payment_method !== undefined) {
      if (payment_method === null || payment_method === "") {
        return res.status(400).json({ error: "payment_method cannot be empty" });
      }
      if (!paymentMethods.includes(payment_method)) {
        return res.status(400).json({ error: "Invalid payment_method" });
      }
    }

    if (type !== undefined && type !== null && !paymentTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid type (advance | invoice_settlement)" });
    }

    // ✅ validate amount ONLY if provided
    let newAmount = undefined;
    if (amount !== undefined) {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: "amount must be a positive number" });
      }
      newAmount = amt;
    }

    // Determine final project_id and amount after update
    const finalProjectId = project_id !== undefined ? project_id : existing.project_id;
    const finalAmount = newAmount !== undefined ? newAmount : Number(existing.amount ?? 0);

    // ✅ if project_id is changing, validate ownership
    if (project_id !== undefined) {
      const { data: project, error: projectErr } = await supabaseAdmin
        .from(projectsTable)
        .select("id, price")
        .eq("id", finalProjectId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (projectErr) throw projectErr;
      if (!project) {
        return res.status(400).json({ error: "Invalid project_id for this company" });
      }
    }

    // ✅ resolve final invoice_id and validate it (cancelled / overpayment / project match) —
    // checked before the generic project-price cap so the more specific, actionable
    // error surfaces when a payment would violate both.
    const invoiceIdChanging = invoice_id !== undefined;
    const finalInvoiceId = invoiceIdChanging ? invoice_id : existing.invoice_id;

    if (finalInvoiceId) {
      // if this payment already counted against this same invoice, exclude its current amount
      const excludeAmount =
        String(existing.invoice_id) === String(finalInvoiceId) ? Number(existing.amount ?? 0) : 0;
      const check = await validateInvoiceForPayment(
        companyId,
        finalInvoiceId,
        finalProjectId,
        finalAmount,
        excludeAmount
      );
      if (check.errorMessage) {
        return res.status(check.errorStatus).json({ error: check.errorMessage });
      }
    }

    // ✅ check project price limit if we changed amount or project_id
    if (amount !== undefined || project_id !== undefined) {
      // get project price
      const { data: project, error: projErr } = await supabaseAdmin
        .from(projectsTable)
        .select("id, price")
        .eq("id", finalProjectId)
        .eq("company_id", companyId)
        .maybeSingle();

      if (projErr) throw projErr;
      if (!project) {
        return res.status(400).json({ error: "Invalid project_id for this company" });
      }

      const projectPrice = Number(project.price ?? 0);

      // total paid for final project
      const { data: rows, error: rowsErr } = await supabaseAdmin
        .from("payments")
        .select("amount")
        .eq("company_id", companyId)
        .eq("project_id", finalProjectId);

    if (rowsErr) throw rowsErr;

    const alreadyPaid = (rows || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);


      // IMPORTANT: remove existing payment amount from total IF it's in same project
      // because paidTotal currently includes this payment's old amount
      const adjustedPaid =
        Number(existing.project_id) === Number(finalProjectId)
          ? alreadyPaid - Number(existing.amount ?? 0)
          : alreadyPaid;

      if (projectPrice > 0 && adjustedPaid + finalAmount > projectPrice) {
        return res.status(400).json({
          error: `Total payments would exceed project price. Remaining: ${projectPrice - adjustedPaid}`,
        });
      }
    }

    const finalType =
      type !== undefined ? type : invoiceIdChanging ? (finalInvoiceId ? "invoice_settlement" : "advance") : undefined;

    // ✅ build update payload (partial)
    const payload = {
      ...(project_id !== undefined ? { project_id: finalProjectId } : {}),
      ...(newAmount !== undefined ? { amount: newAmount } : {}),
      ...(payment_date !== undefined ? { payment_date } : {}),
      ...(payment_method !== undefined ? { payment_method } : {}),
      ...(invoiceIdChanging ? { invoice_id: finalInvoiceId } : {}),
      ...(finalType !== undefined ? { type: finalType } : {}),
      ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
      updated_at: new Date().toISOString(), // لو عندك العمود ده
    };

    const clean = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined)
    );

    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(clean)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    // recalc whichever invoices were affected (old one if unlinked/changed, new one always)
    const oldInvoiceId = existing.invoice_id;
    if (oldInvoiceId && String(oldInvoiceId) !== String(finalInvoiceId)) {
      await recalcInvoiceTotals(oldInvoiceId);
    }
    if (finalInvoiceId) {
      await recalcInvoiceTotals(finalInvoiceId);
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id, invoice_id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    if (data.invoice_id) {
      await recalcInvoiceTotals(data.invoice_id);
    }

    return res.status(204).json({ message: "Payment deleted successfully" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
