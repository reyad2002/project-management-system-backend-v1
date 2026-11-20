import { supabaseAdmin } from "../../db_connection.js";

/** Categories that are cash going out but not part of profit (advances to staff, equipment purchases). */
export const NON_PNL_CATEGORIES = ["advance", "equipment"];

/** PostgREST returns at most 1000 rows per request; page through so a busy company isn't silently cut off. */
export async function selectAll(buildQuery, { pageSize = 1000, maxPages = 50 } = {}) {
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

/** `in (...)` lists can't be endless in a URL: read them in chunks. */
export async function selectIn(table, columns, column, values, build = (q) => q, { chunk = 150 } = {}) {
  const out = [];
  for (let i = 0; i < values.length; i += chunk) {
    const slice = values.slice(i, i + chunk);
    const rows = await selectAll(() => build(supabaseAdmin.from(table).select(columns).in(column, slice)).order("id", { ascending: true }));
    out.push(...rows);
  }
  return out;
}

/** Ids of the company's test/demo projects: their payments and costs never count in any report. */
export async function testProjectIds(companyId) {
  const { data, error } = await supabaseAdmin.from("projects").select("id").eq("company_id", companyId).eq("is_test", true);
  if (error) throw error;
  return (data || []).map((p) => p.id);
}

export const round2 = (n) => Math.round(n * 100) / 100;
export const round1 = (n) => Math.round(n * 10) / 10;

// ---- dates (YYYY-MM-DD, UTC)
const DAY_MS = 86_400_000;
export const parseDate = (s) => new Date(`${s}T00:00:00Z`);
export const fmtDate = (d) => d.toISOString().slice(0, 10);
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const addDays = (s, n) => fmtDate(new Date(parseDate(s).getTime() + n * DAY_MS));
export const daysBetween = (a, b) => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);

/** Add whole months, keeping the day (clamped to the month's length: Jan 31 + 1 month = Feb 28). */
export function addMonths(dateStr, n) {
  const d = parseDate(dateStr);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return fmtDate(target);
}
