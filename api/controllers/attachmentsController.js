import { supabaseAdmin } from "../../db_connection.js";

const table = "attachments";

export async function list(req, res) {
  try {
    const { company_id, entity_type, entity_id } = req.query;
    let q = supabaseAdmin.from(table).select("*").order("created_at", { ascending: false });
    if (company_id) q = q.eq("company_id", company_id);
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
    const { data, error } = await supabaseAdmin.from(table).select("*").eq("id", req.params.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(err.code === "PGRST116" ? 404 : 500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const { company_id, entity_type, entity_id, file_name, file_url } = req.body;
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({ company_id, entity_type, entity_id, file_name, file_url })
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
    const { company_id, entity_type, entity_id, file_name, file_url } = req.body;
    const payload = { company_id, entity_type, entity_id, file_name, file_url };
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
    const { data, error } = await supabaseAdmin.from(table).update(clean).eq("id", req.params.id).select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const { error } = await supabaseAdmin.from(table).delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
