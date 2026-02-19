import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const supabaseAdmin =
  url && key
    ? createClient(url, key, { auth: { persistSession: false } })
    : null;

export async function verifySupabaseConnection() {
  if (!url || !key) {
    return { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }
  if (!supabaseAdmin) {
    return { ok: false, error: "Supabase client not initialized" };
  }
  try {
    const { error } = await supabaseAdmin.auth.getSession();
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? "Supabase request failed" };
  }
}