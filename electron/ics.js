const fs = require("node:fs");
const { ipcMain, dialog, BrowserWindow } = require("electron");
const database = require("./database");
const { addDays, itemFilter } = require("./validation");

// Escapes text for an iCalendar property value.
function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Folds a content line to 75 octets, as RFC 5545 requires.
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = Buffer.byteLength(char, "utf8");
    const limit = parts.length === 0 ? 75 : 74;
    if (size + charSize > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// Returns a UTC timestamp such as 20261121T153000Z.
function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// Builds one VEVENT. Timed items are zero-length events at the due time in
// local (floating) time. Items without a time become all-day events.
function eventLines(item, stamp) {
  const day = item.due_date.replace(/-/g, "");
  const prefix = item.course_code ? `[${item.course_code}] ` : "";
  const details = [
    `Type: ${item.type}`,
    `Status: ${item.status}`,
    item.priority ? `Priority: ${item.priority}` : null,
    item.weight_pct !== null && item.weight_pct !== undefined ? `Weight: ${item.weight_pct}%` : null,
    item.notes ? `Notes: ${item.notes}` : null,
  ].filter(Boolean).join("\n");

  const lines = [
    "BEGIN:VEVENT",
    `UID:item-${item.id}@student-task-manager`,
    `DTSTAMP:${stamp}`,
  ];
  if (item.due_time) {
    lines.push(`DTSTART:${day}T${item.due_time.replace(":", "")}00`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${day}`);
    lines.push(`DTEND;VALUE=DATE:${addDays(item.due_date, 1).replace(/-/g, "")}`);
  }
  lines.push(
    `SUMMARY:${escapeText(prefix + item.title)}`,
    `DESCRIPTION:${escapeText(details)}`,
    `CATEGORIES:${escapeText(item.type)}`,
  );
  if (item.course_name) lines.push(`LOCATION:${escapeText(item.course_name)}`);
  lines.push("TRANSP:TRANSPARENT", "END:VEVENT");
  return lines;
}

// Returns the .ics text for the given items. Undated items are skipped.
function buildCalendar(items) {
  const stamp = utcStamp();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BGSU Hackathon//AI Student Task Manager//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Student Tasks",
  ];
  for (const item of items) {
    if (item.due_date) lines.push(...eventLines(item, stamp));
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

// Asks where to save, then writes verified, dated items matching the filter
// (same keys as items:list) to an .ics file that Google Calendar and Outlook import.
async function exportIcs(event, filter = {}) {
  const items = database.listItems({ ...itemFilter(filter), verified: true }).filter((item) => item.due_date);
  if (items.length === 0) throw new Error("There are no dated items to export.");

  const window = BrowserWindow.fromWebContents(event.sender) || undefined;
  const result = await dialog.showSaveDialog(window, {
    title: "Export calendar",
    defaultPath: "student-tasks.ics",
    filters: [{ name: "iCalendar", extensions: ["ics"] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  fs.writeFileSync(result.filePath, buildCalendar(items), "utf8");
  return { canceled: false, path: result.filePath, count: items.length };
}

// Registers export:ics.
function registerIcsHandlers() {
  ipcMain.handle("export:ics", (event, filter) => exportIcs(event, filter));
}

module.exports = { registerIcsHandlers, buildCalendar };
