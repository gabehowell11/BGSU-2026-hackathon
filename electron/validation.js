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

// Returns null when empty, otherwise a weekday name from Monday through Sunday.
function optionalWeekday(value) {
  if (value === undefined || value === null || value === "") return null;
  return oneOf(value, WEEKDAYS, "Weekday");
}

// Returns null when empty, otherwise a confidence score from 0 to 1.
function optionalConfidence(value) {
  const confidence = optionalNumber(value, "Confidence");
  if (confidence !== null && (confidence < CONFIDENCE_MIN || confidence > CONFIDENCE_MAX)) {
    throw new Error("Confidence must be a number from 0 to 1.");
  }
  return confidence;
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
  optionalWeekday,
  optionalConfidence,
  requiredId,
  optionalId,
  itemIds,
};
