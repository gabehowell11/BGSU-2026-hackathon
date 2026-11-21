// Shared contract for stored items and for the Aivana extraction JSON schema.
// Confidence is a number from 0 to 1. Do not ask the model for high/medium/low.

const ITEM_TYPES = ["assignment", "quiz", "exam", "project", "holiday", "other"];
const ITEM_STATUSES = ["todo", "in_progress", "done"];
const ITEM_SOURCES = ["ai", "manual"];
const USAGE_FEATURES = ["extract", "chat"];

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const CONFIDENCE_MIN = 0;
const CONFIDENCE_MAX = 1;
const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";
const CHAT_HISTORY_LIMIT = 8;

const isoDate = { type: "string", pattern: ISO_DATE_PATTERN };

const extractionItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    type: { type: "string", enum: ITEM_TYPES },
    due_date: isoDate,
    due_time: { type: "string" },
    weight_pct: { type: "number", minimum: 0, maximum: 100 },
    date_text: { type: "string" },
    week: { type: "integer" },
    weekday: { type: "string", enum: WEEKDAYS },
    source_quote: { type: "string" },
    confidence: {
      type: "number",
      minimum: CONFIDENCE_MIN,
      maximum: CONFIDENCE_MAX,
    },
  },
  required: ["title", "type", "source_quote", "confidence"],
};

const extractionResultSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: extractionItemSchema,
    },
  },
  required: ["items"],
};

module.exports = {
  ITEM_TYPES,
  ITEM_STATUSES,
  ITEM_SOURCES,
  USAGE_FEATURES,
  WEEKDAYS,
  CONFIDENCE_MIN,
  CONFIDENCE_MAX,
  ISO_DATE_PATTERN,
  CHAT_HISTORY_LIMIT,
  extractionItemSchema,
  extractionResultSchema,
};
