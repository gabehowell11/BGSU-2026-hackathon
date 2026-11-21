const fs = require("node:fs");
const path = require("node:path");
const { ipcMain, dialog, BrowserWindow } = require("electron");
const database = require("./database");
const aivana = require("./aivana");
const { extractionResultSchema, EXTRACTION_TYPES, WEEKDAYS } = require("../shared/schemas");
const {
  blankToNull,
  requireDate,
  optionalNumber,
  optionalInteger,
  optionalWeekday,
  optionalTime,
  optionalConfidence,
  requiredId,
  optionalId,
  addDays,
  weekdayIndex,
} = require("./validation");

const MIB = 1024 * 1024;
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 40 * MIB;
const MAX_TEXT_CHARS = 400000;
const LOW_CONFIDENCE = 0.6;

// File types Aivana reads directly, with its per-file size limits.
const ATTACHMENT_TYPES = {
  ".pdf": { mimeType: "application/pdf", maxBytes: 10 * MIB },
  ".docx": {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    maxBytes: 10 * MIB,
  },
  ".csv": { mimeType: "text/csv", maxBytes: 10 * MIB },
  ".png": { mimeType: "image/png", maxBytes: 8 * MIB },
  ".jpg": { mimeType: "image/jpeg", maxBytes: 8 * MIB },
  ".jpeg": { mimeType: "image/jpeg", maxBytes: 8 * MIB },
  ".webp": { mimeType: "image/webp", maxBytes: 8 * MIB },
  ".gif": { mimeType: "image/gif", maxBytes: 8 * MIB },
};
// Plain text files are read here and pasted into the prompt.
const TEXT_EXTENSIONS = [".txt", ".md"];

const SYSTEM_PROMPT = `You read course documents (syllabi, schedules, assignment sheets, photos of handouts) and list every dated academic item for a student planner.
Rules:
- One item per graded assignment, quiz, exam, project, and per holiday or no-class day. Use type "other" for anything else that has a date.
- Only list items that are actually in the document. Never invent items or dates.
- due_date is YYYY-MM-DD. Give it only when the document states or clearly implies a calendar date. Use the term dates provided to choose the year.
- When the document says something like "Week 11 Friday", fill week (number) and weekday (full English name) and leave due_date out.
- due_time is 24-hour HH:MM, only when stated.
- weight_pct is the share of the final grade (0-100), only when stated.
- date_text is the date wording exactly as written in the document.
- source_quote is the shortest exact sentence or table row from the document that supports the item.
- confidence is 0 to 1: how sure you are the item and its date are correct.
- A recurring item with no specific dates or weeks ("weekly reading responses") is one item with date_text describing it and no due_date.`;

// Finds the window that sent an IPC request, so dialogs open on top of it.
function senderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) || undefined;
}

// Opens a file picker and returns the chosen files' names and bytes, or null when canceled.
async function pickFiles(window) {
  const result = await dialog.showOpenDialog(window, {
    title: "Choose a syllabus, schedule, or photo",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Documents and images",
        extensions: [...Object.keys(ATTACHMENT_TYPES), ...TEXT_EXTENSIONS].map((ext) => ext.slice(1)),
      },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  if (result.filePaths.length > MAX_FILES) {
    throw new Error(`Upload at most ${MAX_FILES} files at a time.`);
  }
  return result.filePaths.map((filePath) => {
    const name = path.basename(filePath);
    if (fs.statSync(filePath).size > MAX_TOTAL_BYTES) {
      throw new Error(`${name} is too large to upload.`);
    }
    return { name, data: fs.readFileSync(filePath) };
  });
}

// Turns base64 text, a data URL, an ArrayBuffer, or a Uint8Array into a Buffer.
function toBuffer(data, name) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") {
    const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
    return Buffer.from(comma >= 0 ? data.slice(comma + 1) : data, "base64");
  }
  throw new Error(`${name} has no file data.`);
}

// Checks every file's type and size and splits them into attachments and plain text.
function prepareFiles(files) {
  if (files.length > MAX_FILES) {
    throw new Error(`Upload at most ${MAX_FILES} files at a time.`);
  }

  const attachments = [];
  const texts = [];
  let totalBytes = 0;

  for (const file of files) {
    const name = blankToNull(file?.name) || "upload";
    const extension = path.extname(name).toLowerCase();
    const bytes = toBuffer(file?.data, name);
    totalBytes += bytes.length;

    if (TEXT_EXTENSIONS.includes(extension)) {
      texts.push({ name, text: bytes.toString("utf8") });
      continue;
    }

    const type = ATTACHMENT_TYPES[extension];
    if (!type) {
      throw new Error(`${name} is not a supported file. Use PDF, Word (.docx), CSV, TXT, or an image.`);
    }
    if (bytes.length > type.maxBytes) {
      throw new Error(`${name} is larger than ${type.maxBytes / MIB} MB.`);
    }
    attachments.push({ name, mimeType: type.mimeType, data: bytes.toString("base64") });
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error("The files add up to more than 40 MB. Upload fewer at a time.");
  }
  return { attachments, texts };
}

// Returns the date of a weekday in a term week. Week 1 is the Monday-to-Sunday
// week that contains the term's start date.
function resolveWeekDate(term, week, weekday) {
  if (!week || week < 1 || !weekday) return null;
  const firstMonday = addDays(term.start_date, -weekdayIndex(term.start_date));
  return addDays(firstMonday, (week - 1) * 7 + WEEKDAYS.indexOf(weekday));
}

// Reads a value and returns null instead of throwing when the AI sent something invalid.
function lenient(read) {
  try {
    return read();
  } catch {
    return null;
  }
}

// Turns one AI item into a draft the review modal can edit and pass to createItems.
function toDraft(raw, index, { term, courseId, sourceFile }) {
  const warnings = [];
  const title = blankToNull(raw?.title);
  const week = lenient(() => optionalInteger(raw?.week, "Week"));
  const weekday = lenient(() => optionalWeekday(raw?.weekday));
  const aiDate = lenient(() => (raw?.due_date ? requireDate(String(raw.due_date).trim(), "Due date") : null));
  const weekDate = resolveWeekDate(term, week, weekday);

  // Prefer the date computed from the term calendar over the model's own math.
  let dueDate = weekDate || aiDate;
  if (weekDate && aiDate && weekDate !== aiDate) {
    warnings.push(`Aivana said ${aiDate}, but week ${week} ${weekday} is ${weekDate}. Using ${weekDate}.`);
  }
  if (week && !weekday && !aiDate) {
    warnings.push(`Week ${week} has no weekday, so no date was set.`);
  }
  if (dueDate && (dueDate < addDays(term.start_date, -7) || dueDate > addDays(term.end_date, 14))) {
    warnings.push(`${dueDate} is outside ${term.name}.`);
  }
  if (!dueDate) {
    warnings.push("No due date found. Set one before saving.");
  }

  let confidence = lenient(() => optionalConfidence(raw?.confidence));
  if (confidence === null) confidence = 0.5;
  if (confidence < LOW_CONFIDENCE) {
    warnings.push("Low confidence. Check this item against the document.");
  }

  const type = EXTRACTION_TYPES.includes(raw?.type) ? raw.type : "other";
  const weightPct = lenient(() => optionalNumber(raw?.weight_pct, "Weight"));
  const dueTime = database.withDefaultDueTime(type, dueDate, lenient(() => optionalTime(raw?.due_time)));
  const duplicate = title ? database.findDuplicate(title, courseId, dueDate ?? null) : null;
  if (duplicate) warnings.push("This item is already saved.");

  return {
    draftId: index + 1,
    termId: term.id,
    courseId,
    title: title || "Untitled item",
    type,
    dueDate,
    dueTime,
    weightPct: weightPct !== null && weightPct >= 0 && weightPct <= 100 ? weightPct : null,
    status: "todo",
    source: "ai",
    dateText: blankToNull(raw?.date_text),
    week,
    weekday,
    sourceQuote: blankToNull(raw?.source_quote),
    confidence,
    sourceFile,
    aiDueDate: aiDate,
    duplicateOf: duplicate ? duplicate.id : null,
    warnings,
  };
}

// Sends files or pasted text to Aivana and returns unsaved drafts for the user to confirm.
// options: { termId, courseId?, files?: [{ name, data }], text? }. With no files
// and no text, a file picker opens. Drafts are NOT saved: after the user edits
// and confirms them, call database.createItems(drafts, { verified: true }).
async function runExtraction(event, options = {}) {
  const termId = requiredId(options?.termId, "term");
  const term = database.getTerm(termId);
  if (!term) throw new Error("Term not found.");

  const courseId = optionalId(options?.courseId, "course");
  let course = null;
  if (courseId !== null) {
    course = database.getCourse(courseId);
    if (!course) throw new Error("Course not found.");
    if (course.term_id !== termId) throw new Error("That course belongs to a different term.");
  }

  let files = Array.isArray(options?.files) ? options.files : [];
  const pastedText = blankToNull(options?.text);
  if (files.length === 0 && !pastedText) {
    files = await pickFiles(senderWindow(event));
    if (!files) return { canceled: true, drafts: [] };
  }

  const { attachments, texts } = prepareFiles(files);
  if (pastedText) texts.push({ name: "pasted text", text: pastedText });

  const documentText = texts.map((entry) => `--- ${entry.name} ---\n${entry.text}`).join("\n\n");
  if (documentText.length > MAX_TEXT_CHARS) {
    throw new Error("The text is too long. Split it into smaller pieces.");
  }

  const fileNames = [...attachments.map((file) => file.name), ...texts.map((entry) => entry.name)];
  const prompt = [
    `Term: ${term.name}, ${term.start_date} to ${term.end_date}.`,
    course ? `Course: ${course.code} ${course.name}.` : "Course: not specified.",
    attachments.length ? `Attached: ${attachments.map((file) => file.name).join(", ")}.` : "",
    "List every dated item in these documents.",
    documentText ? `\n${documentText}` : "",
  ].filter(Boolean).join("\n");

  const { data } = await aivana.generateStructured({
    feature: "extract",
    prompt,
    schema: extractionResultSchema,
    system: SYSTEM_PROMPT,
    temperature: 0,
    attachments: attachments.map(({ mimeType, data: base64 }) => ({ mimeType, data: base64 })),
  });

  const sourceFile = fileNames.join(", ").slice(0, 255) || null;
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const drafts = rawItems
    .map((raw, index) => toDraft(raw, index, { term, courseId, sourceFile }))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

  return { canceled: false, files: fileNames, drafts };
}

// Registers the extraction channel. The renderer never sends file paths, only
// file bytes it already has (drag and drop), so it cannot read arbitrary files.
function registerExtractionHandlers() {
  ipcMain.handle("extract:run", (event, options) => runExtraction(event, options));
}

module.exports = { registerExtractionHandlers, resolveWeekDate };
