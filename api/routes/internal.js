import { Router } from "express";
import { runMeetingReminderJob } from "../lib/meetingReminders.js";
import { runRecurringBillingJob } from "../lib/recurringReminders.js";

const router = Router();

/**
 * Deployment-agnostic cron guard. Vercel Cron Jobs (configured in vercel.json's `crons`) send a
 * GET request with `Authorization: Bearer $CRON_SECRET` automatically when the project has a
 * CRON_SECRET env var set — no extra config needed on Vercel's side. Manual/script triggers
 * (curl, scripts/run-*.mjs via HTTP, other schedulers) should send the same header.
 */
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "Cron not configured (CRON_SECRET)" });

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (token !== secret) return res.status(401).json({ error: "Unauthorized" });

  next();
}

async function handleMeetingReminders(req, res) {
  try {
    const result = await runMeetingReminderJob();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function handleRecurringBilling(req, res) {
  try {
    const result = await runRecurringBillingJob();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

router.get("/cron/meeting-reminders", requireCronSecret, handleMeetingReminders);
router.post("/cron/meeting-reminders", requireCronSecret, handleMeetingReminders);

router.get("/cron/recurring-billing", requireCronSecret, handleRecurringBilling);
router.post("/cron/recurring-billing", requireCronSecret, handleRecurringBilling);

export default router;
