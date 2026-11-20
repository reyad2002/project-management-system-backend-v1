import { supabaseAdmin } from "../../db_connection.js";
import { loadClientHealth } from "../lib/clientHealth.js";
import { canSeeAllTasks } from "../lib/tasks.js";

const table = "client_contacts";
export const CONTACT_KINDS = ["call", "whatsapp", "email", "meeting", "visit", "other"];

/** GET /api/clients/health[?client_id=] — every client with a score and the reasons, worst first (finance roles). */
export async function health(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    const result = await loadClientHealth(companyId, { clientId: req.query.client_id || null });
    const counts = { healthy: 0, watch: 0, at_risk: 0 };
    for (const c of result.clients) counts[c.level] += 1;
    return res.json({ ...result, counts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function ownClient(companyId, clientId) {
  const { data, error } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  return data;
}

/** GET /api/client-contacts?client_id= — the contact log of one client, newest first. */
export async function listContacts(req, res) {
  try {
    const companyId = req.user.company_id;
    const clientId = req.query.client_id;
    if (!clientId) return res.status(400).json({ error: "client_id is required" });
    if (!(await ownClient(companyId, clientId))) return res.status(404).json({ error: "Client not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, client_id, user_id, kind, note, contacted_at")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("contacted_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const ids = [...new Set((data || []).map((c) => c.user_id).filter(Boolean))];
    const { data: users, error: usersError } = ids.length ? await supabaseAdmin.from("users").select("id, name").in("id", ids) : { data: [], error: null };
    if (usersError) throw usersError;
    const nameOf = Object.fromEntries((users || []).map((u) => [String(u.id), u.name]));
    return res.json({ contacts: (data || []).map((c) => ({ ...c, user_name: c.user_id ? nameOf[String(c.user_id)] ?? null : null })) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** POST /api/client-contacts { client_id, kind?, note?, contacted_at? } */
export async function createContact(req, res) {
  try {
    const companyId = req.user.company_id;
    const { client_id: clientId, kind = "call", note, contacted_at: contactedAt } = req.body ?? {};
    if (!clientId) return res.status(400).json({ error: "client_id is required" });
    if (!CONTACT_KINDS.includes(kind)) return res.status(400).json({ error: "Invalid kind" });
    const text = note ? String(note).trim() : "";
    if (text.length > 1000) return res.status(400).json({ error: "Note is too long (max 1000 characters)" });

    let when = new Date();
    if (contactedAt) {
      when = new Date(contactedAt);
      if (Number.isNaN(when.getTime())) return res.status(400).json({ error: "contacted_at must be a date" });
      if (when.getTime() > Date.now() + 5 * 60_000) return res.status(400).json({ error: "A contact can't be in the future" });
    }
    if (!(await ownClient(companyId, clientId))) return res.status(404).json({ error: "Client not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({ company_id: companyId, client_id: clientId, user_id: req.user.id, kind, note: text || null, contacted_at: when.toISOString() })
      .select("id, client_id, user_id, kind, note, contacted_at")
      .single();
    if (error) throw error;
    return res.status(201).json({ ...data, user_name: req.user.name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** DELETE /api/client-contacts/:id — whoever logged it, or a manager and above. */
export async function removeContact(req, res) {
  try {
    const companyId = req.user.company_id;
    const { data: row, error } = await supabaseAdmin.from(table).select("id, user_id").eq("id", req.params.id).eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: "Not found" });
    if (String(row.user_id) !== String(req.user.id) && !canSeeAllTasks(req.user)) return res.status(403).json({ error: "You can only delete contacts you logged" });
    const { error: deleteError } = await supabaseAdmin.from(table).delete().eq("id", row.id).eq("company_id", companyId);
    if (deleteError) throw deleteError;
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
