import { supabaseAdmin } from "../../db_connection.js";
import {
  invoiceStatuses,
  computeTaxAmounts,
  generateInvoiceNumber,
} from "../lib/finance.js";

const table = "invoices";
const projectsTable = "projects";
const clientsTable = "clients";
const phasesTable = "phases";
const paymentsTable = "payments";

async function validatePhaseBelongsToProject(companyId, projectId, phaseId) {
  if (!phaseId) return { valid: true };
  const { data, error } = await supabaseAdmin
    .from(phasesTable)
    .select("id")
    .eq("id", phaseId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { valid: false, error: "Phase does not belong to the specified project" };
  }
  return { valid: true };
}

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const {
      project_id,
      client_id,
      status,
      from_date,
      to_date,
      page = "1",
      limit = "20",
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("issue_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (project_id) query = query.eq("project_id", project_id);
    if (client_id) query = query.eq("client_id", client_id);
    if (status) {
      if (!invoiceStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      query = query.eq("status", status);
    }
    if (from_date) query = query.gte("issue_date", from_date);
    if (to_date) query = query.lte("issue_date", to_date);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      invoices: data || [],
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
      .eq("invoice_id", id)
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
      client_id,
      project_id,
      phase_id,
      issue_date,
      due_date,
      subtotal,
      vat_rate,
      wht_rate,
      notes,
    } = req.body;

    if (!client_id || !project_id || !issue_date || !due_date) {
      return res
        .status(400)
        .json({ error: "client_id, project_id, issue_date and due_date are required" });
    }

    const sub = Number(subtotal);
    if (!Number.isFinite(sub) || sub < 0) {
      return res.status(400).json({ error: "subtotal must be a non-negative number" });
    }

    if (new Date(due_date) < new Date(issue_date)) {
      return res.status(400).json({ error: "due_date must be on or after issue_date" });
    }

    const { data: project, error: projectErr } = await supabaseAdmin
      .from(projectsTable)
      .select("id, client_id")
      .eq("id", project_id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (projectErr) throw projectErr;
    if (!project) {
      return res.status(400).json({ error: "Invalid project_id for this company" });
    }
    if (String(project.client_id) !== String(client_id)) {
      return res.status(400).json({ error: "client_id must be the project's client" });
    }

    const phaseCheck = await validatePhaseBelongsToProject(companyId, project_id, phase_id);
    if (!phaseCheck.valid) {
      return res.status(400).json({ error: phaseCheck.error });
    }

    const vatRate = vat_rate != null ? Number(vat_rate) : 14.0;
    const whtRate = wht_rate != null ? Number(wht_rate) : 0;
    if (!Number.isFinite(vatRate) || !Number.isFinite(whtRate)) {
      return res.status(400).json({ error: "vat_rate and wht_rate must be numbers" });
    }

    const amounts = computeTaxAmounts(sub, vatRate, whtRate, 0);
    const invoiceNumber = await generateInvoiceNumber(companyId);

    const payload = {
      company_id: companyId,
      client_id,
      project_id,
      phase_id: phase_id ?? null,
      invoice_number: invoiceNumber,
      issue_date,
      due_date,
      subtotal: sub,
      vat_rate: vatRate,
      wht_rate: whtRate,
      ...amounts,
      paid_amount: 0,
      status: "draft",
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
    if (!id) return res.status(400).json({ error: "Missing id" });

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return res.status(404).json({ error: "Not found" });

    if (existing.status !== "draft") {
      return res
        .status(409)
        .json({ error: "Invoice cannot be edited after it has been sent" });
    }

    const {
      client_id,
      project_id,
      phase_id,
      issue_date,
      due_date,
      subtotal,
      vat_rate,
      wht_rate,
      notes,
    } = req.body;

    const finalProjectId = project_id !== undefined ? project_id : existing.project_id;
    const finalClientId = client_id !== undefined ? client_id : existing.client_id;

    if (project_id !== undefined || client_id !== undefined) {
      const { data: project, error: projectErr } = await supabaseAdmin
        .from(projectsTable)
        .select("id, client_id")
        .eq("id", finalProjectId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (projectErr) throw projectErr;
      if (!project) {
        return res.status(400).json({ error: "Invalid project_id for this company" });
      }
      if (String(project.client_id) !== String(finalClientId)) {
        return res.status(400).json({ error: "client_id must be the project's client" });
      }
    }

    const finalPhaseId = phase_id !== undefined ? phase_id : existing.phase_id;
    if (finalPhaseId) {
      const phaseCheck = await validatePhaseBelongsToProject(companyId, finalProjectId, finalPhaseId);
      if (!phaseCheck.valid) {
        return res.status(400).json({ error: phaseCheck.error });
      }
    }

    let finalIssueDate = issue_date !== undefined ? issue_date : existing.issue_date;
    let finalDueDate = due_date !== undefined ? due_date : existing.due_date;
    if (new Date(finalDueDate) < new Date(finalIssueDate)) {
      return res.status(400).json({ error: "due_date must be on or after issue_date" });
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
      ...(client_id !== undefined ? { client_id } : {}),
      ...(project_id !== undefined ? { project_id } : {}),
      ...(phase_id !== undefined ? { phase_id } : {}),
      ...(issue_date !== undefined ? { issue_date } : {}),
      ...(due_date !== undefined ? { due_date } : {}),
      ...(subtotal !== undefined ? { subtotal: finalSubtotal } : {}),
      ...(vat_rate !== undefined ? { vat_rate: finalVatRate } : {}),
      ...(wht_rate !== undefined ? { wht_rate: finalWhtRate } : {}),
      ...amounts,
      ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
      updated_at: new Date().toISOString(),
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

export async function send(req, res) {
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

    if (existing.status !== "draft") {
      return res.status(409).json({ error: "Invoice must be in draft status to be sent" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function cancel(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { reason } = req.body || {};

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return res.status(404).json({ error: "Not found" });

    if (existing.status === "paid") {
      return res.status(409).json({ error: "Cannot cancel a fully paid invoice" });
    }

    const notes = reason
      ? `${existing.notes ? existing.notes + "\n" : ""}Cancelled: ${String(reason).trim()}`
      : existing.notes;

    const { data, error } = await supabaseAdmin
      .from(table)
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    // Unlink any payments tied to this invoice, turning them back into advances
    const { error: unlinkErr } = await supabaseAdmin
      .from(paymentsTable)
      .update({ invoice_id: null, type: "advance" })
      .eq("invoice_id", id);
    if (unlinkErr) throw unlinkErr;

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
