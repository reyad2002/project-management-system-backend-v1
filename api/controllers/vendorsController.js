import { supabaseAdmin } from "../../db_connection.js";

const table = "vendors";
const vendorBillsTable = "vendor_bills";

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { q, page = "1", limit = "20" } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (q && String(q).trim()) {
      const term = String(q).trim();
      query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      vendors: data || [],
      pagination: { page: pageNum, limit: limitNum, total: count ?? 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function shortList(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;

    return res.json({ vendors: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id || req.user?.sub;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const { name, tax_id, email, phone, address, default_wht_rate, notes } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Vendor name is required" });
    }

    let whtRate = 0;
    if (default_wht_rate !== undefined && default_wht_rate !== null) {
      whtRate = Number(default_wht_rate);
      if (!Number.isFinite(whtRate) || whtRate < 0) {
        return res.status(400).json({ error: "default_wht_rate must be a non-negative number" });
      }
    }

    const payload = {
      company_id: companyId,
      name: String(name).trim(),
      tax_id: tax_id ? String(tax_id).trim() : null,
      email: email ? String(email).trim().toLowerCase() : null,
      phone: phone ? String(phone).trim() : null,
      address: address ? String(address).trim() : null,
      default_wht_rate: whtRate,
      notes: notes ? String(notes).trim() : null,
      created_by: userId,
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
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
    const id = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    if (!id) return res.status(400).json({ error: "Missing id" });

    const { name, tax_id, email, phone, address, default_wht_rate, notes } = req.body;

    if (default_wht_rate !== undefined && default_wht_rate !== null) {
      const w = Number(default_wht_rate);
      if (!Number.isFinite(w) || w < 0) {
        return res.status(400).json({ error: "default_wht_rate must be a non-negative number" });
      }
    }

    const payload = {
      ...(name !== undefined ? { name: name ? String(name).trim() : null } : {}),
      ...(tax_id !== undefined ? { tax_id: tax_id ? String(tax_id).trim() : null } : {}),
      ...(email !== undefined ? { email: email ? String(email).trim().toLowerCase() : null } : {}),
      ...(phone !== undefined ? { phone: phone ? String(phone).trim() : null } : {}),
      ...(address !== undefined ? { address: address ? String(address).trim() : null } : {}),
      ...(default_wht_rate !== undefined ? { default_wht_rate: Number(default_wht_rate) } : {}),
      ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
    };

    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(clean)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { count, error: countErr } = await supabaseAdmin
      .from(vendorBillsTable)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("vendor_id", id);
    if (countErr) throw countErr;
    if ((count ?? 0) > 0) {
      return res.status(409).json({ error: "Cannot delete vendor with existing bills" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", id)
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
