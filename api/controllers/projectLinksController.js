import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany } from "../lib/tasks.js";
import { getPortalProject } from "../lib/portal.js";

const table = "project_links";
const linkTypes = ["staging", "live", "dashboard", "other"];

function isSafeUrl(url) {
  return /^https?:\/\//i.test(String(url).trim());
}

// ----- Dashboard -----

export async function createByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const projectId = req.params.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { label, url, type } = req.body;
    if (!label || !String(label).trim()) return res.status(400).json({ error: "label is required" });
    if (!url || !isSafeUrl(url)) {
      return res.status(400).json({ error: "url must start with http:// or https://" });
    }
    if (type != null && !linkTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid type" });
    }

    const payload = {
      company_id: companyId,
      project_id: projectId,
      label: String(label).trim(),
      url: String(url).trim(),
      type: type ?? "other",
      created_by: userId,
    };

    const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*").single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

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
      .order("created_at", { ascending: false });
    if (error) throw error;

    return res.json({ links: data || [] });
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
      .select("*")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return res.json({ links: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
