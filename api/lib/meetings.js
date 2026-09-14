import { supabaseAdmin } from "../../db_connection.js";

const meetingsTable = "meetings";
const attendeesTable = "meeting_attendees";

export const meetingStatuses = ["scheduled", "completed", "cancelled"];

export async function getMeetingForCompany(companyId, meetingId, fields = "*") {
  const { data, error } = await supabaseAdmin
    .from(meetingsTable)
    .select(fields)
    .eq("id", meetingId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAttendeesForMeeting(meetingId) {
  const { data, error } = await supabaseAdmin
    .from(attendeesTable)
    .select("attendee_type, attendee_id")
    .eq("meeting_id", meetingId);
  if (error) throw error;
  return data || [];
}

/**
 * Resolve display names for a list of {attendee_type, attendee_id} rows, batched by type.
 */
export async function resolveAttendeeNames(companyId, attendees) {
  const teamIds = [...new Set(attendees.filter((a) => a.attendee_type === "team_member").map((a) => a.attendee_id))];
  const portalIds = [...new Set(attendees.filter((a) => a.attendee_type === "client_portal_user").map((a) => a.attendee_id))];

  const [teamRes, portalRes] = await Promise.all([
    teamIds.length
      ? supabaseAdmin.from("users").select("id, name").eq("company_id", companyId).in("id", teamIds)
      : Promise.resolve({ data: [] }),
    portalIds.length
      ? supabaseAdmin.from("client_portal_users").select("id, name").eq("company_id", companyId).in("id", portalIds)
      : Promise.resolve({ data: [] }),
  ]);
  if (teamRes.error) throw teamRes.error;
  if (portalRes.error) throw portalRes.error;

  const teamNameById = Object.fromEntries((teamRes.data || []).map((u) => [String(u.id), u.name]));
  const portalNameById = Object.fromEntries((portalRes.data || []).map((u) => [String(u.id), u.name]));

  return attendees.map((a) => ({
    attendee_type: a.attendee_type,
    attendee_id: a.attendee_id,
    name:
      a.attendee_type === "team_member"
        ? teamNameById[String(a.attendee_id)] ?? null
        : portalNameById[String(a.attendee_id)] ?? null,
  }));
}

/**
 * Validate that team_member_ids belong to the company and client_portal_user_ids belong to
 * the company AND the project's client. Returns { valid, error, attendeeRows }.
 */
export async function validateAndBuildAttendeeRows(companyId, projectClientId, attendeeInput) {
  const teamMemberIds = [
    ...new Set((Array.isArray(attendeeInput?.team_member_ids) ? attendeeInput.team_member_ids : []).map(String)),
  ];
  const clientPortalUserIds = [
    ...new Set(
      (Array.isArray(attendeeInput?.client_portal_user_ids) ? attendeeInput.client_portal_user_ids : []).map(String)
    ),
  ];

  if (teamMemberIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("company_id", companyId)
      .in("id", teamMemberIds);
    if (error) throw error;
    if ((data || []).length !== teamMemberIds.length) {
      return { valid: false, error: "One or more team_member_ids are invalid for this company" };
    }
  }

  if (clientPortalUserIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("client_portal_users")
      .select("id")
      .eq("company_id", companyId)
      .eq("client_id", projectClientId)
      .in("id", clientPortalUserIds);
    if (error) throw error;
    if ((data || []).length !== clientPortalUserIds.length) {
      return { valid: false, error: "One or more client_portal_user_ids are invalid for this project's client" };
    }
  }

  const attendeeRows = [
    ...teamMemberIds.map((id) => ({ attendee_type: "team_member", attendee_id: id })),
    ...clientPortalUserIds.map((id) => ({ attendee_type: "client_portal_user", attendee_id: id })),
  ];

  return { valid: true, attendeeRows };
}
