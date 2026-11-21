const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  ITEM_TYPES,
  ITEM_STATUSES,
  ITEM_SOURCES,
  USAGE_FEATURES,
  CHAT_HISTORY_LIMIT,
} = require("../shared/schemas");
const {
  blankToNull,
  requireText,
  requireDate,
  optionalDate,
  optionalNumber,
  optionalInteger,
  oneOf,
  optionalWeekday,
  optionalConfidence,
} = require("./validation");

// Bump this when the CREATE TABLE statements change. An older local file is
// dropped and recreated. CREATE TABLE IF NOT EXISTS does not add new columns.
const SCHEMA_VERSION = 1;

let database;

// Opens the SQLite file, recreates it when the schema version is old, and creates any missing tables.
function openDatabase(userDataDirectory) {
  fs.mkdirSync(userDataDirectory, { recursive: true });

  const databasePath = path.join(userDataDirectory, "student-task-manager.db");
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");

  const versionRow = database.prepare("PRAGMA user_version").get();
  const userVersion = Number(versionRow?.user_version ?? 0);
  if (userVersion !== SCHEMA_VERSION) {
    resetSchema();
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#3157c8',
      term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'assignment'
        CHECK (type IN ('assignment', 'quiz', 'exam', 'project', 'holiday', 'other')),
      due_date TEXT,
      due_time TEXT,
      weight_pct REAL,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'done')),
      term_id INTEGER NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'manual'
        CHECK (source IN ('ai', 'manual')),
      date_text TEXT,
      week INTEGER,
      weekday TEXT,
      source_quote TEXT,
      confidence REAL
        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      source_file TEXT,
      ai_due_date TEXT,
      verified_at TEXT
    );

    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      feature TEXT NOT NULL CHECK (feature IN ('extract', 'chat')),
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      credits REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_courses_term_id ON courses(term_id);
    CREATE INDEX IF NOT EXISTS idx_items_term_id ON items(term_id);
    CREATE INDEX IF NOT EXISTS idx_items_course_id ON items(course_id);
    CREATE INDEX IF NOT EXISTS idx_items_due_date ON items(due_date);
    CREATE INDEX IF NOT EXISTS idx_usage_log_timestamp ON usage_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
  `);
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  return databasePath;
}

// Drops every known table so the next create statements can rebuild the schema.
function resetSchema() {
  database.exec("PRAGMA foreign_keys = OFF;");
  database.exec(`
    DROP TABLE IF EXISTS items;
    DROP TABLE IF EXISTS courses;
    DROP TABLE IF EXISTS terms;
    DROP TABLE IF EXISTS usage_log;
    DROP TABLE IF EXISTS chat_messages;
    DROP TABLE IF EXISTS calendar_events;
    DROP TABLE IF EXISTS assignments;
  `);
  database.exec("PRAGMA foreign_keys = ON;");
}

// Closes the open database connection.
function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
}

// Converts a SQLite insert id into a normal number.
function insertId(result) {
  return Number(result.lastInsertRowid);
}

// Runs the callback in one transaction and rolls it back if anything throws.
function transaction(work) {
  database.exec("BEGIN");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

// Returns every term, earliest start date first.
function listTerms() {
  return database.prepare(`
    SELECT id, name, start_date, end_date
    FROM terms
    ORDER BY start_date ASC, id ASC
  `).all();
}

// Checks a term's name and dates, and rejects an end date before the start date.
function termValues(term) {
  const name = requireText(term?.name, "term name");
  const startDate = requireDate(term?.startDate, "Term start date");
  const endDate = requireDate(term?.endDate, "Term end date");
  if (startDate > endDate) {
    throw new Error("The term end date must be on or after the start date.");
  }
  return { name, startDate, endDate };
}

// Inserts a term and returns the saved row.
function createTerm(term) {
  const values = termValues(term);
  const result = database.prepare(`
    INSERT INTO terms (name, start_date, end_date)
    VALUES (?, ?, ?)
  `).run(values.name, values.startDate, values.endDate);

  return getTerm(insertId(result));
}

// Replaces a term's name and dates, then returns the saved row.
function updateTerm(id, term) {
  const values = termValues(term);
  const result = database.prepare(`
    UPDATE terms
    SET name = ?, start_date = ?, end_date = ?
    WHERE id = ?
  `).run(values.name, values.startDate, values.endDate, id);

  if (result.changes === 0) throw new Error("Term not found.");
  return getTerm(id);
}

// Deletes a term, which also deletes its courses and items.
function deleteTerm(id) {
  const result = database.prepare("DELETE FROM terms WHERE id = ?").run(id);
  if (result.changes === 0) throw new Error("Term not found.");
  return true;
}

// Returns one term by id, or undefined when it does not exist.
function getTerm(id) {
  return database.prepare(`
    SELECT id, name, start_date, end_date
    FROM terms
    WHERE id = ?
  `).get(id);
}

// Returns every course, or only the courses in one term when a term id is given.
function listCourses(termId) {
  if (termId) {
    return database.prepare(`
      SELECT id, code, name, color, term_id
      FROM courses
      WHERE term_id = ?
      ORDER BY code ASC, id ASC
    `).all(termId);
  }

  return database.prepare(`
    SELECT id, code, name, color, term_id
    FROM courses
    ORDER BY code ASC, id ASC
  `).all();
}

// Inserts a course under an existing term and returns the saved row.
function createCourse(course) {
  const term = getTerm(course?.termId);
  if (!term) throw new Error("Term not found.");

  const result = database.prepare(`
    INSERT INTO courses (code, name, color, term_id)
    VALUES (?, ?, ?, ?)
  `).run(
    requireText(course?.code, "course code"),
    requireText(course?.name, "course name"),
    blankToNull(course?.color) || "#3157c8",
    course.termId,
  );

  return getCourse(insertId(result));
}

// Replaces a course's code, name, color, and term, then returns the saved row.
function updateCourse(id, course) {
  const term = getTerm(course?.termId);
  if (!term) throw new Error("Term not found.");

  const result = database.prepare(`
    UPDATE courses
    SET code = ?, name = ?, color = ?, term_id = ?
    WHERE id = ?
  `).run(
    requireText(course?.code, "course code"),
    requireText(course?.name, "course name"),
    blankToNull(course?.color) || "#3157c8",
    course.termId,
    id,
  );

  if (result.changes === 0) throw new Error("Course not found.");
  return getCourse(id);
}

// Deletes a course, which also deletes its items.
function deleteCourse(id) {
  const result = database.prepare("DELETE FROM courses WHERE id = ?").run(id);
  if (result.changes === 0) throw new Error("Course not found.");
  return true;
}

// Returns one course by id, or undefined when it does not exist.
function getCourse(id) {
  return database.prepare(`
    SELECT id, code, name, color, term_id
    FROM courses
    WHERE id = ?
  `).get(id);
}

const ITEM_SELECT = `
  SELECT items.id, items.title, items.type, items.due_date, items.due_time,
         items.weight_pct, items.status, items.term_id, items.course_id, items.source,
         items.date_text, items.week, items.weekday, items.source_quote,
         items.confidence, items.source_file, items.ai_due_date, items.verified_at,
         courses.code AS course_code, courses.name AS course_name,
         courses.color AS course_color
  FROM items
  LEFT JOIN courses ON courses.id = items.course_id
`;

const ITEM_ORDER = `
  ORDER BY
    CASE WHEN items.due_date IS NULL OR items.due_date = '' THEN 1 ELSE 0 END,
    items.due_date ASC,
    items.due_time ASC,
    items.id DESC
`;

// Returns items, optionally limited to one term, with undated rows last.
function listItems(filter = {}) {
  const clauses = [];
  const params = [];
  if (filter?.termId) {
    clauses.push("items.term_id = ?");
    params.push(filter.termId);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return database.prepare(`
    ${ITEM_SELECT}
    ${where}
    ${ITEM_ORDER}
  `).all(...params);
}

// Returns items whose due date falls inside the inclusive YYYY-MM-DD range.
function listItemsInRange(from, to) {
  const start = requireDate(from, "Range start");
  const end = requireDate(to, "Range end");
  if (start > end) {
    throw new Error("The range end must be on or after the start.");
  }

  return database.prepare(`
    ${ITEM_SELECT}
    WHERE items.due_date IS NOT NULL
      AND items.due_date >= ?
      AND items.due_date <= ?
    ${ITEM_ORDER}
  `).all(start, end);
}

// Checks an item and returns the values ready to store.
function itemValues(item) {
  const term = getTerm(item?.termId);
  if (!term) throw new Error("Term not found.");

  const courseId = item.courseId ?? null;
  if (courseId !== null) {
    const course = getCourse(courseId);
    if (!course) throw new Error("Course not found.");
    if (course.term_id !== item.termId) {
      throw new Error("That course belongs to a different term.");
    }
  }

  const weightPct = optionalNumber(item.weightPct, "Weight");
  if (weightPct !== null && (weightPct < 0 || weightPct > 100)) {
    throw new Error("Weight must be between 0 and 100.");
  }

  return {
    title: requireText(item?.title, "item title"),
    type: oneOf(item.type, ITEM_TYPES, "Type", "assignment"),
    dueDate: optionalDate(item.dueDate, "Due date"),
    dueTime: blankToNull(item.dueTime),
    weightPct,
    status: oneOf(item.status, ITEM_STATUSES, "Status", "todo"),
    termId: item.termId,
    courseId,
    source: oneOf(item.source, ITEM_SOURCES, "Source", "manual"),
    dateText: blankToNull(item.dateText),
    week: optionalInteger(item.week, "Week"),
    weekday: optionalWeekday(item.weekday),
    sourceQuote: blankToNull(item.sourceQuote),
    confidence: optionalConfidence(item.confidence),
    sourceFile: blankToNull(item.sourceFile),
    aiDueDate: item.aiDueDate === undefined
      ? undefined
      : optionalDate(item.aiDueDate, "AI due date"),
  };
}

// Finds an existing item with the same title, course, and due date.
function findDuplicate(title, courseId, dueDate) {
  return database.prepare(`
    SELECT id
    FROM items
    WHERE title = ?
      AND course_id IS ?
      AND due_date IS ?
  `).get(title, courseId, dueDate);
}

// Inserts one checked item. Manual rows, and rows passed verified, get verified_at set.
function insertItem(values, options = {}) {
  const aiDueDate = values.aiDueDate !== undefined
    ? values.aiDueDate
    : (values.source === "ai" ? values.dueDate : null);
  const markVerified = options.verified === true || values.source === "manual";

  const result = database.prepare(`
    INSERT INTO items (
      title, type, due_date, due_time, weight_pct, status, term_id, course_id,
      source, date_text, week, weekday, source_quote, confidence, source_file,
      ai_due_date, verified_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
    )
  `).run(
    values.title,
    values.type,
    values.dueDate,
    values.dueTime,
    values.weightPct,
    values.status,
    values.termId,
    values.courseId,
    values.source,
    values.dateText,
    values.week,
    values.weekday,
    values.sourceQuote,
    values.confidence,
    values.sourceFile,
    aiDueDate,
    markVerified ? 1 : 0,
  );

  return getItem(insertId(result));
}

// Saves one item, or throws when that course, title, and due date already exist.
function createItem(item) {
  const values = itemValues(item);
  if (findDuplicate(values.title, values.courseId, values.dueDate)) {
    throw new Error("An item with this course, title, and due date already exists.");
  }
  return insertItem(values);
}

// Batch save policy: a validation or database error rolls the whole batch
// back, so a bad row cannot leave half a syllabus saved. A duplicate (same
// course, title, and due date) is skipped and listed in `skipped`; the other
// rows still save. Pass { verified: true } to mark every inserted row
// verified in that same transaction. Manual rows are verified either way.
function createItems(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one item is required.");
  }

  return transaction(() => {
    const created = [];
    const skipped = [];

    for (const item of items) {
      const values = itemValues(item);
      const duplicate = findDuplicate(values.title, values.courseId, values.dueDate);
      if (duplicate) {
        skipped.push({
          title: values.title,
          courseId: values.courseId,
          dueDate: values.dueDate,
          existingId: duplicate.id,
        });
        continue;
      }
      created.push(insertItem(values, options));
    }

    return { created, skipped };
  });
}

// Updates only the fields present in the patch and leaves the rest unchanged.
function updateItem(id, patch) {
  const existing = getItem(id);
  if (!existing) throw new Error("Item not found.");

  const values = itemValues({
    title: patch.title !== undefined ? patch.title : existing.title,
    type: patch.type !== undefined ? patch.type : existing.type,
    dueDate: patch.dueDate !== undefined ? patch.dueDate : existing.due_date,
    dueTime: patch.dueTime !== undefined ? patch.dueTime : existing.due_time,
    weightPct: patch.weightPct !== undefined ? patch.weightPct : existing.weight_pct,
    status: patch.status !== undefined ? patch.status : existing.status,
    termId: patch.termId !== undefined ? patch.termId : existing.term_id,
    courseId: patch.courseId !== undefined ? patch.courseId : existing.course_id,
    source: patch.source !== undefined ? patch.source : existing.source,
    dateText: patch.dateText !== undefined ? patch.dateText : existing.date_text,
    week: patch.week !== undefined ? patch.week : existing.week,
    weekday: patch.weekday !== undefined ? patch.weekday : existing.weekday,
    sourceQuote: patch.sourceQuote !== undefined ? patch.sourceQuote : existing.source_quote,
    confidence: patch.confidence !== undefined ? patch.confidence : existing.confidence,
    sourceFile: patch.sourceFile !== undefined ? patch.sourceFile : existing.source_file,
    aiDueDate: patch.aiDueDate !== undefined ? patch.aiDueDate : existing.ai_due_date,
  });

  const duplicate = findDuplicate(values.title, values.courseId, values.dueDate);
  if (duplicate && duplicate.id !== id) {
    throw new Error("An item with this course, title, and due date already exists.");
  }

  const result = database.prepare(`
    UPDATE items
    SET title = ?, type = ?, due_date = ?, due_time = ?, weight_pct = ?,
        status = ?, term_id = ?, course_id = ?, source = ?, date_text = ?,
        week = ?, weekday = ?, source_quote = ?, confidence = ?, source_file = ?,
        ai_due_date = ?
    WHERE id = ?
  `).run(
    values.title,
    values.type,
    values.dueDate,
    values.dueTime,
    values.weightPct,
    values.status,
    values.termId,
    values.courseId,
    values.source,
    values.dateText,
    values.week,
    values.weekday,
    values.sourceQuote,
    values.confidence,
    values.sourceFile,
    values.aiDueDate,
    id,
  );

  if (result.changes === 0) throw new Error("Item not found.");
  return getItem(id);
}

// Changes one item's status without touching its other fields.
function setItemStatus(id, status) {
  const chosen = oneOf(status, ITEM_STATUSES, "Status");
  const result = database.prepare(`
    UPDATE items SET status = ? WHERE id = ?
  `).run(chosen, id);
  if (result.changes === 0) throw new Error("Item not found.");
  return getItem(id);
}

// Marks one item verified by setting verified_at to now.
function setItemVerified(id) {
  const result = database.prepare(`
    UPDATE items SET verified_at = datetime('now') WHERE id = ?
  `).run(id);
  if (result.changes === 0) throw new Error("Item not found.");
  return getItem(id);
}

// Marks every listed item verified in one transaction.
function verifyItems(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("At least one item ID is required.");
  }

  return transaction(() => ids.map((id) => setItemVerified(id)));
}

// Deletes one item.
function deleteItem(id) {
  const result = database.prepare("DELETE FROM items WHERE id = ?").run(id);
  if (result.changes === 0) throw new Error("Item not found.");
  return true;
}

// Returns one item with its course code, name, and color, or undefined.
function getItem(id) {
  return database.prepare(`${ITEM_SELECT} WHERE items.id = ?`).get(id);
}

// Returns Aivana usage rows, newest first.
function listUsage() {
  return database.prepare(`
    SELECT id, timestamp, feature, input_tokens, output_tokens, credits
    FROM usage_log
    ORDER BY timestamp DESC, id DESC
  `).all();
}

// Records one Aivana call's feature, token counts, and credits.
function logUsage(entry) {
  const feature = oneOf(entry?.feature, USAGE_FEATURES, "Feature");
  const inputTokens = optionalInteger(entry?.inputTokens, "Input tokens") ?? 0;
  const outputTokens = optionalInteger(entry?.outputTokens, "Output tokens") ?? 0;
  const credits = optionalNumber(entry?.credits, "Credits") ?? 0;

  const result = database.prepare(`
    INSERT INTO usage_log (feature, input_tokens, output_tokens, credits)
    VALUES (?, ?, ?, ?)
  `).run(feature, inputTokens, outputTokens, credits);

  return database.prepare(`
    SELECT id, timestamp, feature, input_tokens, output_tokens, credits
    FROM usage_log
    WHERE id = ?
  `).get(insertId(result));
}

// Returns the full chat history in chronological order.
function listChatMessages() {
  return database.prepare(`
    SELECT id, role, content, timestamp
    FROM chat_messages
    ORDER BY timestamp ASC, id ASC
  `).all();
}

// Returns at most the last 8 chat messages, oldest of that slice first.
function listRecentChatMessages(limit = CHAT_HISTORY_LIMIT) {
  const requested = Number.isInteger(limit) && limit > 0 ? limit : CHAT_HISTORY_LIMIT;
  const safeLimit = Math.min(requested, CHAT_HISTORY_LIMIT);
  const rows = database.prepare(`
    SELECT id, role, content, timestamp
    FROM chat_messages
    ORDER BY id DESC
    LIMIT ?
  `).all(safeLimit);
  return rows.reverse();
}

// Saves one chat message and returns the saved row.
function addChatMessage(message) {
  const role = blankToNull(message?.role);
  const content = blankToNull(message?.content);
  if (!role) throw new Error("A chat role is required.");
  if (!content) throw new Error("Chat content is required.");

  const result = database.prepare(`
    INSERT INTO chat_messages (role, content)
    VALUES (?, ?)
  `).run(role, content);

  return database.prepare(`
    SELECT id, role, content, timestamp
    FROM chat_messages
    WHERE id = ?
  `).get(insertId(result));
}

// Deletes every saved chat message.
function clearChatMessages() {
  database.prepare("DELETE FROM chat_messages").run();
  return true;
}

module.exports = {
  SCHEMA_VERSION,
  openDatabase,
  closeDatabase,
  listTerms,
  getTerm,
  createTerm,
  updateTerm,
  deleteTerm,
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  listItems,
  getItem,
  listItemsInRange,
  createItem,
  createItems,
  updateItem,
  setItemStatus,
  setItemVerified,
  verifyItems,
  deleteItem,
  listUsage,
  logUsage,
  listChatMessages,
  listRecentChatMessages,
  addChatMessage,
  clearChatMessages,
};
