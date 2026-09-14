import { supabaseAdmin } from "../../db_connection.js";
import { investmentReturnCycles, investmentStatuses } from "../lib/recurring.js";

const table = "investments";
const returnsTable = "investment_returns";

async function getInvestmentForCompany(companyId, id) {
  const { data, error } = await supabaseAdmin.from(table).select("*").eq("id", id).eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { status, page = "1", limit = "20" } = req.query;
    if (status && !investmentStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("investment_date", { ascending: false })
      .range(from, to);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ investments: data || [], pagination: { page: pageNum, limit: limitNum, total: count ?? 0 } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const investment = await getInvestmentForCompany(companyId, req.params.id);
    if (!investment) return res.status(404).json({ error: "Not found" });

    return res.json(investment);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { name, amount_invested, currency, investment_date, expected_return, return_cycle, notes } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name is required" });

    const amt = Number(amount_invested);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "amount_invested must be a positive number" });
    }
    if (!investment_date || Number.isNaN(new Date(investment_date).valueOf())) {
      return res.status(400).json({ error: "investment_date is required and must be a valid date" });
    }
    if (return_cycle != null && !investmentReturnCycles.includes(return_cycle)) {
      return res.status(400).json({ error: `Invalid return_cycle (${investmentReturnCycles.join(" | ")})` });
    }
    let cleanExpectedReturn;
    if (expected_return !== undefined && expected_return !== null) {
      cleanExpectedReturn = Number(expected_return);
      if (!Number.isFinite(cleanExpectedReturn) || cleanExpectedReturn < 0) {
        return res.status(400).json({ error: "expected_return must be a non-negative number" });
      }
    }

    const payload = {
      company_id: companyId,
      name: String(name).trim(),
      amount_invested: amt,
      currency: currency ? String(currency).trim() : undefined,
      investment_date,
      expected_return: cleanExpectedReturn,
      return_cycle: return_cycle ?? null,
      notes: notes ? String(notes).trim() : null,
    };
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));

    const { data, error } = await supabaseAdmin.from(table).insert(clean).select("*").single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const existing = await getInvestmentForCompany(companyId, req.params.id);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const { name, amount_invested, currency, investment_date, expected_return, return_cycle, status, notes } = req.body;

    let cleanAmount;
    if (amount_invested !== undefined) {
      cleanAmount = Number(amount_invested);
      if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
        return res.status(400).json({ error: "amount_invested must be a positive number" });
      }
    }
    if (investment_date !== undefined && Number.isNaN(new Date(investment_date).valueOf())) {
      return res.status(400).json({ error: "investment_date must be a valid date" });
    }
    if (return_cycle !== undefined && return_cycle !== null && !investmentReturnCycles.includes(return_cycle)) {
      return res.status(400).json({ error: `Invalid return_cycle (${investmentReturnCycles.join(" | ")})` });
    }
    let cleanExpectedReturn;
    if (expected_return !== undefined && expected_return !== null) {
      cleanExpectedReturn = Number(expected_return);
      if (!Number.isFinite(cleanExpectedReturn) || cleanExpectedReturn < 0) {
        return res.status(400).json({ error: "expected_return must be a non-negative number" });
      }
    }
    if (status !== undefined && !investmentStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status (${investmentStatuses.join(" | ")})` });
    }

    const payload = {
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(cleanAmount !== undefined ? { amount_invested: cleanAmount } : {}),
      ...(currency !== undefined ? { currency: String(currency).trim() } : {}),
      ...(investment_date !== undefined ? { investment_date } : {}),
      ...(expected_return !== undefined ? { expected_return: expected_return === null ? null : cleanExpectedReturn } : {}),
      ...(return_cycle !== undefined ? { return_cycle } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq("id", req.params.id)
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
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", req.params.id)
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

export async function addReturn(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const investment = await getInvestmentForCompany(companyId, req.params.id);
    if (!investment) return res.status(404).json({ error: "Not found" });

    const { amount, received_date } = req.body;
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "amount must be a positive number" });
    if (!received_date || Number.isNaN(new Date(received_date).valueOf())) {
      return res.status(400).json({ error: "received_date is required and must be a valid date" });
    }

    const { data, error } = await supabaseAdmin
      .from(returnsTable)
      .insert({ investment_id: investment.id, amount: amt, received_date })
      .select("*")
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listReturns(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const investment = await getInvestmentForCompany(companyId, req.params.id);
    if (!investment) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin
      .from(returnsTable)
      .select("*")
      .eq("investment_id", investment.id)
      .order("received_date", { ascending: false });
    if (error) throw error;

    return res.json({ returns: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function summary(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data: investments, error } = await supabaseAdmin.from(table).select("id, name, amount_invested").eq("company_id", companyId);
    if (error) throw error;

    const investmentIds = (investments || []).map((i) => i.id);
    let returns = [];
    if (investmentIds.length > 0) {
      const { data: returnsData, error: returnsErr } = await supabaseAdmin
        .from(returnsTable)
        .select("investment_id, amount")
        .in("investment_id", investmentIds);
      if (returnsErr) throw returnsErr;
      returns = returnsData || [];
    }

    const returnsByInvestment = {};
    returns.forEach((r) => {
      const key = String(r.investment_id);
      returnsByInvestment[key] = (returnsByInvestment[key] || 0) + Number(r.amount ?? 0);
    });

    const round2 = (n) => Math.round(Number(n) * 100) / 100;

    const perInvestment = (investments || []).map((inv) => {
      const totalReturns = round2(returnsByInvestment[String(inv.id)] || 0);
      const invested = Number(inv.amount_invested ?? 0);
      return {
        investment_id: inv.id,
        name: inv.name,
        amountInvested: round2(invested),
        totalReturns,
        returnPercent: invested > 0 ? round2((totalReturns / invested) * 100) : 0,
      };
    });

    const totalInvested = round2(perInvestment.reduce((sum, i) => sum + i.amountInvested, 0));
    const totalReturns = round2(perInvestment.reduce((sum, i) => sum + i.totalReturns, 0));

    return res.json({
      totalInvested,
      totalReturns,
      overallReturnPercent: totalInvested > 0 ? round2((totalReturns / totalInvested) * 100) : 0,
      investments: perInvestment,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
