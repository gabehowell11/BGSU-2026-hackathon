const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ipcMain, dialog, BrowserWindow } = require("electron");
const database = require("./database");
const aivana = require("./aivana");
const {
  extractionResultSchema,
  setupExtractionResultSchema,
  EXTRACTION_TYPES,
} = require("../shared/schemas");
const {
  blankToNull,
  requireDate,
  optionalNumber,
  optionalInteger,
  optionalWeekday,
  optionalTime,
  optionalConfidence,
  optionalId,
  addDays,
  localDate,
  resolveWeekDate,
} = require("./validation");

const MIB = 1024 * 1024;
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 40 * MIB;
const MAX_TEXT_CHARS = 400000;
const API_PROMPT_CHARS = 12000;
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
const TEXT_EXTENSIONS = [".txt", ".md", ".csv"];

// Token saving: Aivana bills a PDF at about 2,300 tokens per page, but text at
// about 1 token per 4 characters. A PDF with a real text layer is sent as its
// text (typically 3-4x cheaper). A PDF averaging fewer characters per page
// than this is treated as scanned and sent as the file, so Aivana can read it.
const MIN_PDF_CHARS_PER_PAGE = 200;

const SYSTEM_PROMPT = `You read course documents (syllabi, schedules, assignment sheets, photos of handouts) and list every dated academic item for a student planner.
Rules:
- One item per graded assignment, quiz, exam, project, and per holiday or no-class day. Use type "other" for anything else that has a date.
- Only list items that are actually in the document. Never invent items or dates.
- due_date is YYYY-MM-DD. Give it only when the document states or clearly implies a calendar date. Use the term dates provided to choose the year.
- When the document says something like "Week 11 Friday", fill week (number) and weekday (full English name) and leave due_date out.
- due_time is 24-hour HH:MM, only when stated.
- weight_pct is the share of the final grade (0-100), only when stated.
- date_text is the date wording exactly as written in the document.
- source_quote is the shortest exact phrase from the document that supports the item, at most 25 words.
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

// Collapses runs of spaces and blank lines, which cost tokens but carry no meaning.
function compactText(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Aivana limits one workspace prompt to 20,000 characters. Split on paragraph
// boundaries and keep every API prompt below that limit.
function splitDocumentText(text, maxChars = API_PROMPT_CHARS) {
  const clean = compactText(text);
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let current = "";
  for (const block of clean.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    if (block.length <= maxChars) {
      current = block;
      continue;
    }

    let start = 0;
    while (start < block.length) {
      let end = Math.min(start + maxChars, block.length);
      if (end < block.length) {
        const newline = block.lastIndexOf("\n", end);
        if (newline > start + Math.floor(maxChars * 0.75)) end = newline;
      }
      chunks.push(block.slice(start, end).trim());
      start = end;
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks;
}

function mergeExtractedItems(items) {
  const merged = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const title = blankToNull(item?.title)?.toLowerCase() || "";
    const date = blankToNull(item?.due_date) || "";
    const key = `${title}\0${date}`;
    if (!title || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

// Cheap local date preflight. Files without a date-like value never reach
// Aivana, which prevents a paid extraction request for unrelated documents.
function containsLikelyDate(text) {
  const value = String(text || "");
  if (!value.trim()) return false;

  return [
    /\b\d{4}-\d{1,2}-\d{1,2}\b/,
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?\b/i,
    /\b\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
    /\b(?:\d{1,2}[/-]){1,2}\d{2,4}\b/,
    /\b(?:week|module)\s*\d{1,2}\b.{0,40}\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|friday)\b/i,
  ].some((pattern) => pattern.test(value));
}

// Returns a PDF's text when it has a real text layer, or null for scanned or
// unreadable PDFs (those are sent to Aivana as the file instead).
async function pdfText(bytes) {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const clean = compactText(text);
    if (totalPages > 0 && clean.length / totalPages >= MIN_PDF_CHARS_PER_PAGE) {
      return { text: clean, pages: totalPages };
    }
  } catch (error) {
    console.warn(`PDF text extraction failed, sending the file instead: ${error.message}`);
  }
  return null;
}

// Checks every file's type and size and splits them into attachments and plain text.
async function prepareFiles(files) {
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
      const text = compactText(bytes.toString("utf8"));
      texts.push({
        name,
        text,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
        fileSize: bytes.length,
      });
      continue;
    }

    if (extension === ".docx") {
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({
          buffer: bytes,
        });
        const text = compactText(result.value);
        if (!text) throw new Error("No readable text was found.");
        texts.push({
          name,
          text,
          sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
          fileSize: bytes.length,
        });
        continue;
      } catch (error) {
        throw new Error(`${name} could not be read as text: ${error.message}`);
      }
    }

    const type = ATTACHMENT_TYPES[extension];
    if (!type) {
      throw new Error(`${name} is not a supported file. Use PDF, Word (.docx), CSV, TXT, Markdown, or an image (PNG, JPG, WebP, GIF).`);
    }
    if (bytes.length > type.maxBytes) {
      throw new Error(`${name} is larger than ${type.maxBytes / MIB} MB.`);
    }
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");

    // A PDF with a real text layer is sent as text (cheaper). A scanned PDF or
    // an image is sent as the file itself so Aivana can read the page.
    if (extension === ".pdf") {
      const extracted = await pdfText(bytes);
      if (extracted) {
        texts.push({ name, text: extracted.text, pages: extracted.pages, sha256, fileSize: bytes.length });
        continue;
      }
    }
    attachments.push({ name, mimeType: type.mimeType, data: bytes.toString("base64"), sha256, fileSize: bytes.length });
  }

  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error("The files add up to more than 40 MB. Upload fewer at a time.");
  }
  return { attachments, texts };
}

// Returns a hash of everything sent to Aivana, so identical uploads reuse the
// saved result. Prompt or rule changes produce a new key automatically.
function extractionCacheKey(prompt, attachments) {
  const hash = crypto.createHash("sha256");
  hash.update(SYSTEM_PROMPT);
  hash.update("\0");
  hash.update(prompt);
  for (const file of attachments) {
    hash.update(`\0${file.mimeType}\0`);
    hash.update(file.data);
  }
  return hash.digest("hex");
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
  const statedDate = aiDate(raw?.due_date);
  const weekDate = resolveWeekDate(term, week, weekday);

  // Prefer the date computed from the term calendar over the model's own math.
  const dueDate = weekDate || statedDate;
  if (weekDate && statedDate && weekDate !== statedDate) {
    warnings.push(`Aivana said ${statedDate}, but week ${week} ${weekday} is ${weekDate}. Using ${weekDate}.`);
  }
  if (week && !weekday && !statedDate) {
    warnings.push(`Week ${week} has no weekday, so no date was set.`);
  }
  if (week && weekday && !term.start_date && !statedDate) {
    warnings.push(`Week ${week} ${weekday} needs the term start date to get a date.`);
  }
  if (dueDate && term.start_date && term.end_date
    && (dueDate < addDays(term.start_date, -7) || dueDate > addDays(term.end_date, 14))) {
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
  // Without a saved term there is nothing to be a duplicate of yet.
  const duplicate = title && term.id ? database.findDuplicate(title, courseId, dueDate ?? null) : null;
  if (duplicate) warnings.push("This item is already saved.");

  return {
    draftId: index + 1,
    termId: term.id,
    courseId,
    title: title || "Untitled item",
    type,
    dueDate,
    // The date worked out from week and weekday, so a later term date change can recompute it.
    weekDate,
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
    aiDueDate: statedDate,
    duplicateOf: duplicate ? duplicate.id : null,
    warnings,
  };
}

// Reads a YYYY-MM-DD date from the AI, or null.
function aiDate(value) {
  return lenient(() => (value ? requireDate(String(value).trim(), "Date") : null));
}

// Cleans the term the AI read from the documents (setup mode).
function toSuggestedTerm(raw) {
  let startDate = aiDate(raw?.start_date);
  let endDate = aiDate(raw?.end_date);
  if (startDate && endDate && startDate > endDate) {
    startDate = null;
    endDate = null;
  }
  return { name: blankToNull(raw?.name), startDate, endDate };
}

// Cleans the course the AI read from the documents (setup mode).
function toSuggestedCourse(raw) {
  return { code: blankToNull(raw?.code), name: blankToNull(raw?.name) };
}

// Sends files or pasted text to Aivana and returns unsaved drafts for the user to confirm.
// options: { termId?, courseId?, files?: [{ name, data }], text?, force? }. With no
// files and no text, a file picker opens. Drafts are NOT saved.
//
// With a termId (normal use): after the user edits and confirms the drafts, call
// database.createItems(drafts, { verified: true }).
//
// Without a termId (setup mode, e.g. onboarding before any term exists): Aivana
// also reads the term and course from the documents. The result includes
// suggestedTerm { name, startDate, endDate } and suggestedCourse { code, name }
// for the user to confirm or fix, and drafts have termId and courseId null.
// Save everything with database.createSetup({ term, course, items }).
//
// The same documents with the same term and course reuse the saved Aivana
// result (no tokens spent) unless force is true.
async function runExtraction(event, options = {}) {
  const courseId = optionalId(options?.courseId, "course");
  let course = null;
  if (courseId !== null) {
    course = database.getCourse(courseId);
    if (!course) throw new Error("Course not found.");
  }

  let termId = optionalId(options?.termId, "term");
  if (termId === null && course) termId = course.term_id;
  let term = null;
  if (termId !== null) {
    term = database.getTerm(termId);
    if (!term) throw new Error("Term not found.");
    if (course && course.term_id !== termId) throw new Error("That course belongs to a different term.");
  }
  const setupMode = term === null;

  let files = Array.isArray(options?.files) ? options.files : [];
  const pastedText = blankToNull(options?.text);
  if (files.length === 0 && !pastedText) {
    files = await pickFiles(senderWindow(event));
    if (!files) return { canceled: true, drafts: [] };
  }

  const { attachments, texts } = await prepareFiles(files);
  if (pastedText) texts.push({ name: "pasted text", text: compactText(pastedText) });

  const documentText = texts.map((entry) => `--- ${entry.name} ---\n${entry.text}`).join("\n\n");
  const fileNames = [...attachments.map((file) => file.name), ...texts.map((entry) => entry.name)];
  if (documentText.length > MAX_TEXT_CHARS) {
    throw new Error("The text is too long. Split it into smaller pieces.");
  }
  if (attachments.length === 0 && !containsLikelyDate(documentText)) {
    return {
      canceled: false,
      noDates: true,
      reason: "No dates or date-bearing schedule information were found, so this file was not sent to Aivana.",
      cached: false,
      files: fileNames,
      sentAsText: [],
      sentAsFile: [],
      suggestedTerm: null,
      suggestedCourse: null,
      drafts: [],
    };
  }

  const context = setupMode
    ? [
      "No term or course is set up yet.",
      // Only the year, so the cached result stays valid all year.
      `The current year is ${localDate().slice(0, 4)}.`,
      'Also fill "term" with the term name (for example "Fall 2026") and its first and last day of classes, and "course" with the course code and name. Use only what the documents state, and use those term dates to choose each item\'s year.',
    ]
    : [
      `Term: ${term.name}, ${term.start_date} to ${term.end_date}.`,
      course ? `Course: ${course.code} ${course.name}.` : "Course: not specified.",
    ];
  const documentChunks = documentText ? splitDocumentText(documentText) : [];
  const prompts = documentChunks.map((chunk, index) => ({
    text: [
      ...context,
      `Document chunk ${index + 1} of ${documentChunks.length}.`,
      "List every dated item in this chunk. Do not invent items or dates.",
      `\n${chunk}`,
    ].join("\n"),
    files: [],
  }));
  // Images and scanned pages go in one request with the files attached.
  if (attachments.length) {
    prompts.push({
      text: [
        ...context,
        `Attached: ${attachments.map((file) => file.name).join(", ")}.`,
        "These are photos or scanned pages. Read them carefully and list every dated item. Do not invent items or dates.",
      ].join("\n"),
      files: attachments.map(({ mimeType, data }) => ({ mimeType, data })),
    });
  }

  const cacheKey = extractionCacheKey(
    `${setupMode ? "setup" : "normal"}\n${context.join("\n")}\n${documentText}`,
    attachments,
  );
  let result = options?.force === true ? null : database.getCachedExtraction(cacheKey);
  if (Array.isArray(result)) result = { items: result };
  const cached = result !== null;
  if (!cached) {
    const extractedItems = [];
    let suggestedTerm = null;
    let suggestedCourse = null;

    for (const { text: prompt, files: promptFiles } of prompts) {
      if (prompt.length > 20000) {
        throw new Error("Document text could not be split small enough for Aivana.");
      }
      const { data } = await aivana.generateStructured({
        feature: "extract",
        prompt,
        schema: setupMode ? setupExtractionResultSchema : extractionResultSchema,
        system: SYSTEM_PROMPT,
        temperature: 0,
        webSearch: false,
        attachments: promptFiles,
      });
      extractedItems.push(...(Array.isArray(data.items) ? data.items : []));
      if (setupMode) {
        suggestedTerm ||= data.term ?? null;
        suggestedCourse ||= data.course ?? null;
      }
    }

    result = {
      items: mergeExtractedItems(extractedItems),
      term: suggestedTerm,
      course: suggestedCourse,
    };
    database.saveCachedExtraction(cacheKey, result);
  }

  const suggestedTerm = setupMode ? toSuggestedTerm(result.term) : null;
  const suggestedCourse = setupMode ? toSuggestedCourse(result.course) : null;
  // In setup mode, dates are worked out against the suggested term until it is saved.
  const draftTerm = term || {
    id: null,
    name: suggestedTerm.name || "this term",
    start_date: suggestedTerm.startDate,
    end_date: suggestedTerm.endDate,
  };

  // Drafts are rebuilt every time, so duplicate flags reflect what is saved now.
  const sourceFile = fileNames.join(", ").slice(0, 255) || null;
  const rawItems = Array.isArray(result.items) ? result.items : [];
  const drafts = rawItems
    .map((raw, index) => toDraft(raw, index, { term: draftTerm, courseId, sourceFile }))
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));

  for (const entry of texts) {
    if (!entry?.name || entry.name === "pasted text") continue;
    database.saveUploadedFile({
      name: entry.name,
      mimeType: path.extname(entry.name).toLowerCase() === ".pdf"
        ? "application/pdf"
        : "text/plain",
      fileSize: entry.fileSize,
      plaintext: entry.text,
      sha256: entry.sha256,
      draftCount: drafts.length,
      sentAs: "text",
    });
  }
  for (const file of attachments) {
    database.saveUploadedFile({
      name: file.name,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      plaintext: "",
      sha256: file.sha256,
      draftCount: drafts.length,
      sentAs: "file",
    });
  }

  return {
    canceled: false,
    cached,
    files: fileNames,
    // Which inputs went as text (cheap) and which as files (scanned PDFs, images, Word, CSV).
    sentAsText: texts.map((entry) => entry.name),
    sentAsFile: attachments.map((file) => file.name),
    suggestedTerm,
    suggestedCourse,
    drafts,
  };
}

// Registers the extraction channel. The renderer never sends file paths, only
// file bytes it already has (drag and drop), so it cannot read arbitrary files.
function registerExtractionHandlers() {
  ipcMain.handle("extract:run", (event, options) => runExtraction(event, options));
}

module.exports = {
  registerExtractionHandlers,
  compactText,
  pdfText,
  containsLikelyDate,
  splitDocumentText,
  mergeExtractedItems,
};
