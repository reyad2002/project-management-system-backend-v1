import { Document, Packer, Paragraph, TextRun, HeadingLevel, Footer } from "docx";

function textParagraphs(content) {
  return String(content ?? "")
    .split(/\r?\n/)
    .map((line) => new Paragraph({ children: [new TextRun(line)] }));
}

/**
 * Build a .docx buffer for one or more meeting notes belonging to a single meeting.
 * `notes` is an array of { content, created_at } ordered oldest-first; pass a single-item
 * array for a single-note export (portal export).
 */
export async function buildMeetingNotesDocx({
  projectTitle,
  meetingTitle,
  scheduledAt,
  attendeeNames = [],
  agenda,
  notes = [],
  clientName,
}) {
  const exportDate = new Date().toISOString().slice(0, 10);
  const scheduledLabel = scheduledAt ? new Date(scheduledAt).toISOString().slice(0, 16).replace("T", " ") : "";

  const children = [
    new Paragraph({ text: meetingTitle || "Meeting Notes", heading: HeadingLevel.HEADING_1 }),
    new Paragraph({ children: [new TextRun({ text: `Project: ${projectTitle ?? ""}`, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: `Date: ${scheduledLabel}`, bold: true })] }),
    new Paragraph({
      children: [new TextRun({ text: `Attendees: ${attendeeNames.length ? attendeeNames.join(", ") : "-"}`, bold: true })],
    }),
    new Paragraph({ text: "" }),
  ];

  if (agenda) {
    children.push(new Paragraph({ text: "Agenda", heading: HeadingLevel.HEADING_2 }));
    children.push(...textParagraphs(agenda));
    children.push(new Paragraph({ text: "" }));
  }

  children.push(new Paragraph({ text: "Notes", heading: HeadingLevel.HEADING_2 }));
  notes.forEach((note, idx) => {
    if (notes.length > 1) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: new Date(note.created_at).toISOString().slice(0, 16).replace("T", " "), italics: true })],
        })
      );
    }
    children.push(...textParagraphs(note.content));
    if (idx < notes.length - 1) children.push(new Paragraph({ text: "" }));
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `تم التصدير بتاريخ ${exportDate} لصالح ${clientName ?? ""}`,
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });

  return Packer.toBuffer(doc);
}

/**
 * Builds a meeting-notes docx and writes it as a file download response — shared by the
 * dashboard (meeting-level) and portal (single-note) export endpoints so the content type /
 * filename / headers can't drift between the two.
 */
export async function sendMeetingNotesDocxResponse(res, filename, buildArgs) {
  const buffer = await buildMeetingNotesDocx(buildArgs);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}
