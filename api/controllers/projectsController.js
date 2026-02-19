import { supabaseAdmin } from "../../db_connection.js";

const table = "projects";

const statuses = ["draft", "active", "on_hold", "cancelled", "completed"];
export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const {
      client_id,
      status,
      q, // search term
      page = "1",
      limit = "20",
    } = req.query;

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

    // if you have soft delete:
    // query = query.is("deleted_at", null);

    if (client_id) query = query.eq("client_id", client_id);

    // validate & filter status
    if (status) {
      const allowedStatuses = [
        "draft",
        "active",
        "on_hold",
        "done",
        "cancelled",
      ];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      query = query.eq("status", status);
    }

    // optional search on title/details
    if (q && String(q).trim()) {
      const term = String(q).trim();
      query = query.or(`title.ilike.%${term}%,details.ilike.%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      projects: data || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count ?? 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function shortList(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, title")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return res.json({
      projects: data || [],
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
    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId) // 🔒 important
      // .is("deleted_at", null)    // لو عندك soft delete
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id || req.user?.sub;

    if (!companyId || !userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { client_id, title, details, start_date, due_date, price, status } =
      req.body;

    if (!client_id || !title || !String(title).trim()) {
      return res
        .status(400)
        .json({ error: "client_id and title are required" });
    }

    if (status != null && !statuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const { data: client, error: clientErr } = await supabaseAdmin
      .from("clients")
      .select("id")
      .eq("id", client_id)
      .eq("company_id", companyId)
      // .is("deleted_at", null)
      .maybeSingle();

    if (clientErr) throw clientErr;
    if (!client) {
      return res
        .status(400)
        .json({ error: "Invalid client_id for this company" });
    }
    if (start_date && due_date && new Date(due_date) < new Date(start_date)) {
      return res
        .status(400)
        .json({ error: "due_date must be after start_date" });
    }
    const payload = {
      company_id: companyId,
      client_id,
      title: String(title).trim(),
      details: details ? String(details).trim() : null,
      start_date: start_date ?? null,
      due_date: due_date ?? null,
      price: price ?? null,
      status: status ?? "active",
      created_by: userId,
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select(
        "id, created_at, company_id, client_id, title, details, start_date, due_date, price, status, created_by",
      )
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
    const userId = req.user?.id || req.user?.sub;
    const id = req.params.id;

    if (!companyId || !userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const { client_id, title, details, start_date, due_date, price, status } =
      req.body;

    // at least one field
    if (
      client_id == null &&
      title == null &&
      details == null &&
      start_date == null &&
      due_date == null &&
      price == null &&
      status == null
    ) {
      return res.status(400).json({ error: "No fields to update" });
    }

    // validate status if provided
    const allowedStatuses = ["draft", "active", "on_hold", "done", "cancelled"];
    if (status != null && !allowedStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // optional: validate dates
    if (start_date && due_date) {
      const sd = new Date(start_date);
      const dd = new Date(due_date);
      if (
        !Number.isNaN(sd.valueOf()) &&
        !Number.isNaN(dd.valueOf()) &&
        dd < sd
      ) {
        return res
          .status(400)
          .json({ error: "due_date must be after start_date" });
      }
    }

    // If client_id is provided, ensure it's inside same company
    if (client_id != null) {
      const { data: client, error: clientErr } = await supabaseAdmin
        .from("clients")
        .select("id")
        .eq("id", client_id)
        .eq("company_id", companyId)
        .maybeSingle();

      if (clientErr) throw clientErr;
      if (!client) {
        return res
          .status(400)
          .json({ error: "Invalid client_id for this company" });
      }
    }

    // build update payload (NO company_id / created_by allowed)
    const payload = {
      client_id,
      title: title != null ? String(title).trim() : undefined,
      details: details != null ? String(details).trim() : undefined,
      start_date,
      due_date,
      price,
      status,
    };

    const clean = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(clean)
      .eq("id", id)
      .eq("company_id", companyId) // 🔒 scope
      // .is("deleted_at", null)    // لو عندك soft delete
      .select("*")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }

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

    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", id)
      .eq("company_id", companyId) // 🔒 prevent cross-company delete
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.status(204).send(); // No Content
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
