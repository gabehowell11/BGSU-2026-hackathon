const { ipcMain } = require("electron");
const database = require("./database");
const aivana = require("./aivana");
const { chatResponseSchema, CHAT_ACTION_OPS } = require("../shared/schemas");
const {
  blankToNull,
  requiredId,
  itemIds,
  localDate,
  addDays,
} = require("./validation");

const MAX_MESSAGE_CHARS = 4000;

// Token saving: the API is stateless, so history and the planner snapshot are
// re-sent (and billed) on every message. These limits keep each turn small.
// Items in the snapshot: overdue, the last week, the next 45 days, and undated to-dos.
const MAX_CONTEXT_ITEMS = 80;
const CONTEXT_DAYS_BACK = 7;
const CONTEXT_DAYS_AHEAD = 45;
// Older turns are cut to this many characters when re-sent as history.
const HISTORY_MESSAGE_CHARS = 600;
// Ceiling on reply length (reply text plus proposed actions).
const REPLY_MAX_TOKENS = 1000;

const SYSTEM_PROMPT = `You are Aivana, the assistant inside a student task manager. You help the student plan, prioritize, and manage assignments, quizzes, exams, projects, holidays, and study blocks.
Rules:
- Put your answer to the student in "reply": friendly, concise, plain text.
- When the student asks to add, change, complete, reschedule, or delete items, describe each change in "actions" with a one-line "summary". Never say a change is already done: the app asks the student to confirm every action first. Tell them to confirm.
- create: "fields" must include title, and should include due_date and course_id when known.
- update: "item_id" plus only the fields that change. Mark something complete with status "done".
- delete: "item_id" only.
- Use only item ids (#) and course ids from the planner data in the latest message. If it is unclear which item the student means, ask, and return no actions.
- Dates are YYYY-MM-DD and times are 24-hour HH:MM. Work out relative dates such as "next Friday" from today's date in the planner data.
- For questions that change nothing, "actions" is an empty array.`;

// Describes one item on one short line, e.g.
// "#12 Project 1 (project, CS 3350) 2026-10-09 23:59 todo high ~600m".
// The type is left out for plain assignments.
function itemLine(item) {
  const tags = [item.type === "assignment" ? null : item.type, item.course_code].filter(Boolean);
  const parts = [`#${item.id} ${item.title}${tags.length ? ` (${tags.join(", ")})` : ""}`];
  parts.push(item.due_date ? `${item.due_date}${item.due_time ? ` ${item.due_time}` : ""}` : "undated");
  parts.push(item.status);
  if (item.priority) parts.push(item.priority);
  if (item.estimated_minutes) parts.push(`~${item.estimated_minutes}m`);
  return parts.join(" ");
}

// Builds the planner snapshot sent with each message: today, terms, courses,
// and the verified items that matter now (overdue, recent, upcoming, undated to-dos).
function plannerContext(today) {
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  const terms = database.listTerms();
  const courses = database.listCourses();
  const termNames = new Map(terms.map((term) => [term.id, term.name]));
  const from = addDays(today, -CONTEXT_DAYS_BACK);
  const to = addDays(today, CONTEXT_DAYS_AHEAD);

  const relevant = database.listItems({ verified: true }).filter((item) => (
    item.due_date
      ? (item.due_date >= from && item.due_date <= to) || (item.due_date < today && item.status !== "done")
      : item.status !== "done"
  ));
  const items = relevant.slice(0, MAX_CONTEXT_ITEMS);
  const omitted = relevant.length - items.length;

  return [
    `Today: ${weekday} ${today}.`,
    `Terms: ${terms.length ? terms.map((term) => `${term.name} ${term.start_date}..${term.end_date}`).join("; ") : "none"}.`,
    "Courses (course_id=code name):",
    ...(courses.length
      ? courses.map((course) => `${course.id}=${course.code} ${course.name}${terms.length > 1 ? ` [${termNames.get(course.term_id) || "?"}]` : ""}`)
      : ["none"]),
    `Items (#id title (type, course) due status [priority] [estimate]); only overdue, ${from}..${to}, and undated to-dos are listed. Ask if the student means an item not listed:`,
    ...(items.length ? items.map(itemLine) : ["none"]),
    ...(omitted > 0 ? [`(${omitted} more not shown)`] : []),
  ].join("\n");
}

// Streaming replies are plain text, so proposed changes come after a marker
// line as a JSON array. The marker and JSON are never shown to the student.
const ACTIONS_MARKER = "@@ACTIONS@@";

const STREAM_SYSTEM_PROMPT = `You are Aivana, the assistant inside a student task manager. You help the student plan, prioritize, and manage assignments, quizzes, exams, projects, holidays, and study blocks.
Rules:
- Answer the student first, in plain text: friendly and concise. No markdown tables or headings.
- When the student asks to add, change, complete, reschedule, or delete items, finish your answer, then write a new line with exactly ${ACTIONS_MARKER} followed by a JSON array of actions, and write nothing after the array. Never write the marker when nothing should change.
- Each action is {"op": "create" | "update" | "delete", "summary": "one line", "item_id": number, "fields": {...}}.
- create: "fields" must include title, and should include due_date and course_id when known. No item_id.
- update: "item_id" plus only the fields that change. Mark something complete with status "done".
- delete: "item_id" only.
- Allowed fields: title, type, due_date, due_time, course_id, status, priority, notes, estimated_minutes, weight_pct.
- Never say a change is already done: the app asks the student to confirm every change first. Tell them to confirm.
- Use only item ids (#) and course ids from the planner data in the latest message. If it is unclear which item the student means, ask, and propose nothing.
- Dates are YYYY-MM-DD and times are 24-hour HH:MM. Work out relative dates such as "next Friday" from today's date in the planner data.`;

// Number of trailing characters that could be the start of the marker, so a
// half-received marker is held back instead of flashing on screen.
function markerPrefixLength(text) {
  for (let length = Math.min(text.length, ACTIONS_MARKER.length - 1); length > 0; length -= 1) {
    if (ACTIONS_MARKER.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

// Splits a finished streamed answer into the visible reply and the raw actions.
function parseStreamedReply(full) {
  const index = full.indexOf(ACTIONS_MARKER);
  if (index < 0) return { reply: full.trim(), rawActions: [], unreadable: false };
  const reply = full.slice(0, index).trim();
  const json = full.slice(index + ACTIONS_MARKER.length).trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const parsed = JSON.parse(json);
    const rawActions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.actions) ? parsed.actions : [];
    return { reply, rawActions, unreadable: false };
  } catch {
    return { reply, rawActions: [], unreadable: true };
  }
}

// Cuts an older chat turn down before it is re-sent as history.
function shorten(text) {
  return text.length > HISTORY_MESSAGE_CHARS ? `${text.slice(0, HISTORY_MESSAGE_CHARS)}…` : text;
}

const FIELD_NAMES = {
  title: "title",
  type: "type",
  due_date: "dueDate",
  due_time: "dueTime",
  course_id: "courseId",
  status: "status",
  priority: "priority",
  notes: "notes",
  estimated_minutes: "estimatedMinutes",
  weight_pct: "weightPct",
};

// Checks one proposed action against the database and returns it in the
// shape chat:apply-actions accepts, or { rejected } with a reason.
function normalizeAction(raw, actionId, currentTerm) {
  const op = CHAT_ACTION_OPS.includes(raw?.op) ? raw.op : null;
  const summary = blankToNull(raw?.summary) || (op ? `${op} item` : "Unknown change");
  if (!op) return { rejected: { summary, reason: "Unknown action." } };

  const item = {};
  for (const [wire, name] of Object.entries(FIELD_NAMES)) {
    if (raw?.fields?.[wire] !== undefined && raw.fields[wire] !== null) item[name] = raw.fields[wire];
  }

  if (item.courseId !== undefined) {
    const course = database.getCourse(Number(item.courseId));
    if (!course) return { rejected: { summary, reason: "That course does not exist." } };
    item.termId = course.term_id;
  }

  let before = null;
  if (op === "create") {
    if (!blankToNull(item.title)) return { rejected: { summary, reason: "A new item needs a title." } };
    if (!item.termId) item.termId = currentTerm?.id;
    if (!item.termId) return { rejected: { summary, reason: "Create a term first." } };
  } else {
    before = database.getItem(Number(raw?.item_id));
    if (!before) return { rejected: { summary, reason: "That item does not exist." } };
    if (op === "update" && Object.keys(item).length === 0) {
      return { rejected: { summary, reason: "No fields to change." } };
    }
  }

  return {
    action: {
      actionId,
      op,
      summary,
      itemId: before ? before.id : null,
      item: op === "delete" ? null : item,
      before,
    },
  };
}

// Checks the message and builds what is sent: recent history plus the planner snapshot.
function prepareTurn(content) {
  const text = blankToNull(content);
  if (!text) throw new Error("Type a message first.");
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new Error(`Messages are limited to ${MAX_MESSAGE_CHARS} characters.`);
  }

  const today = localDate();
  const history = database.listRecentChatMessages()
    .map(({ role, content: body }) => ({ role, content: shorten(body) }));
  const messages = [
    ...history,
    { role: "user", content: `${text}\n\n--- Planner data (for reference) ---\n${plannerContext(today)}` },
  ];
  return { text, today, messages };
}

// Validates proposed actions and saves both turns. Saving only after Aivana
// answered means a failed call leaves no orphan message.
function finishTurn({ text, today, reply, rawActions, unreadable = false }) {
  const currentTerm = database.getCurrentTerm(today);
  const actions = [];
  const rejected = [];
  (Array.isArray(rawActions) ? rawActions : []).forEach((raw) => {
    const result = normalizeAction(raw, actions.length + 1, currentTerm);
    if (result.action) actions.push(result.action);
    else rejected.push(result.rejected);
  });
  if (unreadable) {
    rejected.push({ summary: "Proposed changes", reason: "The assistant's changes could not be read. Ask again." });
  }

  const saved = database.transaction(() => ({
    user: database.addChatMessage({ role: "user", content: text }),
    assistant: database.addChatMessage({ role: "assistant", content: reply }),
  }));
  return { reply, actions, rejected, messages: saved };
}

// Streams one reply. Visible text goes to the renderer as "chat:delta" events
// tagged with requestId; the resolved value matches chat:send.
async function streamMessage(event, requestId, content) {
  const { text, today, messages } = prepareTurn(content);
  let full = "";
  let shown = 0;

  await aivana.streamText({
    feature: "chat",
    system: STREAM_SYSTEM_PROMPT,
    assistantName: "Aivana",
    messages,
    maxTokens: REPLY_MAX_TOKENS,
    webSearch: false,
    onDelta: (piece) => {
      full += piece;
      const markerAt = full.indexOf(ACTIONS_MARKER);
      const visibleEnd = markerAt >= 0 ? markerAt : full.length - markerPrefixLength(full);
      if (visibleEnd > shown && !event.sender.isDestroyed()) {
        event.sender.send("chat:delta", { requestId, text: full.slice(shown, visibleEnd) });
        shown = visibleEnd;
      }
    },
  });

  const parsed = parseStreamedReply(full);
  const reply = parsed.reply || "Sorry, I could not come up with an answer. Try rephrasing.";
  return finishTurn({ text, today, reply, rawActions: parsed.rawActions, unreadable: parsed.unreadable });
}

// Sends one message and waits for the whole reply. Returns Aivana's reply and
// proposed actions. Nothing in the planner changes until the renderer passes
// confirmed actions to chat:apply-actions.
async function sendMessage(content) {
  const { text, today, messages } = prepareTurn(content);

  const { data } = await aivana.generateStructured({
    feature: "chat",
    prompt: null,
    schema: chatResponseSchema,
    system: SYSTEM_PROMPT,
    assistantName: "Aivana",
    messages,
    maxTokens: REPLY_MAX_TOKENS,
    webSearch: false,
  });

  const reply = blankToNull(data.reply) || "Sorry, I could not come up with an answer. Try rephrasing.";
  return finishTurn({ text, today, reply, rawActions: data.actions });
}

// Applies the actions the user confirmed, all in one transaction. Each action
// is { op, itemId?, item? } as returned by chat:send. Returns one result per action.
function applyActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new Error("Choose at least one change to apply.");
  }

  return database.transaction(() => actions.map((action) => {
    if (action?.op === "create") {
      return { actionId: action.actionId, op: "create", item: database.createItem({ ...itemIds(action.item), source: "manual" }) };
    }
    if (action?.op === "update") {
      const id = requiredId(action.itemId, "item");
      return { actionId: action.actionId, op: "update", item: database.updateItem(id, itemIds(action.item)) };
    }
    if (action?.op === "delete") {
      const id = requiredId(action.itemId, "item");
      database.deleteItem(id);
      return { actionId: action.actionId, op: "delete", itemId: id };
    }
    throw new Error("Unknown action.");
  }));
}

// Registers chat:send, chat:stream and chat:apply-actions. Reading and clearing history stay in ipc.js.
function registerChatHandlers() {
  ipcMain.handle("chat:send", (_event, content) => sendMessage(content));
  ipcMain.handle("chat:stream", (event, requestId, content) => streamMessage(event, String(requestId), content));
  ipcMain.handle("chat:apply-actions", (_event, actions) => applyActions(actions));
}

module.exports = { registerChatHandlers, parseStreamedReply, markerPrefixLength };
