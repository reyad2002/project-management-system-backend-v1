import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany } from "../lib/tasks.js";
import { encrypt } from "../lib/crypto.js";
import { getPortalProject } from "../lib/portal.js";
import {
  credentialSafeFields,
  getCredentialForCompany,
  listCredentialsForProject,
  logCredentialAccess,
  revealCredentialPassword,
} from "../lib/credentials.js";

const table = "credentials";
const accessLogTable = "credential_access_logs";

// ----- Dashboard -----

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const projectId = req.params.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { label, username, password, panel_url, notes } = req.body;
    if (!label || !String(label).trim()) return res.status(400).json({ error: "label is required" });
    if (!username || !String(username).trim()) return res.status(400).json({ error: "username is required" });
    if (!password || !String(password).trim()) return res.status(400).json({ error: "password is required" });

    const payload = {
      company_id: companyId,
      project_id: projectId,
      label: String(label).trim(),
      username: String(username).trim(),
      password_encrypted: encrypt(password),
      panel_url: panel_url ? String(panel_url).trim() : null,
      notes: notes ? String(notes).trim() : null,
      created_by: userId,
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select(credentialSafeFields)
      .single();
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

    const credentials = await listCredentialsForProject(companyId, projectId);
    return res.json({ credentials });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function reveal(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const credential = await getCredentialForCompany(companyId, req.params.id);
    if (!credential) return res.status(404).json({ error: "Not found" });

    const password = revealCredentialPassword(credential);
    await logCredentialAccess(credential.id, "team_member", userId);

    return res.json({ password });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function accessLog(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const credential = await getCredentialForCompany(companyId, req.params.id);
    if (!credential) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin
      .from(accessLogTable)
      .select("accessed_by_type, accessed_by_id, accessed_at")
      .eq("credential_id", credential.id)
      .order("accessed_at", { ascending: false });
    if (error) throw error;

    const rows = data || [];
    const teamIds = [...new Set(rows.filter((r) => r.accessed_by_type === "team_member").map((r) => r.accessed_by_id))];
    const portalIds = [...new Set(rows.filter((r) => r.accessed_by_type === "client_portal_user").map((r) => r.accessed_by_id))];

    const [teamRes, portalRes] = await Promise.all([
      teamIds.length ? supabaseAdmin.from("users").select("id, name").in("id", teamIds) : Promise.resolve({ data: [] }),
      portalIds.length
        ? supabaseAdmin.from("client_portal_users").select("id, name").in("id", portalIds)
        : Promise.resolve({ data: [] }),
    ]);
    if (teamRes.error) throw teamRes.error;
    if (portalRes.error) throw portalRes.error;

    const teamNameById = Object.fromEntries((teamRes.data || []).map((u) => [String(u.id), u.name]));
    const portalNameById = Object.fromEntries((portalRes.data || []).map((u) => [String(u.id), u.name]));

    const logs = rows.map((r) => ({
      accessed_by_type: r.accessed_by_type,
      accessed_by_name:
        r.accessed_by_type === "team_member"
          ? teamNameById[String(r.accessed_by_id)] ?? null
          : portalNameById[String(r.accessed_by_id)] ?? null,
      accessed_at: r.accessed_at,
    }));

    return res.json({ logs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ----- Portal -----

export async function portalListByProject(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const projectId = req.params.id;

    const project = await getPortalProject(companyId, clientId, projectId);
    if (!project) return res.status(404).json({ error: "Not found" });

    const credentials = await listCredentialsForProject(companyId, projectId);
    return res.json({ credentials });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function portalReveal(req, res) {
  try {
    const { company_id: companyId, client_id: clientId, id: portalUserId } = req.portalUser;

    const credential = await getCredentialForCompany(companyId, req.params.id);
    if (!credential) return res.status(404).json({ error: "Not found" });

    const project = await getPortalProject(companyId, clientId, credential.project_id);
    if (!project) return res.status(404).json({ error: "Not found" });

    const password = revealCredentialPassword(credential);
    await logCredentialAccess(credential.id, "client_portal_user", portalUserId);

    return res.json({ password });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
