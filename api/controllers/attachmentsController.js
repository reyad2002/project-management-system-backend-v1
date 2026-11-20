import { supabaseAdmin } from "../../db_connection.js";

const table = "attachments";

// Every query is limited to the caller's company: this router used to trust a company_id sent by
// the client, which let any signed-in user read or change another company's rows.
const companyOf = (req) => req.user?.company_id;

export async function list(req, res) {
  try {
    const { entity_type, entity_id } = req.query;
    let q = supabaseAdmin.from(table).select("*").eq("company_id", companyOf(req)).order("created_at", { ascending: false });
    if (entity_type) q = q.eq("entity_type", entity_type);
    if (entity_id) q = q.eq("entity_id", entity_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const { data, error } = await supabaseAdmin.from(table).select("*").eq("id", req.params.id).eq("company_id", companyOf(req)).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const { entity_type, entity_id, file_name, file_url } = req.body;
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({ company_id: companyOf(req), entity_type, entity_id, file_name, file_url })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const { entity_type, entity_id, file_name, file_url } = req.body;
    const clean = Object.fromEntries(Object.entries({ entity_type, entity_id, file_name, file_url }).filter(([, v]) => v !== undefined));
    const { data, error } = await supabaseAdmin
      .from(table)
      .update(clean)
      .eq("id", req.params.id)
      .eq("company_id", companyOf(req))
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", req.params.id)
      .eq("company_id", companyOf(req))
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
