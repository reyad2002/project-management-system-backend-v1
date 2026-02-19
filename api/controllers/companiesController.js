import { supabaseAdmin } from "../../db_connection.js";
import bcrypt from "bcryptjs";

const table = "company";
const usersTable = "users";
const userSelectFields =
  "id, created_at, name, email, status, company_id, company(name)";
const statuses = ["active", "inactive", "pending", "blocked"];

export async function list(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res
      .status(err.code === "PGRST116" ? 404 : 500)
      .json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const { name, slug } = req.body;
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({ name, slug })
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
    const { name, slug } = req.body;
    const { data, error } = await supabaseAdmin
      .from(table)
      .update({ name, slug })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Company users (scoped by company id) ---

export async function listUsers(req, res) {
  try {
    const companyId = req.params.id;
    const { data, error } = await supabaseAdmin
      .from(usersTable)
      .select(userSelectFields)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getUser(req, res) {
  try {
    const { id: companyId, userId } = req.params;
    const { data, error } = await supabaseAdmin
      .from(usersTable)
      .select(userSelectFields)
      .eq("id", userId)
      .eq("company_id", companyId)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res
      .status(err.code === "PGRST116" ? 404 : 500)
      .json({ error: err.message });
  }
}

export async function createUser(req, res) {
  try {
    const companyId = req.params.id;
    const { name, email, password, status } = req.body;

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ error: "Missing required fields: name, email, password" });
    }

    if (status && !statuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const cleanName = String(name).trim();

    const { data: existing, error: checkError } = await supabaseAdmin
      .from(usersTable)
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (checkError) throw checkError;
    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const payload = {
      name: cleanName,
      email: normalizedEmail,
      password: hashedPassword,
      company_id: companyId,
      ...(status ? { status } : {}),
    };

    const { data, error } = await supabaseAdmin
      .from(usersTable)
      .insert(payload)
      .select(userSelectFields)
      .single();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Email already registered" });
      }
      throw error;
    }
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateUser(req, res) {
  try {
    const { id: companyId, userId } = req.params;
    const { name, email, status } = req.body;

    if (name == null && email == null && status == null) {
      return res.status(400).json({ error: "No fields to update" });
    }
    if (status != null && !statuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const normalizedEmail =
      email != null ? String(email).trim().toLowerCase() : null;

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(usersTable)
      .select("id, email, company_id")
      .eq("id", userId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }

    if (normalizedEmail && normalizedEmail !== existing.email) {
      const { data: emailTaken, error: emailErr } = await supabaseAdmin
        .from(usersTable)
        .select("id")
        .eq("email", normalizedEmail)
        .neq("id", userId)
        .maybeSingle();
      if (emailErr) throw emailErr;
      if (emailTaken) {
        return res.status(409).json({ error: "Email already registered" });
      }
    }

    const updatePayload = {};
    if (name != null) updatePayload.name = String(name).trim();
    if (normalizedEmail != null) updatePayload.email = normalizedEmail;
    if (status != null) updatePayload.status = status;

    const { data, error } = await supabaseAdmin
      .from(usersTable)
      .update(updatePayload)
      .eq("id", userId)
      .eq("company_id", companyId)
      .select(userSelectFields)
      .single();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Email already registered" });
      }
      throw error;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteUser(req, res) {
  try {
    const { id: companyId, userId } = req.params;

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(usersTable)
      .select("id")
      .eq("id", userId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }

    const { error } = await supabaseAdmin
      .from(usersTable)
      .delete()
      .eq("id", userId)
      .eq("company_id", companyId);
    if (error) throw error;
    res.status(200).json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateUserStatus(req, res) {
  try {
    const { id: companyId, userId } = req.params;
    const { status } = req.body;

    if (!status || !statuses.includes(status)) {
      return res.status(400).json({ error: "Invalid or missing status" });
    }

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(usersTable)
      .select("id")
      .eq("id", userId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }

    const { data, error } = await supabaseAdmin
      .from(usersTable)
      .update({ status })
      .eq("id", userId)
      .eq("company_id", companyId)
      .select(userSelectFields)
      .single();
    if (error) throw error;
    res.json({ message: "Status updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateUserPassword(req, res) {
  try {
    const { id: companyId, userId } = req.params;
    const { password } = req.body;

    if (!password) {
      return res
        .status(400)
        .json({ error: "Missing required field: password" });
    }

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(usersTable)
      .select("id")
      .eq("id", userId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const { data, error } = await supabaseAdmin
      .from(usersTable)
      .update({ password: hashedPassword })
      .eq("id", userId)
      .eq("company_id", companyId)
      .select(userSelectFields)
      .single();
    if (error) throw error;
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
