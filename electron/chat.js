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
const MAX_CONTEXT_ITEMS = 150;

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

// Describes one item on a single line for the model.
function itemLine(item) {
  const due = item.due_date ? `due ${item.due_date}${item.due_time ? ` ${item.due_time}` : ""}` : "no date";
  const parts = [
    `#${item.id}`,
    item.title,
    item.type,
    item.course_code || "no course",
    due,
    item.status,
  ];
  if (item.priority) parts.push(`priority ${item.priority}`);
  if (item.estimated_minutes) parts.push(`~${item.estimated_minutes} min`);
  return parts.join(" | ");
}

// Builds the planner snapshot sent with each message: today, terms, courses,
// and the verified items that matter now (recent, upcoming, overdue, undated).
function plannerContext(today) {
  const weekday = new Date(`${today}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  const terms = database.listTerms();
  const courses = database.listCourses();
  const termNames = new Map(terms.map((term) => [term.id, term.name]));
  const from = addDays(today, -14);
  const to = addDays(today, 60);

  const items = database.listItems({ verified: true }).filter((item) => (
    !item.due_date
    || (item.due_date >= from && item.due_date <= to)
    || (item.due_date < today && item.status !== "done")
  )).slice(0, MAX_CONTEXT_ITEMS);

  return [
    `Today is ${weekday}, ${today}.`,
    "Terms:",
    ...(terms.length ? terms.map((term) => `- ${term.name}: ${term.start_date} to ${term.end_date}`) : ["- none"]),
    "Courses (course_id: code name, term):",
    ...(courses.length
      ? courses.map((course) => `- ${course.id}: ${course.code} ${course.name}, ${termNames.get(course.term_id) || "?"}`)
      : ["- none"]),
    "Items (id | title | type | course | due | status):",
    ...(items.length ? items.map(itemLine) : ["- none"]),
  ].join("\n");
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

// Sends one message with recent history and the planner snapshot. Returns
// Aivana's reply and proposed actions. Nothing in the planner changes until
// the renderer passes confirmed actions to chat:apply-actions.
async function sendMessage(content) {
  const text = blankToNull(content);
  if (!text) throw new Error("Type a message first.");
  if (text.length > MAX_MESSAGE_CHARS) {
    throw new Error(`Messages are limited to ${MAX_MESSAGE_CHARS} characters.`);
  }

  const today = localDate();
  const history = database.listRecentChatMessages().map(({ role, content: body }) => ({ role, content: body }));
  const messages = [
    ...history,
    { role: "user", content: `${text}\n\n--- Planner data (for reference) ---\n${plannerContext(today)}` },
  ];

  const { data } = await aivana.generateStructured({
    feature: "chat",
    prompt: null,
    schema: chatResponseSchema,
    system: SYSTEM_PROMPT,
    assistantName: "Aivana",
    messages,
  });

  const reply = blankToNull(data.reply) || "Sorry, I could not come up with an answer. Try rephrasing.";
  const currentTerm = database.getCurrentTerm(today);
  const actions = [];
  const rejected = [];
  (Array.isArray(data.actions) ? data.actions : []).forEach((raw) => {
    const result = normalizeAction(raw, actions.length + 1, currentTerm);
    if (result.action) actions.push(result.action);
    else rejected.push(result.rejected);
  });

  // Save both turns only after Aivana answered, so a failed call leaves no orphan message.
  const saved = database.transaction(() => ({
    user: database.addChatMessage({ role: "user", content: text }),
    assistant: database.addChatMessage({ role: "assistant", content: reply }),
  }));

  return { reply, actions, rejected, messages: saved };
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

// Registers chat:send and chat:apply-actions. Reading and clearing history stay in ipc.js.
function registerChatHandlers() {
  ipcMain.handle("chat:send", (_event, content) => sendMessage(content));
  ipcMain.handle("chat:apply-actions", (_event, actions) => applyActions(actions));
}

module.exports = { registerChatHandlers };
