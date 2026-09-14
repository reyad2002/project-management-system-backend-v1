import { supabaseAdmin } from "../../db_connection.js";
import { createNotifications } from "../lib/notifications.js";
import { getPortalProject } from "../lib/portal.js";

const projectsTable = "projects";
const phasesTable = "phases";
const invoicesTable = "invoices";
const paymentsTable = "payments";

async function getOwnProject(companyId, clientId, projectId) {
  return getPortalProject(companyId, clientId, projectId, "*");
}

export async function listProjects(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;

    const { data, error } = await supabaseAdmin
      .from(projectsTable)
      .select("id, title, status, start_date, due_date")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return res.json({ projects: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getProject(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const projectId = req.params.id;

    const project = await getOwnProject(companyId, clientId, projectId);
    if (!project) return res.status(404).json({ error: "Not found" });

    const [phasesRes, timelineRes] = await Promise.all([
      supabaseAdmin
        .from(phasesTable)
        .select("*")
        .eq("company_id", companyId)
        .eq("project_id", projectId)
        .order("start_date", { ascending: true }),
      supabaseAdmin.from("v_project_timeline").select("*").eq("company_id", companyId).eq("project_id", projectId),
    ]);
    if (phasesRes.error) throw phasesRes.error;
    if (timelineRes.error) throw timelineRes.error;

    const items = (timelineRes.data || []).map((i) => ({
      id: i.id,
      item_type: i.item_type,
      title: i.title,
      start_date: i.start_date,
      due_date: i.due_date,
      progress_percent: Number(i.progress_percent ?? 0),
      parent_task_id: i.parent_task_id,
    }));

    return res.json({ ...project, phases: phasesRes.data || [], timeline: { items } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listInvoices(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;

    const { data, error } = await supabaseAdmin
      .from(invoicesTable)
      .select("*")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("issue_date", { ascending: false });
    if (error) throw error;

    return res.json({ invoices: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getInvoice(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const invoiceId = req.params.id;

    const { data: invoice, error } = await supabaseAdmin
      .from(invoicesTable)
      .select("*")
      .eq("id", invoiceId)
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .maybeSingle();
    if (error) throw error;
    if (!invoice) return res.status(404).json({ error: "Not found" });

    const { data: payments, error: payErr } = await supabaseAdmin
      .from(paymentsTable)
      .select("id, amount, payment_date, payment_method, notes")
      .eq("invoice_id", invoiceId)
      .order("payment_date", { ascending: false });
    if (payErr) throw payErr;

    return res.json({ ...invoice, payments: payments || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function paymentSummary(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;

    const { data: projects, error: projectsErr } = await supabaseAdmin
      .from(projectsTable)
      .select("id, price")
      .eq("company_id", companyId)
      .eq("client_id", clientId);
    if (projectsErr) throw projectsErr;

    const projectList = projects ?? [];
    const projectIds = projectList.map((p) => p.id);
    const totalAmountToPay = projectList.reduce((sum, p) => sum + Number(p.price ?? 0), 0);

    let amountPaid = 0;
    if (projectIds.length > 0) {
      const { data: payments, error: paymentsErr } = await supabaseAdmin
        .from(paymentsTable)
        .select("amount")
        .eq("company_id", companyId)
        .in("project_id", projectIds);
      if (paymentsErr) throw paymentsErr;
      amountPaid = (payments ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
    }

    const remaining = Math.round((totalAmountToPay - amountPaid) * 100) / 100;

    return res.json({
      client_id: clientId,
      total_amount_to_pay: Math.round(totalAmountToPay * 100) / 100,
      amount_paid: Math.round(amountPaid * 100) / 100,
      remaining,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function approvePhase(req, res) {
  try {
    const { company_id: companyId, client_id: clientId, id: portalUserId } = req.portalUser;
    const phaseId = req.params.id;

    const { data: phase, error } = await supabaseAdmin
      .from(phasesTable)
      .select("id, project_id, client_approved_at, company_id")
      .eq("id", phaseId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!phase) return res.status(404).json({ error: "Not found" });

    const project = await getOwnProject(companyId, clientId, phase.project_id);
    if (!project) return res.status(404).json({ error: "Not found" });

    if (phase.client_approved_at) {
      return res.status(409).json({ error: "Phase has already been approved" });
    }

    const { data, error: updateErr } = await supabaseAdmin
      .from(phasesTable)
      .update({ client_approved_at: new Date().toISOString(), client_approved_by: portalUserId })
      .eq("id", phaseId)
      .select("*")
      .maybeSingle();
    if (updateErr) throw updateErr;

    const { data: members, error: membersErr } = await supabaseAdmin
      .from("project_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("project_id", project.id);
    if (membersErr) throw membersErr;

    if (members && members.length > 0) {
      await createNotifications(
        members.map((m) => ({
          company_id: companyId,
          recipient_type: "team_member",
          recipient_id: m.user_id,
          type: "phase_approved",
          title: `Phase approved: ${data.title ?? ""}`,
          body: null,
          related_type: "phase",
          related_id: data.id,
        }))
      );
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
