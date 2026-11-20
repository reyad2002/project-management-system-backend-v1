import { supabaseAdmin } from "../../db_connection.js";

const table = "saved_filters";

/** The pages that can save filters. A new list page adds its key here. */
export const FILTER_PAGES = ["tasks", "projects", "invoices", "payments", "expenses", "clients"];
const MAX_PER_PAGE = 30;
const MAX_PARAMS_BYTES = 2000;

/** Params are a flat bag of strings / numbers / booleans (a page's filter values). Returns { error } or { value }. */
export function normalizeParams(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "params must be an object" };
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) return { error: `Invalid filter name "${key}"` };
    if (typeof value === "string") {
      if (value.length > 200) return { error: `Filter "${key}" is too long` };
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "boolean") out[key] = value;
    else if (value === null || value === undefined) continue;
    else return { error: `Filter "${key}" must be text, a number or true/false` };
  }
  if (Object.keys(out).length === 0) return { error: "Set at least one filter before saving" };
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_PARAMS_BYTES) return { error: "Too many filters to save" };
  return { value: out };
}

/** GET /api/saved-filters?page=tasks — the caller's own saved filters for one page. */
export async function list(req, res) {
  try {
    const page = req.query.page;
    if (!FILTER_PAGES.includes(page)) return res.status(400).json({ error: "Unknown page" });
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, name, params, created_at")
      .eq("user_id", req.user.id)
      .eq("company_id", req.user.company_id)
      .eq("page", page)
      .order("name", { ascending: true });
    if (error) throw error;
    return res.json({ filters: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** POST /api/saved-filters { page, name, params } */
export async function create(req, res) {
  try {
    const { page, name: rawName, params } = req.body ?? {};
    if (!FILTER_PAGES.includes(page)) return res.status(400).json({ error: "Unknown page" });
    const name = String(rawName ?? "").trim();
    if (!name) return res.status(400).json({ error: "Give the saved filter a name" });
    if (name.length > 60) return res.status(400).json({ error: "Name is too long (max 60)" });
    const parsed = normalizeParams(params);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { count, error: countError } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("user_id", req.user.id)
      .eq("page", page);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_PER_PAGE) return res.status(400).json({ error: `You can save at most ${MAX_PER_PAGE} filters per page` });

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({ company_id: req.user.company_id, user_id: req.user.id, page, name, params: parsed.value })
      .select("id, name, params, created_at")
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: `You already saved a filter called "${name}"` });
      throw error;
    }
    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** DELETE /api/saved-filters/:id — only your own. */
export async function remove(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .eq("company_id", req.user.company_id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
