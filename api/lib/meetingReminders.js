import { supabaseAdmin } from "../../db_connection.js";
import { createNotifications } from "./notifications.js";
import { getAttendeesForMeeting } from "./meetings.js";
import { sendEmail } from "./email.js";

async function sendMeetingReminderEmail(email, name, meetingTitle, scheduledAt) {
  const scheduledLabel = new Date(scheduledAt).toISOString().slice(0, 16).replace("T", " ");
  try {
    await sendEmail({
      to: email,
      subject: `Reminder: ${meetingTitle}`,
      html: `<p>Hi ${name},</p><p>Reminder — you have a meeting "${meetingTitle}" scheduled at ${scheduledLabel} (UTC).</p>`,
      text: `Hi ${name},\n\nReminder — you have a meeting "${meetingTitle}" scheduled at ${scheduledLabel} (UTC).`,
    });
  } catch (err) {
    console.error(`[meeting-reminder] failed to email ${email}:`, err.message);
  }
}

/**
 * Runs hourly (via an external scheduler hitting POST /api/internal/cron/meeting-reminders, or
 * `node scripts/run-meeting-reminders.mjs`): finds meetings scheduled in the next 24h that
 * haven't been reminded yet, notifies + "emails" every attendee, one reminder per meeting ever
 * (idempotent even if triggered more than once per hour).
 */
export async function runMeetingReminderJob() {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data: meetings, error } = await supabaseAdmin
    .from("meetings")
    .select("id, company_id, project_id, title, scheduled_at")
    .eq("status", "scheduled")
    .gte("scheduled_at", now.toISOString())
    .lte("scheduled_at", in24h.toISOString());
  if (error) throw error;
  if (!meetings || meetings.length === 0) return { remindedMeetingIds: [] };

  const meetingIds = meetings.map((m) => m.id);
  const { data: alreadyReminded, error: remindedErr } = await supabaseAdmin
    .from("notifications")
    .select("related_id")
    .eq("type", "meeting_reminder")
    .eq("related_type", "meeting")
    .in("related_id", meetingIds);
  if (remindedErr) throw remindedErr;

  const remindedIds = new Set((alreadyReminded || []).map((r) => String(r.related_id)));
  const pending = meetings.filter((m) => !remindedIds.has(String(m.id)));
  if (pending.length === 0) return { remindedMeetingIds: [] };

  // Independent per-meeting work (notify + email its attendees) — run concurrently so a large
  // backlog (e.g. after downtime) doesn't extend the job's runtime linearly with meeting count.
  const results = await Promise.all(
    pending.map(async (meeting) => {
      const attendees = await getAttendeesForMeeting(meeting.id);
      if (attendees.length === 0) return null;

      await createNotifications(
        attendees.map((a) => ({
          company_id: meeting.company_id,
          recipient_type: a.attendee_type,
          recipient_id: a.attendee_id,
          type: "meeting_reminder",
          title: `Upcoming meeting: ${meeting.title}`,
          body: null,
          related_type: "meeting",
          related_id: meeting.id,
        }))
      );

      const teamIds = attendees.filter((a) => a.attendee_type === "team_member").map((a) => a.attendee_id);
      const portalIds = attendees.filter((a) => a.attendee_type === "client_portal_user").map((a) => a.attendee_id);
      const [teamUsersRes, portalUsersRes] = await Promise.all([
        teamIds.length ? supabaseAdmin.from("users").select("name, email").in("id", teamIds) : Promise.resolve({ data: [] }),
        portalIds.length
          ? supabaseAdmin.from("client_portal_users").select("name, email").in("id", portalIds)
          : Promise.resolve({ data: [] }),
      ]);
      await Promise.all(
        [...(teamUsersRes.data || []), ...(portalUsersRes.data || [])].map((u) =>
          sendMeetingReminderEmail(u.email, u.name, meeting.title, meeting.scheduled_at)
        )
      );

      return meeting.id;
    })
  );

  return { remindedMeetingIds: results.filter((id) => id !== null) };
}
