import { supabaseAdmin } from "../../db_connection.js";
import { sendEmail } from "./email.js";

const MEETING_TIMEZONE = process.env.MEETING_TIMEZONE || "Africa/Cairo";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWhen(iso) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: MEETING_TIMEZONE,
  }).format(new Date(iso));
}

/**
 * Default invitees when the caller doesn't pick attendees: every non-disabled portal user of the
 * project's client, so portal notifications / reminders keep working without a manual picker.
 */
export async function getDefaultClientPortalUserIds(companyId, clientId) {
  const { data, error } = await supabaseAdmin
    .from("client_portal_users")
    .select("id")
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .in("status", ["invited", "active"]);
  if (error) throw error;
  return (data || []).map((u) => String(u.id));
}

/**
 * Email the client that a meeting was scheduled (time + topic). Recipients: the client's own email
 * plus the email of every client portal attendee, de-duplicated. Never throws — a mail failure must
 * not fail meeting creation. Returns { sent, recipients } for logging/tests.
 */
export async function sendMeetingScheduledEmail({ companyId, meeting, project, portalAttendeeIds }) {
  try {
    const [{ data: client }, portalRes] = await Promise.all([
      supabaseAdmin
        .from("clients")
        .select("name, email")
        .eq("id", project.client_id)
        .eq("company_id", companyId)
        .maybeSingle(),
      portalAttendeeIds.length
        ? supabaseAdmin
            .from("client_portal_users")
            .select("name, email")
            .eq("company_id", companyId)
            .in("id", portalAttendeeIds)
        : Promise.resolve({ data: [] }),
    ]);

    const recipients = new Map();
    if (client?.email) recipients.set(client.email.trim().toLowerCase(), client.name || "there");
    for (const u of portalRes.data || []) {
      if (u.email) recipients.set(u.email.trim().toLowerCase(), u.name || "there");
    }
    if (recipients.size === 0) return { sent: 0, recipients: [] };

    const when = formatWhen(meeting.scheduled_at);
    const subject = `Meeting scheduled: ${meeting.title}`;
    let sent = 0;

    await Promise.all(
      [...recipients].map(async ([email, name]) => {
        const lines = [
          `Hi ${name},`,
          ``,
          `A meeting has been scheduled${project.title ? ` for the project "${project.title}"` : ""}.`,
          `Topic: ${meeting.title}`,
          `When: ${when} (${MEETING_TIMEZONE})`,
          ...(meeting.agenda ? [`Agenda: ${meeting.agenda}`] : []),
          ...(meeting.meeting_link ? [`Join link: ${meeting.meeting_link}`] : []),
        ];
        const html =
          `<p>Hi ${escapeHtml(name)},</p>` +
          `<p>A meeting has been scheduled${project.title ? ` for the project <strong>${escapeHtml(project.title)}</strong>` : ""}.</p>` +
          `<ul>` +
          `<li><strong>Topic:</strong> ${escapeHtml(meeting.title)}</li>` +
          `<li><strong>When:</strong> ${escapeHtml(when)} (${escapeHtml(MEETING_TIMEZONE)})</li>` +
          (meeting.agenda ? `<li><strong>Agenda:</strong> ${escapeHtml(meeting.agenda)}</li>` : "") +
          (meeting.meeting_link
            ? `<li><strong>Join link:</strong> <a href="${escapeHtml(meeting.meeting_link)}">${escapeHtml(meeting.meeting_link)}</a></li>`
            : "") +
          `</ul>`;
        try {
          const result = await sendEmail({ to: email, subject, html, text: lines.join("\n") });
          if (result.sent) sent += 1;
        } catch (err) {
          console.error(`[meeting-invite] failed to email ${email}:`, err.message);
        }
      })
    );

    return { sent, recipients: [...recipients.keys()] };
  } catch (err) {
    console.error("[meeting-invite] unexpected failure:", err.message);
    return { sent: 0, recipients: [] };
  }
}
