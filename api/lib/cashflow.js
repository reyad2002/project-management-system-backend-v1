import { supabaseAdmin } from "../../db_connection.js";
import { NON_PNL_CATEGORIES, addDays, addMonths, fmtDate, round2, selectAll, testProjectIds, todayStr } from "./db.js";

/**
 * Cash-flow forecast: what is likely to come in and go out over the next 30 / 60 / 90 days.
 *
 * Coming in:  unpaid invoices on their due date (overdue ones are assumed to arrive LATE_RECEIVABLE_DELAY days
 *             from today, and are flagged), and client renewals (recurring revenue).
 * Going out:  supplier bills on their due date (overdue = pay now), subscriptions, and two ESTIMATES from the
 *             last three months: salaries (on the usual pay day) and other running costs (on the 1st).
 * Everything that is a guess is marked, and the assumptions are listed on the page, so nobody mistakes
 * a forecast for a promise.
 */
export const LATE_RECEIVABLE_DELAY_DAYS = 14;
export const DEFAULT_PAYDAY = 28;
const HORIZONS = [30, 60, 90];

function nextCycle(date, cycle) {
  return addMonths(date, cycle === "yearly" ? 12 : 1);
}

/** Dates a recurring item falls on within [today, end]; a lapsed one is returned once, flagged late. */
export function occurrences(nextDate, cycle, today, end, lateDelay) {
  const out = [];
  let d = nextDate;
  if (d < today) {
    out.push({ date: lateDelay === 0 ? today : addDays(today, lateDelay), late: true });
    while (d < today) d = nextCycle(d, cycle); // then carry on from the next real cycle
  }
  for (let i = 0; d <= end && i < 60; i += 1) {
    out.push({ date: d, late: false });
    d = nextCycle(d, cycle);
  }
  return out.filter((o) => o.date <= end);
}

/** The day of each month's payday between today and end. */
function monthlyDates(day, today, end) {
  const dates = [];
  let cursor = `${today.slice(0, 7)}-01`;
  for (let i = 0; i < 6; i += 1) {
    const [y, m] = cursor.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const date = fmtDate(new Date(Date.UTC(y, m - 1, Math.min(day, last))));
    if (date >= today && date <= end) dates.push(date);
    cursor = addMonths(cursor, 1);
  }
  return dates;
}

export function buildCashflow({ today, days = 90, opening = 0, receivables = [], payables = [], renewals = [], subscriptions = [], salary = null, opex = null }) {
  const end = addDays(today, days - 1);
  const events = [];
  let overdueBeyondHorizon = 0;

  for (const r of receivables) {
    const amount = Number(r.remaining_amount);
    if (!(amount > 0)) continue;
    const late = r.due_date < today;
    const date = late ? addDays(today, LATE_RECEIVABLE_DELAY_DAYS) : r.due_date;
    if (date > end) {
      if (late) overdueBeyondHorizon += amount;
      continue;
    }
    events.push({ date, amount, kind: "invoice", label: `${r.client_name ?? "Client"} · ${r.invoice_number}`, late });
  }
  for (const r of renewals) {
    for (const o of occurrences(r.next_renewal_date, r.billing_cycle, today, end, LATE_RECEIVABLE_DELAY_DAYS)) {
      events.push({ date: o.date, amount: Number(r.amount), kind: "renewal", label: `${r.client_name ?? "Client"} · ${r.type ?? "recurring"}`, late: o.late });
    }
  }
  for (const p of payables) {
    const amount = Number(p.remaining_amount);
    if (!(amount > 0)) continue;
    const late = p.due_date < today;
    const date = late ? today : p.due_date;
    if (date <= end) events.push({ date, amount: -amount, kind: "bill", label: `${p.vendor_name ?? "Vendor"} · ${p.bill_number}`, late });
  }
  for (const s of subscriptions) {
    for (const o of occurrences(s.next_due_date, s.billing_cycle, today, end, 0)) {
      events.push({ date: o.date, amount: -Number(s.amount), kind: "subscription", label: s.name, late: o.late });
    }
  }
  if (salary && salary.monthlyAverage > 0) {
    for (const date of monthlyDates(salary.dayOfMonth ?? DEFAULT_PAYDAY, today, end)) {
      events.push({ date, amount: -salary.monthlyAverage, kind: "salary", label: "Salaries (estimate)", estimate: true });
    }
  }
  if (opex && opex.monthlyAverage > 0) {
    for (const date of monthlyDates(1, today, end)) {
      events.push({ date, amount: -opex.monthlyAverage, kind: "running_costs", label: "Running costs (estimate)", estimate: true });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  // daily running balance -> weekly buckets, lowest point, windows
  // Money in and money out of the same day are kept apart (a day with +5000 and -3000 is not "+2000" in the charts).
  const inByDay = new Map();
  const outByDay = new Map();
  for (const e of events) {
    const target = e.amount > 0 ? inByDay : outByDay;
    target.set(e.date, (target.get(e.date) ?? 0) + Math.abs(e.amount));
  }
  let balance = Number(opening) || 0;
  let lowest = { balance, date: today };
  let firstNegativeDate = balance < 0 ? today : null;
  const weeks = [];
  for (let i = 0; i < Math.ceil(days / 7); i += 1) weeks.push({ from: addDays(today, i * 7), to: addDays(today, Math.min(i * 7 + 6, days - 1)), inflow: 0, outflow: 0 });
  for (let d = 0; d < days; d += 1) {
    const date = addDays(today, d);
    const money = inByDay.get(date) ?? 0;
    const spent = outByDay.get(date) ?? 0;
    balance += money - spent;
    const week = weeks[Math.floor(d / 7)];
    week.inflow += money;
    week.outflow += spent;
    week.balance = balance;
    if (balance < lowest.balance) lowest = { balance, date };
    if (balance < 0 && !firstNegativeDate) firstNegativeDate = date;
  }
  const weekly = weeks.map((w) => ({ ...w, inflow: round2(w.inflow), outflow: round2(w.outflow), net: round2(w.inflow - w.outflow), balance: round2(w.balance) }));

  const windows = HORIZONS.filter((h) => h <= days).map((h) => {
    const cutoff = addDays(today, h - 1);
    const inWindow = events.filter((e) => e.date <= cutoff);
    const inflow = inWindow.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
    const outflow = inWindow.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0);
    return { days: h, inflow: round2(inflow), outflow: round2(outflow), net: round2(inflow - outflow), endingBalance: round2((Number(opening) || 0) + inflow - outflow) };
  });

  const assumptions = [
    `Unpaid invoices count on their due date. Overdue ones are assumed to be paid ${LATE_RECEIVABLE_DELAY_DAYS} days from today (marked "late").`,
    "Client renewals repeat on their billing cycle.",
    "Supplier bills count on their due date; overdue bills are assumed paid today.",
  ];
  if (salary && salary.monthlyAverage > 0) assumptions.push(`Salaries: the average of the last 3 months (${round2(salary.monthlyAverage)} a month), paid around day ${salary.dayOfMonth ?? DEFAULT_PAYDAY}.`);
  if (opex && opex.monthlyAverage > 0) assumptions.push(`Running costs: the average of the last 3 months (${round2(opex.monthlyAverage)} a month), on the 1st.`);
  assumptions.push("New projects, new invoices and one-off costs that are not recorded yet are not included.");

  const money = (e) => ({ date: e.date, amount: round2(Math.abs(e.amount)), kind: e.kind, label: e.label, late: !!e.late, estimate: !!e.estimate });
  return {
    today,
    days,
    opening: Number(opening) || 0,
    windows,
    weekly,
    lowest: { balance: round2(lowest.balance), date: lowest.date },
    firstNegativeDate,
    overdueBeyondHorizon: round2(overdueBeyondHorizon),
    biggestIn: events.filter((e) => e.amount > 0).sort((a, b) => b.amount - a.amount).slice(0, 8).map(money),
    biggestOut: events.filter((e) => e.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 8).map(money),
    // all items, with the sign kept (+ in, - out)
    events: events.map((e) => ({ ...money(e), amount: round2(e.amount) })),
    assumptions,
  };
}

/** Average monthly spend per bucket over the last ~90 days (3 months), from expenses already recorded. */
export function monthlyAverages(expenses, today) {
  const since = addDays(today, -90);
  const recent = expenses.filter((e) => e.expense_date >= since && e.expense_date <= today);
  let salary = 0;
  let opex = 0;
  const salaryDays = [];
  for (const e of recent) {
    if (NON_PNL_CATEGORIES.includes(e.cost_category)) continue;
    if (e.cost_category === "salary") {
      salary += Number(e.amount);
      salaryDays.push(Number(e.expense_date.slice(8)));
    } else if (e.recurring_expense_id == null && e.project_id == null && e.type === "operational") {
      // Not tied to a project and not a subscription (those are listed one by one): rent, utilities, fees...
      opex += Number(e.amount);
    }
  }
  salaryDays.sort((a, b) => a - b);
  return {
    salary: salary > 0 ? { monthlyAverage: round2(salary / 3), dayOfMonth: salaryDays[Math.floor(salaryDays.length / 2)] ?? DEFAULT_PAYDAY } : null,
    opex: opex > 0 ? { monthlyAverage: round2(opex / 3) } : null,
  };
}

export async function loadCashflow(companyId, { days = 90, opening = 0 } = {}) {
  const today = todayStr();
  const testIds = await testProjectIds(companyId);
  const [receivablesRes, payablesRes, renewalsRes, subsRes, clientsRes, expenses] = await Promise.all([
    supabaseAdmin.from("v_ar_aging").select("id, invoice_number, client_id, client_name, due_date, remaining_amount").eq("company_id", companyId).gt("remaining_amount", 0).limit(2000),
    supabaseAdmin.from("v_ap_aging").select("id, bill_number, vendor_name, due_date, remaining_amount").eq("company_id", companyId).gt("remaining_amount", 0).limit(2000),
    supabaseAdmin.from("recurring_revenue").select("id, type, amount, billing_cycle, next_renewal_date, client_id, project_id").eq("company_id", companyId).eq("status", "active"),
    supabaseAdmin.from("recurring_expenses").select("id, name, amount, billing_cycle, next_due_date").eq("company_id", companyId).eq("status", "active"),
    supabaseAdmin.from("clients").select("id, name").eq("company_id", companyId),
    selectAll(() =>
      supabaseAdmin
        .from("expenses")
        .select("id, amount, expense_date, cost_category, type, project_id, recurring_expense_id")
        .eq("company_id", companyId)
        .gte("expense_date", addDays(today, -90))
        .order("id", { ascending: true }),
    ),
  ]);
  for (const r of [receivablesRes, payablesRes, renewalsRes, subsRes, clientsRes]) if (r.error) throw r.error;

  const clientName = Object.fromEntries((clientsRes.data || []).map((c) => [String(c.id), c.name]));
  const live = (rows, key = "project_id") => rows.filter((r) => r[key] == null || !testIds.some((t) => String(t) === String(r[key])));
  const { salary, opex } = monthlyAverages(live(expenses), today);

  return buildCashflow({
    today,
    days,
    opening,
    receivables: receivablesRes.data || [],
    payables: payablesRes.data || [],
    renewals: live(renewalsRes.data || []).map((r) => ({ ...r, client_name: clientName[String(r.client_id)] })),
    subscriptions: subsRes.data || [],
    salary,
    opex,
  });
}
