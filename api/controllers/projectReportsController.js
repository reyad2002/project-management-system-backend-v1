import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany } from "../lib/tasks.js";
import { getPortalProject } from "../lib/portal.js";

const table = "project_reports";

// One report per project per calendar month. Clients send "YYYY-MM" or "YYYY-MM-DD"; we always
// store the first day of the month.
function normalizeMonth(value) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

const intFields = ["reach", "leads", "posts_published"];

/** Validate + shape the writable fields. Returns { error } or { values } (only provided keys). */
function parseReportBody(body, { requirePeriod }) {
  const values = {};

  if (body.period_month !== undefined || requirePeriod) {
    const period = normalizeMonth(body.period_month);
    if (!period) return { error: "period_month is required (YYYY-MM)" };
    values.period_month = period;
  }

  if (body.ad_spend !== undefined && body.ad_spend !== null && body.ad_spend !== "") {
    const n = Number(body.ad_spend);
    if (!Number.isFinite(n) || n < 0) return { error: "ad_spend must be a number >= 0" };
    values.ad_spend = n;
  }

  for (const f of intFields) {
    if (body[f] === undefined) continue;
    if (body[f] === null || body[f] === "") {
      values[f] = null;
      continue;
    }
    const n = Number(body[f]);
    if (!Number.isInteger(n) || n < 0) return { error: `${f} must be a whole number >= 0` };
    values[f] = n;
  }

  if (body.followers_gained !== undefined) {
    if (body.followers_gained === null || body.followers_gained === "") {
      values.followers_gained = null;
    } else {
      const n = Number(body.followers_gained);
      if (!Number.isInteger(n)) return { error: "followers_gained must be a whole number" };
      values.followers_gained = n; // may be negative (net loss)
    }
  }

  if (body.summary !== undefined) {
    values.summary = body.summary ? String(body.summary).trim() : null;
  }

  return { values };
}

// ----- Dashboard -----

export async function listByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("period_month", { ascending: false });
    if (error) throw error;

    return res.json({ reports: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** Create the month's report, or replace it if one already exists for that month. */
export async function upsertByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const projectId = req.params.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const parsed = parseReportBody(req.body ?? {}, { requirePeriod: true });
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { data, error } = await supabaseAdmin
      .from(table)
      .upsert(
        {
          ...parsed.values,
          company_id: companyId,
          project_id: projectId,
          created_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "project_id,period_month" }
      )
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
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const parsed = parseReportBody(req.body ?? {}, { requirePeriod: false });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    if (Object.keys(parsed.values).length === 0) return res.status(400).json({ error: "No fields to update" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .update({ ...parsed.values, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) {
      // Moving a report onto a month that already has one violates unique(project_id, period_month).
      if (error.code === "23505") return res.status(409).json({ error: "A report for that month already exists" });
      throw error;
    }
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ----- Portal (read-only) -----

export async function portalListByProject(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const projectId = req.params.id;

    const project = await getPortalProject(companyId, clientId, projectId);
    if (!project) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, project_id, period_month, ad_spend, reach, leads, followers_gained, posts_published, summary")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("period_month", { ascending: false });
    if (error) throw error;

    return res.json({ reports: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
