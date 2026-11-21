const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { ipcMain, dialog, BrowserWindow } = require("electron");
const database = require("./database");
const aivana = require("./aivana");
const { EXTRACTION_TYPES } = require("../shared/schemas");
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
const LOW_CONFIDENCE = 0.6;

// Aivana's answer has a size limit (2,048 tokens for this workspace, and asking
// for more is refused), so a list of too many items is cut off before it ends.
// The document is therefore sent in parts that each mention a limited number
// of dates, and a part whose answer is still cut off is halved and read again.
//
// Answers are requested as plain JSON text, not with Aivana's checked
// json_schema format. That format rejected ordinary syllabus text outright
// (structured_output_failed), held fewer items, and took about twice as long.
// A plain answer that is cut off still yields its complete items, and toDraft
// cleans every field, so nothing depends on Aivana validating the answer.
const CHUNK_MAX_CHARS = 6000;
const CHUNK_MAX_DATES = 14;
// Lines from the end of the previous part, sent as context so an item and its
// date on neighbouring lines are not separated.
const CONTEXT_LINES = 2;
// A part shorter than this is not cut in half again.
const MIN_SPLIT_CHARS = 200;
// How many requests run at the same time.
const PARALLEL_REQUESTS = 3;
// The most grading text that is repeated with every part.
const WEIGHT_LINES_MAX_CHARS = 800;

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
- title is short and names the one item, with its number when it has one: "Homework 2", "Quiz 1", "Midterm exam". Write abbreviations out ("HW 2" becomes "Homework 2") and leave out words such as "due". When the document gives several of the same kind in order ("five homework assignments, due in Weeks 2, 4 and 6"), list each one and number them in that order.
- Several days ("Mon-Tue", "November 25 through 27", "Tuesday and Thursday") are one item per day, each with its own date or weekday and the item's full weight.
- due_date is YYYY-MM-DD. Give it only when the document states or clearly implies a calendar date. Use the term dates provided to choose the year.
- When the document says something like "Week 11 Friday", or a schedule row for week 11 says "due Fri", fill week (number) and weekday (full English name) and leave due_date out.
- due_time is 24-hour HH:MM, only when stated. When something opens and closes, list it once with the closing time. For an exam or event with a start and end time, use the start time.
- weight_pct is the share of the final grade (0-100) for that one item, only when stated. When the grading section gives a weight for each of several items ("5 homework assignments, 5% each"), use the each value, not the total.
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

const MONTH_NAME = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const CALENDAR_DATE = new RegExp([
  "\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b",
  `\\b${MONTH_NAME}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_NAME}\\b`,
  "\\b\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?\\b",
].join("|"), "gi");
const WEEK_MENTION = /\b(?:week|module)\s*\d{1,2}\b/i;

// Estimates how many dated items a piece of text holds. A line counts once for
// one date (or a "Week 5" style mention) and twice for more, because a schedule
// row such as "Sep 7-11 ... Quiz 1 Fri 9/11" names several dates for one or two items.
function countDateMentions(text) {
  let count = 0;
  for (const line of String(text).split("\n")) {
    const dates = line.match(CALENDAR_DATE)?.length || 0;
    count += Math.min(dates, 2) || (WEEK_MENTION.test(line) ? 1 : 0);
  }
  return count;
}

// Returns the last few non-empty lines of a piece of text.
function lastLines(text, count = CONTEXT_LINES) {
  return String(text).split("\n").filter((line) => line.trim()).slice(-count).join("\n");
}

// Splits document text into parts small enough for one Aivana answer: at most
// maxChars characters and maxDates date mentions each. Parts break between lines.
function splitDocumentText(text, maxChars = CHUNK_MAX_CHARS, maxDates = CHUNK_MAX_DATES) {
  const clean = compactText(text);
  if (!clean) return [];

  // Lines are the smallest unit. A line longer than the limit is cut at a space.
  const lines = [];
  for (const line of clean.split("\n")) {
    let rest = line;
    while (rest.length > maxChars) {
      const space = rest.lastIndexOf(" ", maxChars);
      const cut = space > maxChars / 2 ? space : maxChars;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    lines.push(rest);
  }

  const chunks = [];
  let current = [];
  let chars = 0;
  let dates = 0;
  for (const line of lines) {
    const lineDates = countDateMentions(line);
    if (current.length > 0 && (chars + line.length + 1 > maxChars || dates + lineDates > maxDates)) {
      chunks.push(current.join("\n").trim());
      current = [];
      chars = 0;
      dates = 0;
    }
    current.push(line);
    chars += line.length + 1;
    dates += lineDates;
  }
  if (current.length > 0) chunks.push(current.join("\n").trim());
  return chunks.filter(Boolean);
}

// Cuts text near its middle, at a line break when there is one, else at a space.
function splitInHalf(text) {
  const middle = Math.floor(text.length / 2);
  let cut = text.lastIndexOf("\n", middle);
  if (cut < text.length / 4) cut = text.indexOf("\n", middle);
  if (cut < 0 || cut > (text.length * 3) / 4) cut = text.lastIndexOf(" ", middle);
  if (cut <= 0) cut = middle;
  return [text.slice(0, cut).trim(), text.slice(cut).trim()].filter(Boolean);
}

// Runs async jobs a few at a time and returns their results in the original
// order. After one job fails, no further jobs are started.
async function runLimited(jobs, limit) {
  const results = new Array(jobs.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < jobs.length) {
      const index = next;
      next += 1;
      try {
        results[index] = await jobs[index]();
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return results;
}

// Fills the empty fields of a term or course with values from a later answer,
// so the first part that states a value wins (setup mode).
function fillBlanks(current, next) {
  if (!next || typeof next !== "object") return current;
  const merged = { ...(current || {}) };
  for (const [key, value] of Object.entries(next)) {
    if (blankToNull(merged[key]) === null && blankToNull(value) !== null) merged[key] = value;
  }
  return merged;
}

// The instruction that tells Aivana to answer as plain JSON text. term and
// course come first, so a cut-off answer still includes them.
function plainFormat(setupMode) {
  const item = '{"title":"...","type":"...","due_date":"YYYY-MM-DD","due_time":"HH:MM","weight_pct":0,"date_text":"...","week":0,"weekday":"...","source_quote":"...","confidence":0.9}';
  const setup = setupMode
    ? '"term":{"name":"...","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD"},"course":{"code":"...","name":"..."},'
    : "";
  return [
    `Reply with JSON only, with no markdown and no other text, shaped like {${setup}"items":[${item}]}.`,
    `Leave out any field that does not apply. type is one of: ${EXTRACTION_TYPES.join(", ")}.`,
    'When nothing is dated, reply {"items":[]}.',
  ].join(" ");
}

// Returns the {...} that starts at `start`, or null when it is cut off.
function balancedObject(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

// Parses JSON and returns null instead of throwing.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The field names toDraft expects, keyed by the name with punctuation removed.
const ANSWER_KEYS = {
  title: "title",
  type: "type",
  duedate: "due_date",
  duetime: "due_time",
  weightpct: "weight_pct",
  datetext: "date_text",
  week: "week",
  weekday: "weekday",
  sourcequote: "source_quote",
  confidence: "confidence",
  name: "name",
  startdate: "start_date",
  enddate: "end_date",
  code: "code",
};

// Restores the expected field names on one answer object. Aivana's plain
// answers often lose the underscores ("duedate", "sourcequote"), so names are
// matched with case and punctuation ignored. Returns null for a non-object.
function canonicalKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    result[ANSWER_KEYS[key.toLowerCase().replace(/[^a-z]/g, "")] || key] = entry;
  }
  return result;
}

// Reads Aivana's plain-text JSON answer. A cut-off answer still returns every
// complete item, with cutOff set. Returns null when no JSON can be found.
function parsePlainAnswer(text) {
  const body = String(text || "");
  const start = body.indexOf("{");
  if (start < 0) return null;

  const whole = balancedObject(body, start);
  const parsed = whole ? parseJson(whole) : null;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return {
      items: (Array.isArray(parsed.items) ? parsed.items : []).map(canonicalKeys).filter(Boolean),
      term: canonicalKeys(parsed.term),
      course: canonicalKeys(parsed.course),
    };
  }

  const data = { items: [], term: null, course: null, cutOff: true };
  for (const key of ["term", "course"]) {
    const match = new RegExp(`"${key}"\\s*:\\s*\\{`).exec(body);
    const value = match ? balancedObject(body, match.index + match[0].length - 1) : null;
    if (value) data[key] = canonicalKeys(parseJson(value));
  }
  const list = /"items"\s*:\s*\[/.exec(body);
  if (!list) return null;
  let index = list.index + list[0].length;
  for (;;) {
    const open = body.indexOf("{", index);
    const close = body.indexOf("]", index);
    if (open < 0 || (close >= 0 && close < open)) break;
    const value = balancedObject(body, open);
    if (!value) break;
    const item = canonicalKeys(parseJson(value));
    if (item) data.items.push(item);
    index = open + value.length;
  }
  return data;
}

// Returns the lines that state grade weights ("Homework 5% each"). They are
// sent with every part, so an item listed far from the grading section still
// gets its weight.
function weightLines(text) {
  const lines = [];
  let length = 0;
  for (const line of String(text || "").split("\n")) {
    const clean = line.trim();
    if (!/\d\s?%/.test(clean) || lines.includes(clean)) continue;
    length += clean.length + 1;
    if (length > WEIGHT_LINES_MAX_CHARS) break;
    lines.push(clean);
  }
  return lines;
}

// Drops exact repeats: the same title with the same date, week, and weekday.
function mergeExtractedItems(items) {
  const merged = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const title = blankToNull(item?.title);
    const key = [title, item?.due_date, item?.week, item?.weekday]
      .map((part) => String(part ?? "").trim().toLowerCase())
      .join("\0");
    if (!title || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

// Words that do not help tell one item's title from another's.
const TITLE_FILLER = new Set(["a", "an", "and", "at", "due", "for", "in", "no", "of", "on", "the"]);
const TITLE_ALIASES = { hw: "homework", quizzes: "quiz" };

// Splits a title into its words and its numbers, so "HW 2 due" and
// "Homework 2" compare as the same title.
function titleParts(title) {
  const words = new Set();
  const numbers = new Set();
  for (const token of String(title || "").toLowerCase().match(/[a-z]+|\d+/g) || []) {
    if (/\d/.test(token)) {
      numbers.add(Number(token));
      continue;
    }
    const word = TITLE_ALIASES[token] || token;
    if (TITLE_FILLER.has(word)) continue;
    // "assignments" and "assignment" count as the same word.
    words.add(word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word);
  }
  return { words, numbers };
}

// Words that are too general to tell two titles apart when other words are present.
const TITLE_GENERAL = new Set(["assignment", "class", "course", "exam", "final", "group", "project", "team"]);

// True when every word of the smaller set is in the larger one.
function wordsWithin(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  return small.size > 0 && [...small].every((word) => large.has(word));
}

// True when two titles name the same thing: no conflicting numbers ("Quiz 1"
// is not "Quiz 2"), and the words of one are all found in the other ("MIDTERM"
// and "Midterm exam"). General words are compared only when a title has
// nothing else, so "Final presentation" matches "Project presentations" but
// "Final exam" does not match "Final project".
function sameTitle(a, b) {
  if (a.numbers.size > 0 && b.numbers.size > 0
    && (a.numbers.size !== b.numbers.size || [...a.numbers].some((number) => !b.numbers.has(number)))) {
    return false;
  }
  const specific = (words) => new Set([...words].filter((word) => !TITLE_GENERAL.has(word)));
  const [first, second] = [specific(a.words), specific(b.words)];
  return first.size > 0 && second.size > 0 ? wordsWithin(first, second) : wordsWithin(a.words, b.words);
}

// True when two entries in mergeSameItems have matching types (or one is
// "other") and titles that name the same thing.
function sameKind(a, b) {
  return (a.type === b.type || a.type === "other" || b.type === "other") && sameTitle(a.parts, b.parts);
}

// True when a value from Aivana is missing.
function isBlank(value) {
  return value === undefined || value === null || value === "";
}

// Merges items that are the same thing written in two places, such as a
// midterm described in a paragraph and listed again in the weekly schedule.
// Items match on the same date (after week and weekday are turned into a date
// with the term), the same type, and titles that name the same thing. The
// copy with the clearer title is kept and takes the other's weight and time.
// An undated item is dropped when a dated copy of it exists.
function mergeSameItems(items, term) {
  const kept = [];
  for (const item of Array.isArray(items) ? items : []) {
    const week = lenient(() => optionalInteger(item?.week, "Week"));
    const weekday = lenient(() => optionalWeekday(item?.weekday));
    const entry = {
      item,
      date: resolveWeekDate(term, week, weekday) || aiDate(item?.due_date),
      week,
      type: EXTRACTION_TYPES.includes(item?.type) ? item.type : "other",
      parts: titleParts(item?.title),
      confidence: Number(item?.confidence) || 0,
    };

    const match = kept.find((other) => other.date === entry.date
      && (entry.date || other.week === entry.week)
      && sameKind(entry, other));
    if (!match) {
      kept.push(entry);
      continue;
    }

    // Keep the numbered title ("Homework 2" over "Homework assignments"), then the surer one.
    const numbered = (entry.parts.numbers.size > 0) - (match.parts.numbers.size > 0);
    const [best, other] = numbered > 0 || (numbered === 0 && entry.confidence > match.confidence)
      ? [entry, match]
      : [match, entry];
    const merged = { ...best.item };
    for (const field of ["weight_pct", "due_time"]) {
      if (isBlank(merged[field]) && !isBlank(other.item[field])) merged[field] = other.item[field];
    }
    if (other.confidence > best.confidence) merged.confidence = other.item.confidence;
    Object.assign(match, {
      item: merged,
      type: best.type,
      parts: best.parts,
      confidence: Math.max(best.confidence, other.confidence),
    });
  }
  return kept
    .filter((entry) => entry.date || !kept.some((other) => other.date && sameKind(entry, other)))
    .map((entry) => entry.item);
}

// Cheap local date preflight. Files without a date-like value never reach
// Aivana, which prevents a paid extraction request for unrelated documents.
function containsLikelyDate(text) {
  return countDateMentions(text || "") > 0;
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
  // Problems the user should know about, such as a part that was only partly read.
  const warnings = [];
  const format = plainFormat(setupMode);
  const gradingLines = weightLines(documentText);

  // Sends one request and returns the parsed answer: { items, term?, course?,
  // cutOff? }, or null when the answer held no JSON.
  const ask = async (prompt, promptFiles) => parsePlainAnswer(await aivana.generateText({
    feature: "extract",
    prompt,
    system: SYSTEM_PROMPT,
    temperature: 0,
    webSearch: false,
    attachments: promptFiles,
  }));

  // Reads one part of the text. `lead` is the end of the text just before it.
  // When the answer is cut off, the part is halved and each half is read on
  // its own, so nothing is lost; a part too short to halve keeps what arrived.
  const readText = async (chunk, lead) => {
    const grading = gradingLines.filter((line) => !chunk.includes(line));
    const data = await ask([
      ...context,
      "This is one part of the documents.",
      "List every dated item in this part. Do not invent items or dates.",
      format,
      ...(grading.length > 0 ? [`\nGrading lines from elsewhere in the documents, for weight_pct only. Do not list items from them:\n${grading.join("\n")}`] : []),
      ...(lead ? [`\nThe lines just before this part, for context only. Do not list items from them:\n${lead}`] : []),
      `\n${lead || grading.length > 0 ? "This part:\n" : ""}${chunk}`,
    ].join("\n"), []);
    if (data && !data.cutOff) return [data];

    const halves = data && chunk.length >= MIN_SPLIT_CHARS ? splitInHalf(chunk) : [];
    if (halves.length === 2) {
      return [...await readText(halves[0], lead), ...await readText(halves[1], lastLines(halves[0]))];
    }
    const opening = chunk.replace(/^--- .*? ---\s*/, "").slice(0, 50).replace(/\s+/g, " ").trim();
    console.warn(`Aivana's answer for this text was ${data ? "cut off" : "not usable"}:\n${chunk}`);
    warnings.push(data
      ? `The part starting "${opening}" was only partly read, so some items may be missing.`
      : `The part starting "${opening}" could not be read.`);
    return [data || { items: [] }];
  };

  // Reads one image or scanned PDF. Each file gets its own request, so the
  // items from several files never have to fit in one answer. A file cannot
  // be halved, so a cut-off answer keeps the items that arrived.
  const readFile = async (file) => {
    const data = await ask([
      ...context,
      `Attached: ${file.name}.`,
      "This is a photo or scanned pages. Read it carefully and list every dated item. Do not invent items or dates.",
      format,
    ].join("\n"), [{ mimeType: file.mimeType, data: file.data }]);
    if (!data) warnings.push(`${file.name} could not be read.`);
    else if (data.cutOff) warnings.push(`${file.name} was only partly read, so some items may be missing. A text-based PDF reads fully.`);
    return [data || { items: [] }];
  };

  const chunks = documentText ? splitDocumentText(documentText) : [];
  const jobs = [
    ...chunks.map((chunk, index) => () => readText(chunk, index > 0 ? lastLines(chunks[index - 1]) : "")),
    ...attachments.map((file) => () => readFile(file)),
  ];

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

    const answers = (await runLimited(jobs, PARALLEL_REQUESTS)).flat();
    for (const data of answers) {
      extractedItems.push(...(Array.isArray(data.items) ? data.items : []));
      if (setupMode) {
        suggestedTerm = fillBlanks(suggestedTerm, data.term);
        suggestedCourse = fillBlanks(suggestedCourse, data.course);
      }
    }

    result = {
      items: mergeExtractedItems(extractedItems),
      term: suggestedTerm,
      course: suggestedCourse,
    };
    // An incomplete result is not saved, so the next upload asks Aivana again.
    if (warnings.length === 0) database.saveCachedExtraction(cacheKey, result);
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
  const drafts = mergeSameItems(result.items, draftTerm)
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
    // Messages to show the user when part of a document could not be fully read.
    warnings,
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
  mergeSameItems,
};
