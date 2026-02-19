// import { supabaseAdmin } from "../../db_connection.js";
// import bcrypt from "bcryptjs";

// const table = "users";
// const selectFields =
//   "id, created_at, name, email, status, company_id, company(name)";
// const statuses = ["active", "inactive", "pending", "blocked"];

// // create a new user
// export async function create(req, res) {
//   try {
//     const { name, email, password, status } = req.body;
//     const company_id = req.params.company_id;

//     if (!company_id) {
//       return res.status(400).json({ error: "company_id is required" });
//     }

//     if (!name || !email || !password) {
//       return res.status(400).json({ error: "Missing required fields" });
//     }

//     if (status != null && !statuses.includes(status)) {
//       return res.status(400).json({ error: "Invalid status" });
//     }

//     // normalize inputs
//     const normalizedEmail = String(email).trim().toLowerCase();
//     const cleanName = String(name).trim();

//     // ✅ check if email already exists (global uniqueness)
//     const { data: existing, error: checkError } = await supabaseAdmin
//       .from(table)
//       .select("id")
//       .eq("email", normalizedEmail)
//       .maybeSingle();

//     if (checkError) throw checkError;

//     if (existing) {
//       return res.status(409).json({ error: "Email already registered" });
//     }

//     const hashedPassword = await bcrypt.hash(password, 10);

//     const payload = {
//       name: cleanName,
//       email: normalizedEmail, // ✅ store normalized
//       password: hashedPassword,
//       company_id, // ✅ required
//       ...(status ? { status } : {}),
//     };

//     const { data, error } = await supabaseAdmin
//       .from(table)
//       .insert(payload)
//       .select(selectFields)
//       .single();

//     if (error) {
//       // if you added UNIQUE constraint in DB
//       if (error.code === "23505") {
//         return res.status(409).json({ error: "Email already registered" });
//       }
//       throw error;
//     }

//     return res.status(201).json(data);
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// }

// // update user (name, email, status) within a company scope
// export async function update(req, res) {
//   try {
//     const { id, company_id } = req.params;

//     if (!company_id || !id) {
//       return res.status(400).json({ error: "Missing required fields" });
//     }

//     const { name, email, status } = req.body;

//     // allow partial updates, but at least one field must be provided
//     if (name == null && email == null && status == null) {
//       return res.status(400).json({ error: "No fields to update" });
//     }

//     // validate status if provided
//     if (status != null && !statuses.includes(status)) {
//       return res.status(400).json({ error: "Invalid status" });
//     }

//     // normalize email if provided
//     const normalizedEmail =
//       email != null ? String(email).trim().toLowerCase() : null;

//     // 1) ensure user exists AND belongs to the same company
//     const { data: existing, error: existingErr } = await supabaseAdmin
//       .from(table)
//       .select("id, email, company_id")
//       .eq("id", id)
//       .eq("company_id", company_id)
//       .maybeSingle();

//     if (existingErr) throw existingErr;

//     if (!existing) {
//       return res.status(404).json({ error: "User not found" });
//     }

//     // 2) if email is changing, prevent duplicates
//     if (normalizedEmail && normalizedEmail !== existing.email) {
//       const { data: emailTaken, error: emailErr } = await supabaseAdmin
//         .from(table)
//         .select("id")
//         .eq("email", normalizedEmail)
//         .neq("id", id)
//         .maybeSingle();

//       if (emailErr) throw emailErr;

//       if (emailTaken) {
//         return res.status(409).json({ error: "Email already registered" });
//       }
//     }

//     // 3) build update payload (never allow changing company_id from request)
//     const updatePayload = {};
//     if (name != null) updatePayload.name = String(name).trim();
//     if (normalizedEmail != null) updatePayload.email = normalizedEmail;
//     if (status != null) updatePayload.status = status;

//     const { data, error } = await supabaseAdmin
//       .from(table)
//       .update(updatePayload)
//       .eq("id", id)
//       .eq("company_id", company_id)
//       .select(selectFields)
//       .single();

//     if (error) {
//       // if you added UNIQUE constraint on email, handle it nicely
//       if (error.code === "23505") {
//         return res.status(409).json({ error: "Email already registered" });
//       }
//       throw error;
//     }

//     return res.json(data);
//   } catch (err) {
//     return res.status(500).json({ error: err.message });
//   }
// }

// //update status of a user
// export async function updateStatus(req, res) {
//   try {
//     const id = req.params.id;
//     if (!id) return res.status(400).json({ error: "Missing required fields" });
//     const { data: existing } = await supabaseAdmin
//       .from(table)
//       .select("id")
//       .eq("id", id)
//       .single();
//     if (!existing) return res.status(404).json({ error: "Not found" });
//     const { status } = req.body;
//     if (status && !statuses.includes(status)) {
//       return res.status(400).json({ error: "Invalid status" });
//     }
//     const updatePayload = { status };
//     const { data, error } = await supabaseAdmin
//       .from(table)
//       .update(updatePayload)
//       .eq("id", id)
//       .select(selectFields)
//       .single();
//     if (error) throw error;
//     if (!data) return res.status(404).json({ error: "Not found" });
//     res.json(data);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// }
// // update password of a user
// export async function updatePassword(req, res) {
//   try {
//     const id = req.params.id;
//     if (!id) return res.status(400).json({ error: "Missing required fields" });
//     const { data: existing } = await supabaseAdmin
//       .from(table)
//       .select("id")
//       .eq("id", id)
//       .single();
//     if (!existing) return res.status(404).json({ error: "Not found" });
//     const { password } = req.body;
//     if (!password)
//       return res.status(400).json({ error: "Missing required fields" });
//     const hashedPassword = await bcrypt.hash(password, 10);
//     const updatePayload = { password: hashedPassword };
//     const { data, error } = await supabaseAdmin
//       .from(table)
//       .update(updatePayload)
//       .eq("id", id)
//       .select(selectFields)
//       .single();
//     if (error) throw error;
//     if (!data) return res.status(404).json({ error: "Not found" });
//     res.json(data);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// }

// //remove a user
// export async function remove(req, res) {
//   try {
//     const id = req.params.id;
//     if (!id) return res.status(400).json({ error: "Missing required fields" });
//     const { data: existing } = await supabaseAdmin
//       .from(table)
//       .select("id")
//       .eq("id", id)
//       .single();
//     if (!existing) return res.status(404).json({ error: "Not found" });
//     const { error } = await supabaseAdmin.from(table).delete().eq("id", id);
//     if (error) throw error;
//     res.status(204).send();
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// }
