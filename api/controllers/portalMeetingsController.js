import { supabaseAdmin } from "../../db_connection.js";
import { getMeetingForCompany, getAttendeesForMeeting, resolveAttendeeNames } from "../lib/meetings.js";
import { sendMeetingNotesDocxResponse } from "../lib/docx.js";
import { getPortalProject } from "../lib/portal.js";

const meetingsTable = "meetings";
const notesTable = "meeting_notes";
const noteReadsTable = "meeting_note_reads";

function getOwnProject(companyId, clientId, projectId) {
  return getPortalProject(companyId, clientId, projectId, "id, title, client_id");
}

/**
 * A note's meeting must belong to a project owned by the current portal user's client.
 */
async function getNoteForPortalUser(companyId, clientId, noteId) {
  const { data: note, error } = await supabaseAdmin
    .from(notesTable)
    .select("*")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw error;
  if (!note) return null;

  const meeting = await getMeetingForCompany(companyId, note.meeting_id);
  if (!meeting) return null;

  const project = await getOwnProject(companyId, clientId, meeting.project_id);
  if (!project) return null;

  return { note, meeting, project };
}

export async function listByProject(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const projectId = req.params.id;

    const project = await getOwnProject(companyId, clientId, projectId);
    if (!project) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin
      .from(meetingsTable)
      .select("*")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("scheduled_at", { ascending: true });
    if (error) throw error;

    return res.json({ meetings: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listNotes(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const meetingId = req.params.id;

    const meeting = await getMeetingForCompany(companyId, meetingId, "id, project_id");
    if (!meeting) return res.status(404).json({ error: "Not found" });

    const project = await getOwnProject(companyId, clientId, meeting.project_id);
    if (!project) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin
      .from(notesTable)
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    return res.json({ notes: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function markNoteRead(req, res) {
  try {
    const { company_id: companyId, client_id: clientId, id: portalUserId } = req.portalUser;
    const noteId = req.params.id;

    const found = await getNoteForPortalUser(companyId, clientId, noteId);
    if (!found) return res.status(404).json({ error: "Not found" });

    const { error } = await supabaseAdmin
      .from(noteReadsTable)
      .upsert(
        { meeting_note_id: noteId, portal_user_id: portalUserId },
        { onConflict: "meeting_note_id,portal_user_id", ignoreDuplicates: true }
      );
    if (error) throw error;

    return res.status(200).json({ message: "Marked as read" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function exportNote(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const noteId = req.params.id;

    const found = await getNoteForPortalUser(companyId, clientId, noteId);
    if (!found) return res.status(404).json({ error: "Not found" });
    const { note, meeting, project } = found;

    const attendees = await resolveAttendeeNames(companyId, await getAttendeesForMeeting(meeting.id));
    const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", project.client_id).maybeSingle();

    await sendMeetingNotesDocxResponse(res, `meeting-notes-${noteId}.docx`, {
      projectTitle: project.title,
      meetingTitle: meeting.title,
      scheduledAt: meeting.scheduled_at,
      attendeeNames: attendees.map((a) => a.name).filter(Boolean),
      agenda: meeting.agenda,
      notes: [note],
      clientName: client?.name,
    });
    return;
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
