import { supabaseAdmin } from "../../db_connection.js";

/**
 * Audit trail.
 *
 *  - `writeAudit(entry)` records one event (login, password change, ...) and never throws.
 *  - `auditMutations` is an Express middleware mounted AFTER authentication on every protected router.
 *    It records every POST / PUT / PATCH / DELETE (and CSV/Word exports) with who, what, the record as
 *    it was before, and the response as it is after. Secrets are redacted before anything is stored.
 *
 * The row is written before the response is flushed: on serverless platforms work scheduled after
 * the response can be frozen and lost, and a log entry that can vanish is not an audit trail.
 */

const MAX_JSON_BYTES = 30_000;
const WRITE_TIMEOUT_MS = 2_500;

const SENSITIVE_KEY = /(pass(word)?|secret|token|hash|encrypted|authorization|api[_-]?key|otp|invite_link)/i;

export function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Redact, then cap the stored size so one huge payload can't bloat the table. */
function prepare(value) {
  if (value === null || value === undefined) return null;
  const clean = redact(value);
  try {
    if (JSON.stringify(clean).length > MAX_JSON_BYTES) return { _truncated: true };
  } catch {
    return { _unserializable: true };
  }
  return clean;
}

export function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : String(forwarded ?? "").split(",")[0];
  return (first || req.ip || "").trim() || null;
}

export async function insertAudit(entry) {
  try {
    if (!supabaseAdmin) return;
    const { error } = await supabaseAdmin.from("audit_logs").insert({
      company_id: entry.company_id ?? null,
      actor_type: entry.actor_type ?? "system",
      actor_id: entry.actor_id ?? null,
      actor_name: entry.actor_name ?? null,
      action: entry.action,
      entity_type: entry.entity_type ?? null,
      entity_id: entry.entity_id != null ? String(entry.entity_id) : null,
      outcome: entry.outcome ?? "success",
      status_code: entry.status_code ?? null,
      method: entry.method ?? null,
      path: entry.path ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.user_agent ? String(entry.user_agent).slice(0, 300) : null,
      summary: entry.summary ? String(entry.summary).slice(0, 500) : null,
      before: prepare(entry.before),
      after: prepare(entry.after),
      metadata: prepare(entry.metadata) ?? {},
    });
    if (error) console.error("[audit] insert failed:", error.message);
  } catch (err) {
    console.error("[audit] unexpected failure:", err.message);
  }
}

/** For events raised inside controllers (login, password change...). Never throws. */
export async function writeAudit(req, entry) {
  await insertAudit({
    ip: clientIp(req),
    user_agent: req.headers["user-agent"],
    method: req.method,
    path: req.originalUrl?.split("?")[0],
    ...entry,
  });
}

// ---------------------------------------------------------------------------------------------
// Route -> entity resolution
// ---------------------------------------------------------------------------------------------

// /api/<resource>/...  ->  { entity (singular label), table }
const RESOURCES = {
  clients: { entity: "client", table: "clients" },
  projects: { entity: "project", table: "projects" },
  payments: { entity: "payment", table: "payments" },
  expenses: { entity: "expense", table: "expenses" },
  invoices: { entity: "invoice", table: "invoices" },
  vendors: { entity: "vendor", table: "vendors" },
  "vendor-bills": { entity: "vendor_bill", table: "vendor_bills" },
  tasks: { entity: "task", table: "tasks" },
  "checklist-items": { entity: "task_checklist_item", table: "task_checklist_items" },
  "task-templates": { entity: "task_template", table: "task_templates" },
  "task-comments": { entity: "task_comment", table: "task_comments" },
  "client-contacts": { entity: "client_contact", table: "client_contacts" },
  "task-attachments": { entity: "task_attachment", table: "task_attachments" },
  "recurring-tasks": { entity: "recurring_task", table: "recurring_tasks" },
  meetings: { entity: "meeting", table: "meetings" },
  "project-links": { entity: "project_link", table: "project_links" },
  credentials: { entity: "credential", table: "credentials" },
  files: { entity: "project_file", table: "project_files" },
  "recurring-revenue": { entity: "recurring_revenue", table: "recurring_revenue" },
  "recurring-expenses": { entity: "recurring_expense", table: "recurring_expenses" },
  investments: { entity: "investment", table: "investments" },
  "project-reports": { entity: "project_report", table: "project_reports" },
  attachments: { entity: "attachment", table: "attachments" },
  accounts: { entity: "account", table: "users" },
  notifications: { entity: "notification", table: "notifications" },
};

// /api/<resource>/:id/<sub>/:subId  ->  child record
const SUB_RESOURCES = {
  phases: { entity: "phase", table: "phases" },
  tasks: { entity: "task", table: "tasks" },
  meetings: { entity: "meeting", table: "meetings" },
  links: { entity: "project_link", table: "project_links" },
  credentials: { entity: "credential", table: "credentials" },
  files: { entity: "project_file", table: "project_files" },
  reports: { entity: "project_report", table: "project_reports" },
  members: { entity: "project_member", table: "project_members" },
  "portal-users": { entity: "client_portal_user", table: "client_portal_users" },
  notes: { entity: "meeting_note", table: "meeting_notes" },
  comments: { entity: "file_comment", table: "project_file_comments" },
  payments: { entity: "payment", table: "payments" },
};

// Mutations that are pure noise (read receipts etc.)
const SKIP = [/^\/api\/saved-filters(\/|$)/, /^\/api\/notifications(\/|$)/, /^\/api\/portal\/notifications(\/|$)/, /\/mark-read$/];

const ACTION_WORDS = {
  send: "send",
  cancel: "cancel",
  approve: "approve",
  reveal: "reveal_credential",
  "mark-paid": "mark_paid",
  reorder: "reorder",
  status: "status_change",
  "reset-password": "password_reset",
  password: "password_change",
  export: "export",
};

const isId = (s) => s !== undefined && /^[0-9a-f-]{1,40}$/i.test(s);

export function describeRequest(req) {
  const path = req.originalUrl.split("?")[0];
  const portal = path.startsWith("/api/portal/");
  const segs = path.replace(/^\/api\/(portal\/)?/, "").split("/").filter(Boolean);
  const [resource, id, sub, subId] = segs;

  let entry = RESOURCES[resource];
  let entityId = isId(id) ? id : null;
  let word = null;
  let parent = null;

  if (sub && SUB_RESOURCES[sub]) {
    // /projects/12/phases/3, /projects/12/meetings (create under a parent)
    parent = { type: entry?.entity ?? resource, id: entityId };
    entry = SUB_RESOURCES[sub];
    entityId = isId(subId) ? subId : null;
    const tail = segs[segs.length - 1];
    if (segs.length > 4 && ACTION_WORDS[tail]) word = ACTION_WORDS[tail];
  } else if (sub && ACTION_WORDS[sub]) {
    word = ACTION_WORDS[sub];
  } else if (sub) {
    word = sub.replace(/-/g, "_");
  } else if (id && !isId(id)) {
    // /api/tasks/bulk-update -> "bulk_update", /api/task-templates/defaults -> "defaults"
    word = id.replace(/-/g, "_");
  }
  if (!entry && resource === "phases") entry = SUB_RESOURCES.phases;
  if (resource === "meeting-notes") entry = { entity: "meeting_note", table: "meeting_notes" };
  if (portal && resource === "feedback") entry = { entity: "feedback", table: "feedback" };

  const method = req.method;
  let action = method === "POST" ? "create" : method === "DELETE" ? "delete" : method === "GET" ? "export" : "update";
  if (word) action = word;

  return {
    path,
    portal,
    action,
    entityType: entry?.entity ?? resource ?? null,
    table: entry?.table ?? null,
    entityId,
    parent,
  };
}

function labelOf(row) {
  if (!row || typeof row !== "object") return null;
  return row.title ?? row.name ?? row.label ?? row.invoice_number ?? row.bill_number ?? row.email ?? null;
}

async function fetchBefore(info, companyId) {
  if (!info.table || !info.entityId || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from(info.table).select("*").eq("id", info.entityId).maybeSingle();
  if (!data) return null;
  // Never show another tenant's row, even if the id was guessed.
  if (data.company_id !== undefined && companyId !== undefined && String(data.company_id) !== String(companyId)) {
    return null;
  }
  return data;
}

function actorOf(req) {
  if (req.user) {
    return { actor_type: "user", actor_id: req.user.id, actor_name: req.user.name, company_id: req.user.company_id };
  }
  if (req.portalUser) {
    return {
      actor_type: "client_portal_user",
      actor_id: req.portalUser.id,
      actor_name: req.portalUser.name,
      company_id: req.portalUser.company_id,
    };
  }
  return { actor_type: "anonymous", actor_id: null, actor_name: null, company_id: null };
}

export async function auditMutations(req, res, next) {
  const path = req.originalUrl.split("?")[0];
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method);
  const isExport = req.method === "GET" && /\/export(\/|$)/.test(path);
  if ((!isMutation && !isExport) || SKIP.some((re) => re.test(path))) return next();

  const info = describeRequest(req);
  const actor = actorOf(req);

  let before = null;
  if (req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE") {
    try {
      before = await fetchBefore(info, actor.company_id);
    } catch {
      before = null; // the audit must never block the real request
    }
  }

  let captured;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    captured = body;
    return originalJson(body);
  };

  const originalEnd = res.end.bind(res);
  let logged = false;
  res.end = (...args) => {
    if (logged) return originalEnd(...args);
    logged = true;

    const status = res.statusCode;
    const outcome = status < 400 ? "success" : "failure";
    const after = outcome === "success" && req.method !== "DELETE" && captured && !Array.isArray(captured) ? captured : null;
    const entityId = info.entityId ?? (after?.id != null ? after.id : null);
    const label = labelOf(after) ?? labelOf(before);
    const who = actor.actor_name ?? "Someone";
    const what = `${info.entityType}${entityId ? ` #${entityId}` : ""}${label ? ` (${label})` : ""}`;
    const verb = info.action.replace(/_/g, " ");

    const entry = {
      ...actor,
      action: info.action,
      entity_type: info.entityType,
      entity_id: entityId,
      outcome,
      status_code: status,
      method: req.method,
      path: info.path,
      ip: clientIp(req),
      user_agent: req.headers["user-agent"],
      summary: outcome === "success" ? `${who} ${verb} ${what}` : `${who} tried to ${verb} ${what} — failed (${status})`,
      before,
      after,
      metadata: {
        ...(info.parent ? { parent: info.parent } : {}),
        ...(label ? { label } : {}),
        ...(outcome === "failure"
          ? { request: req.body, error: typeof captured?.error === "string" ? captured.error : undefined }
          : {}),
      },
    };

    Promise.race([insertAudit(entry), new Promise((resolve) => setTimeout(resolve, WRITE_TIMEOUT_MS))]).finally(() =>
      originalEnd(...args)
    );
    return res;
  };

  next();
}
