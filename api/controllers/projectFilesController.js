import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany } from "../lib/tasks.js";
import { getPortalProject } from "../lib/portal.js";
import { createNotifications } from "../lib/notifications.js";

const table = "project_files";
const commentsTable = "project_file_comments";
const fileCategories = ["deliverable", "client_upload"];
// live enum public.file_review_status (verified via PostgREST introspection) — note
// 'pending_review', not 'pending', and there's a 'rejected' value beyond the original spec.
const fileStatuses = ["pending_review", "approved", "needs_changes", "rejected"];

/**
 * Notification failures must never undo (or fail the response for) a file that was already
 * written successfully — log and move on instead of throwing. This matters concretely right
 * now: notifications.type doesn't yet allow 'file_uploaded'/'file_status_changed' until
 * migrations/13_extend_notifications_for_files_and_recurring.sql is applied, so without this
 * guard every upload/status-change to a client with active portal users would 500 despite the
 * file row having already been committed.
 */
async function notifyClientPortalUsers(companyId, clientId, payload) {
  try {
    const { data: portalUsers, error } = await supabaseAdmin
      .from("client_portal_users")
      .select("id")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .eq("status", "active");
    if (error) throw error;
    if (!portalUsers || portalUsers.length === 0) return;

    await createNotifications(
      portalUsers.map((u) => ({ ...payload, company_id: companyId, recipient_type: "client_portal_user", recipient_id: u.id }))
    );
  } catch (err) {
    console.error(`[project-files] failed to notify client portal users (client ${clientId}):`, err.message);
  }
}

async function notifyProjectMembers(companyId, projectId, payload) {
  try {
    const { data: members, error } = await supabaseAdmin
      .from("project_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("project_id", projectId);
    if (error) throw error;
    if (!members || members.length === 0) return;

    await createNotifications(
      members.map((m) => ({ ...payload, company_id: companyId, recipient_type: "team_member", recipient_id: m.user_id }))
    );
  } catch (err) {
    console.error(`[project-files] failed to notify project members (project ${projectId}):`, err.message);
  }
}

function buildListQuery(companyId, projectId, query) {
  let q = supabaseAdmin.from(table).select("*").eq("company_id", companyId).eq("project_id", projectId).order("created_at", { ascending: false });
  if (query.category) q = q.eq("category", query.category);
  if (query.status) q = q.eq("status", query.status);
  return q;
}

// ----- Dashboard (staff) -----

export async function createByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const projectId = req.params.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { file_name, file_url, description, category } = req.body;
    if (!file_name || !String(file_name).trim()) return res.status(400).json({ error: "file_name is required" });
    if (!file_url || !/^https?:\/\//i.test(String(file_url).trim())) {
      return res.status(400).json({ error: "file_url is required and must start with http:// or https://" });
    }
    const finalCategory = category && fileCategories.includes(category) ? category : "deliverable";

    const payload = {
      company_id: companyId,
      project_id: projectId,
      file_name: String(file_name).trim(),
      file_url: String(file_url).trim(),
      description: description ? String(description).trim() : null,
      category: finalCategory,
      status: finalCategory === "deliverable" ? "pending_review" : null,
      uploaded_by_type: "team_member",
      uploaded_by_id: userId,
    };

    const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*").single();
    if (error) throw error;

    await notifyClientPortalUsers(companyId, project.client_id, {
      type: "file_uploaded",
      title: `New file uploaded: ${data.file_name}`,
      body: null,
      related_type: "file",
      related_id: data.id,
    });

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

    if (req.query.category && !fileCategories.includes(req.query.category)) {
      return res.status(400).json({ error: "Invalid category" });
    }
    if (req.query.status && !fileStatuses.includes(req.query.status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { data, error } = await buildListQuery(companyId, projectId, req.query);
    if (error) throw error;

    return res.json({ files: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listComments(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data: file, error: fileErr } = await supabaseAdmin.from(table).select("id").eq("id", req.params.fileId).eq("company_id", companyId).maybeSingle();
    if (fileErr) throw fileErr;
    if (!file) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin.from(commentsTable).select("*").eq("file_id", file.id).order("created_at", { ascending: true });
    if (error) throw error;

    return res.json({ comments: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createComment(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const { data: file, error: fileErr } = await supabaseAdmin.from(table).select("id").eq("id", req.params.fileId).eq("company_id", companyId).maybeSingle();
    if (fileErr) throw fileErr;
    if (!file) return res.status(404).json({ error: "Not found" });

    const { content } = req.body;
    if (!content || !String(content).trim()) return res.status(400).json({ error: "content is required" });

    const { data, error } = await supabaseAdmin
      .from(commentsTable)
      .insert({ file_id: file.id, author_type: "team_member", author_id: userId, comment: String(content).trim() })
      .select("*")
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ----- Portal (client) -----

export async function portalCreateByProject(req, res) {
  try {
    const { company_id: companyId, client_id: clientId, id: portalUserId } = req.portalUser;
    const projectId = req.params.id;

    const project = await getPortalProject(companyId, clientId, projectId);
    if (!project) return res.status(404).json({ error: "Not found" });

    const { file_name, file_url, description } = req.body;
    if (!file_name || !String(file_name).trim()) return res.status(400).json({ error: "file_name is required" });
    if (!file_url || !/^https?:\/\//i.test(String(file_url).trim())) {
      return res.status(400).json({ error: "file_url is required and must start with http:// or https://" });
    }

    const payload = {
      company_id: companyId,
      project_id: projectId,
      file_name: String(file_name).trim(),
      file_url: String(file_url).trim(),
      description: description ? String(description).trim() : null,
      category: "client_upload",
      status: null,
      uploaded_by_type: "client",
      uploaded_by_id: portalUserId,
    };

    const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*").single();
    if (error) throw error;

    await notifyProjectMembers(companyId, projectId, {
      type: "file_uploaded",
      title: `Client uploaded a file: ${data.file_name}`,
      body: null,
      related_type: "file",
      related_id: data.id,
    });

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function portalListByProject(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const projectId = req.params.id;

    const project = await getPortalProject(companyId, clientId, projectId);
    if (!project) return res.status(404).json({ error: "Not found" });

    if (req.query.category && !fileCategories.includes(req.query.category)) {
      return res.status(400).json({ error: "Invalid category" });
    }
    if (req.query.status && !fileStatuses.includes(req.query.status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { data, error } = await buildListQuery(companyId, projectId, req.query);
    if (error) throw error;

    return res.json({ files: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * A portal file is reachable by the current portal user only if it belongs to a project owned
 * by their client. Used by both the status-update and comment endpoints below.
 */
async function getFileForPortalUser(companyId, clientId, fileId) {
  const { data: file, error } = await supabaseAdmin.from(table).select("*").eq("id", fileId).eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  if (!file) return null;

  const project = await getPortalProject(companyId, clientId, file.project_id);
  if (!project) return null;

  return file;
}

export async function portalUpdateStatus(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;

    const file = await getFileForPortalUser(companyId, clientId, req.params.fileId);
    if (!file) return res.status(404).json({ error: "Not found" });
    if (file.category !== "deliverable") {
      return res.status(400).json({ error: "Only deliverable files can have their status changed" });
    }

    const { status, comment } = req.body;
    if (!["approved", "needs_changes"].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved' or 'needs_changes'" });
    }
    if (status === "needs_changes" && (!comment || !String(comment).trim())) {
      return res.status(400).json({ error: "comment is required when status is 'needs_changes'" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", file.id)
      .select("*")
      .single();
    if (error) throw error;

    if (comment && String(comment).trim()) {
      const { error: commentErr } = await supabaseAdmin.from(commentsTable).insert({
        file_id: file.id,
        author_type: "client",
        author_id: req.portalUser.id,
        comment: String(comment).trim(),
      });
      if (commentErr) throw commentErr;
    }

    await notifyProjectMembers(companyId, file.project_id, {
      type: "file_status_changed",
      title: `File ${status === "approved" ? "approved" : "needs changes"}: ${file.file_name}`,
      body: comment ? String(comment).trim() : null,
      related_type: "file",
      related_id: file.id,
    });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function portalListComments(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;

    const file = await getFileForPortalUser(companyId, clientId, req.params.fileId);
    if (!file) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin.from(commentsTable).select("*").eq("file_id", file.id).order("created_at", { ascending: true });
    if (error) throw error;

    return res.json({ comments: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function portalCreateComment(req, res) {
  try {
    const { company_id: companyId, client_id: clientId, id: portalUserId } = req.portalUser;

    const file = await getFileForPortalUser(companyId, clientId, req.params.fileId);
    if (!file) return res.status(404).json({ error: "Not found" });

    const { content } = req.body;
    if (!content || !String(content).trim()) return res.status(400).json({ error: "content is required" });

    const { data, error } = await supabaseAdmin
      .from(commentsTable)
      .insert({ file_id: file.id, author_type: "client", author_id: portalUserId, comment: String(content).trim() })
      .select("*")
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
