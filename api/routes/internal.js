import { Router } from "express";
import { runMeetingReminderJob } from "../lib/meetingReminders.js";

const router = Router();

/**
 * Deployment-agnostic cron hook: an external scheduler (Vercel Cron, GitHub Actions, system
 * cron, etc.) calls this hourly. Guarded by a shared secret instead of user auth since there's
 * no logged-in user behind a scheduled job. Equivalent to `node scripts/run-meeting-reminders.mjs`.
 */
router.post("/cron/meeting-reminders", async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: "Cron not configured (CRON_SECRET)" });
    if (req.headers["x-cron-secret"] !== secret) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await runMeetingReminderJob();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
