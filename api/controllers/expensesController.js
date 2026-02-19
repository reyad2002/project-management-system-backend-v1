import { supabaseAdmin } from "../../db_connection.js";

const table = "expenses";
const projectsTable = "projects";
const expenseTypes = ["direct", "operational"];
export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { type, q, from_date, to_date, page = "1", limit = "20" } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    // type filter
    if (type && String(type).trim()) {
      const t = String(type).trim();
      const allowed = ["direct", "operational"];
      if (!allowed.includes(t)) {
        return res.status(400).json({ error: "Invalid type (direct | operational)" });
      }
      query = query.eq("type", t);
    }

    // optional date range
    if (from_date) query = query.gte("expense_date", from_date);
    if (to_date) query = query.lte("expense_date", to_date);

    // optional search on title/description
    if (q && String(q).trim()) {
      const term = String(q).trim();
      query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      expenses: data || [],
      pagination: { page: pageNum, limit: limitNum, total: count ?? 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(err.code === "PGRST116" ? 404 : 500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const {  amount, expense_date, title, description, type } = req.body;

    // validate amount
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    if (!type) {
      return res.status(400).json({ error: "type is required" });
    }

    // validate type (recommended)
    if (type != null && !expenseTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid type (direct | operational)" });
    }

    // validate title (recommended)
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const payload = {
      company_id: companyId,
      amount: amt,
      expense_date: expense_date ?? new Date().toISOString().slice(0, 10), // default today YYYY-MM-DD
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      type: type ?? expenseTypes[0], // default if you want
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

    const { amount, expense_date, title, description, type } = req.body;

    // validate amount only if provided
    let cleanAmount;
    if (amount !== undefined) {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return res.status(400).json({ error: "amount must be a positive number" });
      }
      cleanAmount = amt;
    }

    // validate type only if provided
    const allowedTypes = ["direct", "operational"];
    if (type !== undefined && type !== null) {
      const t = String(type).trim();
      if (!allowedTypes.includes(t)) {
        return res.status(400).json({ error: "Invalid type (direct | operational)" });
      }
    }

    const payload = {
      ...(cleanAmount !== undefined ? { amount: cleanAmount } : {}),
      ...(expense_date !== undefined ? { expense_date } : {}),
      ...(title !== undefined ? { title: title ? String(title).trim() : null } : {}),
      ...(description !== undefined
        ? { description: description ? String(description).trim() : null }
        : {}),
      ...(type !== undefined ? { type: type ? String(type).trim() : null } : {}),
      
    };

    const clean = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined)
    );

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

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
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
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
