import { supabaseAdmin } from "../../db_connection.js";

const table = "clients";

export async function list(req, res) {
  try {
    // ✅ company scope from JWT (set by auth middleware)
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const {  q, page = "1", limit = "20" } = req.query;

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

    // optional search by name/email
    if (q && String(q).trim()) {
      const term = String(q).trim();
      query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      clients: data || [],
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
      .select("id, name")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.json({
      clients: data || [],
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
      .eq("company_id", companyId)
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

/**
 * GET /api/clients/:id/payment-summary
 * Returns for the client: total amount to pay (sum of project prices), amount paid, and remaining.
 */
export async function getPaymentSummary(req, res) {
  try {
    const companyId = req.user?.company_id;
    const clientId = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!clientId) {
      return res.status(400).json({ error: "Missing client id" });
    }

    // Ensure client exists and belongs to company
    const { data: client, error: clientErr } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .maybeSingle();

    if (clientErr) throw clientErr;
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    // All projects for this client (id, price)
    const { data: projects, error: projectsErr } = await supabaseAdmin
      .from("projects")
      .select("id, price")
      .eq("company_id", companyId)
      .eq("client_id", clientId);

    if (projectsErr) throw projectsErr;
    const projectList = projects ?? [];
    const projectIds = projectList.map((p) => p.id);

    const totalAmountToPay = projectList.reduce(
      (sum, p) => sum + Number(p.price ?? 0),
      0
    );

    let amountPaid = 0;
    if (projectIds.length > 0) {
      const { data: payments, error: paymentsErr } = await supabaseAdmin
        .from("payments")
        .select("amount")
        .eq("company_id", companyId)
        .in("project_id", projectIds);

      if (paymentsErr) throw paymentsErr;
      amountPaid = (payments ?? []).reduce(
        (sum, r) => sum + Number(r.amount ?? 0),
        0
      );
    }

    const remaining = Math.round((totalAmountToPay - amountPaid) * 100) / 100;
    const roundedTotal = Math.round(totalAmountToPay * 100) / 100;
    const roundedPaid = Math.round(amountPaid * 100) / 100;

    return res.json({
      client_id: clientId,
      total_amount_to_pay: roundedTotal,
      amount_paid: roundedPaid,
      remaining,
    });
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

    const { name, email, phone, address, notes, feedback } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Client name is required" });
    }

    const payload = {
      company_id: companyId,
      name: String(name).trim(),
      phone: phone ? String(phone).trim() : null,
      address: address ? String(address).trim() : null,
      notes: notes ? String(notes).trim() : null,
      feedback: feedback ? String(feedback).trim() : null,
      created_by: userId,
    };

    // normalize email (optional)
    if (email && String(email).trim()) {
      payload.email = String(email).trim().toLowerCase();
    }

    // ✅ optional: prevent duplicate email inside same company
    if (payload.email) {
      const { data: existing, error: checkErr } = await supabaseAdmin
        .from(table)
        .select("id")
        .eq("company_id", companyId)
        .eq("email", payload.email)
        .maybeSingle();

      if (checkErr) throw checkErr;
      if (existing) {
        return res.status(409).json({ error: "Client email already exists" });
      }
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select("id, created_at, name, email, phone, address, notes, feedback, company_id, created_by")
      .single();

    if (error) {
      // if you added unique constraint
      if (error.code === "23505") {
        return res.status(409).json({ error: "Client email already exists" });
      }
      throw error;
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    if (!id) {
      return res.status(400).json({ error: "Missing id" });
    }

    const { name, email, phone, address, notes, feedback } = req.body;

    // build payload (no company_id / created_by allowed)
    const payload = {
      name: name?.trim(),
      email: email?.trim().toLowerCase(),
      phone: phone?.trim(),
      address: address?.trim(),
      notes: notes?.trim(),
      feedback: feedback?.trim()
    };

    // remove undefined / null / empty fields
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
      .eq("company_id", companyId) // 🔒 important
      .select("*")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json(data);

  } catch (err) {
    // handle unique email constraint if exists
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email already exists" });
    }

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

    if (!data) {
      return res.status(404).json({ error: "Not found" });
    }

    return res.json({ message: "Client deleted successfully" });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
