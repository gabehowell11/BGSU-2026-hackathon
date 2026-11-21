// Shared contract for stored items and for the Aivana extraction JSON schema.
// Confidence is a number from 0 to 1. Do not ask the model for high/medium/low.

const ITEM_TYPES = ["assignment", "quiz", "exam", "project", "holiday", "study", "other"];
// Types Aivana may return from a syllabus. Study blocks are user-made only.
const EXTRACTION_TYPES = ITEM_TYPES.filter((type) => type !== "study");
const ITEM_STATUSES = ["todo", "in_progress", "done"];
const ITEM_PRIORITIES = ["low", "medium", "high"];
const ITEM_SOURCES = ["ai", "manual"];
const USAGE_FEATURES = ["extract", "chat"];
const CHAT_ROLES = ["user", "assistant"];
// Types that get an 11:59 PM due time when they are created without one.
const DEFAULT_TIME_TYPES = ["assignment", "quiz", "project"];
const DEFAULT_DUE_TIME = "23:59";

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
    type: { type: "string", enum: EXTRACTION_TYPES },
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

// Setup mode (no term saved yet): Aivana also reads the term and course.
const setupExtractionResultSchema = {
  ...extractionResultSchema,
  properties: {
    ...extractionResultSchema.properties,
    term: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        start_date: isoDate,
        end_date: isoDate,
      },
    },
    course: {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string" },
        name: { type: "string" },
      },
    },
  },
};

// Chat replies: the text to show plus proposed changes the user must confirm.
const CHAT_ACTION_OPS = ["create", "update", "delete"];

const chatActionFieldsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    type: { type: "string", enum: ITEM_TYPES },
    due_date: isoDate,
    due_time: { type: "string" },
    course_id: { type: "integer" },
    status: { type: "string", enum: ITEM_STATUSES },
    priority: { type: "string", enum: ITEM_PRIORITIES },
    notes: { type: "string" },
    estimated_minutes: { type: "integer", minimum: 0 },
    weight_pct: { type: "number", minimum: 0, maximum: 100 },
  },
};

const chatResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: CHAT_ACTION_OPS },
          item_id: { type: "integer" },
          summary: { type: "string" },
          fields: chatActionFieldsSchema,
        },
        required: ["op", "summary"],
      },
    },
  },
  required: ["reply", "actions"],
};

module.exports = {
  ITEM_TYPES,
  EXTRACTION_TYPES,
  ITEM_STATUSES,
  ITEM_PRIORITIES,
  ITEM_SOURCES,
  USAGE_FEATURES,
  CHAT_ROLES,
  DEFAULT_TIME_TYPES,
  DEFAULT_DUE_TIME,
  WEEKDAYS,
  CONFIDENCE_MIN,
  CONFIDENCE_MAX,
  ISO_DATE_PATTERN,
  CHAT_HISTORY_LIMIT,
  extractionItemSchema,
  extractionResultSchema,
  setupExtractionResultSchema,
  CHAT_ACTION_OPS,
  chatResponseSchema,
};
