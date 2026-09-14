// Runs the meeting reminder cron job directly (no HTTP hop). Invoke this from an external
// scheduler (system cron, GitHub Actions schedule, etc.) once an hour:
//   node scripts/run-meeting-reminders.mjs
import { runMeetingReminderJob } from "../api/lib/meetingReminders.js";

runMeetingReminderJob()
  .then((result) => {
    console.log(`[meeting-reminder-cron] reminded ${result.remindedMeetingIds.length} meeting(s)`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[meeting-reminder-cron] failed:", err);
    process.exit(1);
  });
