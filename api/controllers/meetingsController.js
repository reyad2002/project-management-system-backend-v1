import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany, createTaskForProject, validateTaskInput } from "../lib/tasks.js";
import {
  meetingStatuses,
  getMeetingForCompany,
  getAttendeesForMeeting,
  resolveAttendeeNames,
  validateAndBuildAttendeeRows,
} from "../lib/meetings.js";
import { createNotifications } from "../lib/notifications.js";
import { sendMeetingNotesDocxResponse } from "../lib/docx.js";

const table = "meetings";
const attendeesTable = "meeting_attendees";
const notesTable = "meeting_notes";
const noteReadsTable = "meeting_note_reads";

// ----- Meetings -----

export async function createByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const projectId = req.params.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { title, agenda, scheduled_at, meeting_link, attendee_ids } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: "title is required" });
    if (!scheduled_at || Number.isNaN(new Date(scheduled_at).valueOf())) {
      return res.status(400).json({ error: "scheduled_at is required and must be a valid date" });
    }

    const attendeeCheck = await validateAndBuildAttendeeRows(companyId, project.client_id, attendee_ids);
    if (!attendeeCheck.valid) return res.status(400).json({ error: attendeeCheck.error });

    const { data: meeting, error } = await supabaseAdmin
      .from(table)
      .insert({
        company_id: companyId,
        project_id: projectId,
        title: String(title).trim(),
        agenda: agenda ? String(agenda).trim() : null,
        scheduled_at: new Date(scheduled_at).toISOString(),
        meeting_link: meeting_link ? String(meeting_link).trim() : null,
        status: "scheduled",
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw error;

    if (attendeeCheck.attendeeRows.length > 0) {
      const { error: attErr } = await supabaseAdmin
        .from(attendeesTable)
        .insert(attendeeCheck.attendeeRows.map((a) => ({ ...a, meeting_id: meeting.id })));
      if (attErr) throw attErr;
    }

    const attendees = await resolveAttendeeNames(companyId, attendeeCheck.attendeeRows);
    return res.status(201).json({ ...meeting, attendees });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { status } = req.query;
    if (status && !meetingStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    let query = supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("scheduled_at", { ascending: true });
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    return res.json({ meetings: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const meetingId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const existing = await getMeetingForCompany(companyId, meetingId);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const { title, agenda, scheduled_at, meeting_link, status } = req.body;
    if (status !== undefined && !meetingStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (scheduled_at !== undefined && Number.isNaN(new Date(scheduled_at).valueOf())) {
      return res.status(400).json({ error: "scheduled_at must be a valid date" });
    }

    const payload = {
      ...(title !== undefined ? { title: String(title).trim() } : {}),
      ...(agenda !== undefined ? { agenda: agenda ? String(agenda).trim() : null } : {}),
      ...(scheduled_at !== undefined ? { scheduled_at: new Date(scheduled_at).toISOString() } : {}),
      ...(meeting_link !== undefined ? { meeting_link: meeting_link ? String(meeting_link).trim() : null } : {}),
      ...(status !== undefined ? { status } : {}),
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq("id", meetingId)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    if (status === "cancelled" && existing.status !== "cancelled") {
      const attendees = await getAttendeesForMeeting(meetingId);
      await createNotifications(
        attendees.map((a) => ({
          company_id: companyId,
          recipient_type: a.attendee_type,
          recipient_id: a.attendee_id,
          type: "meeting_cancelled",
          title: `Meeting cancelled: ${data.title}`,
          body: null,
          related_type: "meeting",
          related_id: data.id,
        }))
      );
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ----- Meeting notes -----

export async function createNote(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    const meetingId = req.params.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const meeting = await getMeetingForCompany(companyId, meetingId);
    if (!meeting) return res.status(404).json({ error: "Not found" });

    const { content, action_items } = req.body;
    if (!content || !String(content).trim()) return res.status(400).json({ error: "content is required" });

    const items = Array.isArray(action_items) ? action_items : [];
    for (const item of items) {
      if (!item.title || !String(item.title).trim()) {
        return res.status(400).json({ error: "Each action item requires a title" });
      }
      if (!["team_member", "client"].includes(item.assignee_type)) {
        return res.status(400).json({ error: "Each action item requires a valid assignee_type" });
      }
      if (!item.assignee_id) {
        return res.status(400).json({ error: "Each action item requires an assignee_id" });
      }
    }

    const project = await getProjectForCompany(companyId, meeting.project_id);

    const taskInputs = items.map((item) => ({
      title: item.title,
      due_date: item.due_date ?? null,
      assignee_type: item.assignee_type,
      assignee_id: item.assignee_type === "team_member" ? item.assignee_id : undefined,
      client_assignee_id: item.assignee_type === "client" ? item.assignee_id : undefined,
      source: "meeting",
      source_id: meetingId,
    }));

    // Validate every action item up front — a bad item must fail the whole request before the
    // note or any earlier task is written, not leave a partial result behind.
    for (let i = 0; i < taskInputs.length; i++) {
      const v = await validateTaskInput(companyId, project, taskInputs[i]);
      if (!v.valid) return res.status(v.status).json({ error: `Action item "${items[i].title}": ${v.error}` });
    }

    const { data: note, error } = await supabaseAdmin
      .from(notesTable)
      .insert({ meeting_id: meetingId, content: String(content).trim(), created_by: userId })
      .select("*")
      .single();
    if (error) throw error;

    const createdTasks = [];
    const assigneeNotifications = [];
    for (const taskInput of taskInputs) {
      const result = await createTaskForProject(companyId, userId, project, taskInput);
      if (result.error) return res.status(result.status).json({ error: `Action item "${taskInput.title}": ${result.error}` });
      createdTasks.push(result.task);
      if (result.notifyClientAssigneeId) {
        assigneeNotifications.push({
          company_id: companyId,
          recipient_type: "client_portal_user",
          recipient_id: result.notifyClientAssigneeId,
          type: "task_assigned_to_client",
          title: `New task assigned: ${result.task.title}`,
          body: null,
          related_type: "task",
          related_id: result.task.id,
        });
      } else if (result.task.assignee_type === "team_member" && result.task.assignee_id) {
        assigneeNotifications.push({
          company_id: companyId,
          recipient_type: "team_member",
          recipient_id: result.task.assignee_id,
          type: "action_item_assigned",
          title: `New action item assigned: ${result.task.title}`,
          body: null,
          related_type: "task",
          related_id: result.task.id,
        });
      }
    }
    if (assigneeNotifications.length > 0) await createNotifications(assigneeNotifications);

    const attendees = await getAttendeesForMeeting(meetingId);
    const portalAttendees = attendees.filter((a) => a.attendee_type === "client_portal_user");
    if (portalAttendees.length > 0) {
      await createNotifications(
        portalAttendees.map((a) => ({
          company_id: companyId,
          recipient_type: "client_portal_user",
          recipient_id: a.attendee_id,
          type: "meeting_note_added",
          title: `New meeting notes: ${meeting.title}`,
          body: null,
          related_type: "meeting",
          related_id: meeting.id,
        }))
      );
    }

    return res.status(201).json({ ...note, action_items: createdTasks });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function listNotes(req, res) {
  try {
    const companyId = req.user?.company_id;
    const meetingId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const meeting = await getMeetingForCompany(companyId, meetingId, "id");
    if (!meeting) return res.status(404).json({ error: "Not found" });

    const { data: notes, error } = await supabaseAdmin
      .from(notesTable)
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const noteIds = (notes || []).map((n) => n.id);
    let reads = [];
    if (noteIds.length > 0) {
      const { data: readRows, error: readErr } = await supabaseAdmin
        .from(noteReadsTable)
        .select("meeting_note_id, portal_user_id, read_at")
        .in("meeting_note_id", noteIds);
      if (readErr) throw readErr;
      reads = readRows || [];
    }

    const portalUserIds = [...new Set(reads.map((r) => r.portal_user_id))];
    let nameById = {};
    if (portalUserIds.length > 0) {
      const { data: users, error: usersErr } = await supabaseAdmin
        .from("client_portal_users")
        .select("id, name")
        .in("id", portalUserIds);
      if (usersErr) throw usersErr;
      nameById = Object.fromEntries((users || []).map((u) => [String(u.id), u.name]));
    }

    const readsByNote = {};
    reads.forEach((r) => {
      const key = String(r.meeting_note_id);
      if (!readsByNote[key]) readsByNote[key] = [];
      readsByNote[key].push({
        portal_user_id: r.portal_user_id,
        portal_user_name: nameById[String(r.portal_user_id)] ?? null,
        read_at: r.read_at,
      });
    });

    const enriched = (notes || []).map((n) => ({ ...n, reads: readsByNote[String(n.id)] || [] }));
    return res.json({ notes: enriched });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function exportNotes(req, res) {
  try {
    const companyId = req.user?.company_id;
    const meetingId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const meeting = await getMeetingForCompany(companyId, meetingId);
    if (!meeting) return res.status(404).json({ error: "Not found" });

    const { data: notes, error } = await supabaseAdmin
      .from(notesTable)
      .select("content, created_at")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!notes || notes.length === 0) return res.status(404).json({ error: "No notes to export for this meeting" });

    const [project, attendees] = await Promise.all([
      getProjectForCompany(companyId, meeting.project_id, "id, title, client_id"),
      resolveAttendeeNames(companyId, await getAttendeesForMeeting(meetingId)),
    ]);

    const { data: client } = await supabaseAdmin.from("clients").select("name").eq("id", project?.client_id).maybeSingle();

    await sendMeetingNotesDocxResponse(res, `meeting-notes-${meetingId}.docx`, {
      projectTitle: project?.title,
      meetingTitle: meeting.title,
      scheduledAt: meeting.scheduled_at,
      attendeeNames: attendees.map((a) => a.name).filter(Boolean),
      agenda: meeting.agenda,
      notes,
      clientName: client?.name,
    });
    return;
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
