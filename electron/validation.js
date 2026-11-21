const {
  WEEKDAYS,
  CONFIDENCE_MIN,
  CONFIDENCE_MAX,
} = require("../shared/schemas");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Turns a missing or blank value into null, and trims any other text.
function blankToNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

// Returns trimmed text, or throws when the value is missing.
function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`A ${label} is required.`);
  }
  return value.trim();
}

// Returns a real YYYY-MM-DD date, or throws.
function requireDate(value, label) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
  if (!real) {
    throw new Error(`${label} must be YYYY-MM-DD.`);
  }
  return value;
}

// Returns null when the date is empty, otherwise a validated date.
function optionalDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return requireDate(String(value).trim(), label);
}

// Returns null when the value is empty, otherwise a finite number.
function optionalNumber(value, label) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a number.`);
  }
  return number;
}

// Returns null when the value is empty, otherwise a whole number.
function optionalInteger(value, label) {
  const number = optionalNumber(value, label);
  if (number === null) return null;
  if (!Number.isInteger(number)) {
    throw new Error(`${label} must be a whole number.`);
  }
  return number;
}

// Returns an allowed value, using the fallback when the input is empty.
function oneOf(value, allowed, label, fallback) {
  const chosen = value === undefined || value === null || value === ""
    ? fallback
    : value;
  if (!allowed.includes(chosen)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return chosen;
}

// Returns null when empty, otherwise one of the allowed values.
function optionalChoice(value, allowed, label) {
  if (value === undefined || value === null || value === "") return null;
  return oneOf(value, allowed, label);
}

// Returns null when empty, otherwise a weekday name from Monday through Sunday.
// Accepts any capitalization, such as "friday".
function optionalWeekday(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  const named = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
  return oneOf(named, WEEKDAYS, "Weekday");
}

const TIME = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i;

// Returns null when empty, otherwise a 24-hour HH:MM time. Accepts "9:30",
// "23:59", "23:59:00", and "11:59 PM".
function optionalTime(value, label = "Due time") {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const match = TIME.exec(String(value).trim());
  if (!match) throw new Error(`${label} must be HH:MM.`);

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3] ? match[3].toLowerCase().replace(/\./g, "") : null;
  if (meridiem) {
    if (hour < 1 || hour > 12) throw new Error(`${label} must be HH:MM.`);
    if (meridiem === "am" && hour === 12) hour = 0;
    if (meridiem === "pm" && hour !== 12) hour += 12;
  }
  if (hour > 23 || minute > 59) throw new Error(`${label} must be HH:MM.`);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Returns null when empty, otherwise a #rrggbb color.
function optionalColor(value, label = "Color") {
  const text = blankToNull(value);
  if (text === null) return null;
  if (!HEX_COLOR.test(text)) throw new Error(`${label} must be a #rrggbb color.`);
  return text.toLowerCase();
}

// Formats a Date as a local YYYY-MM-DD string.
function localDate(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Adds whole days to a YYYY-MM-DD date and returns the new date.
function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

// Returns the weekday index of a YYYY-MM-DD date, Monday = 0 through Sunday = 6.
function weekdayIndex(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

// Returns null when empty, otherwise a confidence score from 0 to 1.
function optionalConfidence(value) {
  const confidence = optionalNumber(value, "Confidence");
  if (confidence !== null && (confidence < CONFIDENCE_MIN || confidence > CONFIDENCE_MAX)) {
    throw new Error("Confidence must be a number from 0 to 1.");
  }
  return confidence;
}

// Returns the date of a weekday in a term week, or null. Week 1 is the
// Monday-to-Sunday week that contains the term's start date.
function resolveWeekDate(term, week, weekday) {
  if (!term?.start_date || !week || week < 1 || !WEEKDAYS.includes(weekday)) return null;
  const firstMonday = addDays(term.start_date, -weekdayIndex(term.start_date));
  return addDays(firstMonday, (week - 1) * 7 + WEEKDAYS.indexOf(weekday));
}

// Returns a positive integer id, or throws.
function requiredId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`A valid ${label} ID is required.`);
  }
  return id;
}

// Returns null when the id is empty, otherwise a positive integer id.
function optionalId(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return requiredId(value, label);
}

// Returns a non-empty list of positive integer ids, or throws.
function requiredIds(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`At least one ${label} ID is required.`);
  }
  return values.map((value) => requiredId(value, label));
}

// Cleans an item list filter from the renderer: ids become numbers, blanks
// are dropped, and verified is kept only when it is exactly true or false.
function itemFilter(filter) {
  const source = filter && typeof filter === "object" ? filter : {};
  const next = {};
  const termId = optionalId(source.termId, "term");
  const courseId = optionalId(source.courseId, "course");
  if (termId !== null) next.termId = termId;
  if (courseId !== null) next.courseId = courseId;
  for (const key of ["status", "type", "priority", "search"]) {
    const value = blankToNull(source[key]);
    if (value !== null) next[key] = value;
  }
  if (source.verified === true || source.verified === false) next.verified = source.verified;
  return next;
}

// Turns term and course ids on an item into numbers the database can store.
function itemIds(item) {
  const next = { ...(item || {}) };
  if (item && "termId" in item) next.termId = requiredId(item.termId, "term");
  if (item && "courseId" in item) next.courseId = optionalId(item.courseId, "course");
  return next;
}

module.exports = {
  blankToNull,
  requireText,
  requireDate,
  optionalDate,
  optionalNumber,
  optionalInteger,
  oneOf,
  optionalChoice,
  optionalWeekday,
  optionalTime,
  optionalColor,
  optionalConfidence,
  localDate,
  addDays,
  weekdayIndex,
  resolveWeekDate,
  requiredId,
  requiredIds,
  optionalId,
  itemFilter,
  itemIds,
};
