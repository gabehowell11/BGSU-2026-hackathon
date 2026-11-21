const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  ITEM_TYPES,
  ITEM_STATUSES,
  ITEM_PRIORITIES,
  ITEM_SOURCES,
  USAGE_FEATURES,
  CHAT_ROLES,
  CHAT_HISTORY_LIMIT,
  DEFAULT_TIME_TYPES,
  DEFAULT_DUE_TIME,
} = require("../shared/schemas");
const {
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
  resolveWeekDate,
} = require("./validation");

// Bump this when the CREATE TABLE statements change. An older local file is
// dropped and recreated (run `npm run seed` again afterwards).
// CREATE TABLE IF NOT EXISTS does not add new columns.
const SCHEMA_VERSION = 2;
const DEFAULT_COURSE_COLOR = "#3157c8";

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
        CHECK (type IN ('assignment', 'quiz', 'exam', 'project', 'holiday', 'study', 'other')),
      due_date TEXT,
      due_time TEXT,
      weight_pct REAL,
      status TEXT NOT NULL DEFAULT 'todo'
        CHECK (status IN ('todo', 'in_progress', 'done')),
      priority TEXT
        CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high')),
      notes TEXT,
      estimated_minutes INTEGER
        CHECK (estimated_minutes IS NULL OR estimated_minutes >= 0),
      color TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- App settings such as onboardingComplete and userName. Values are JSON.
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Saved Aivana extraction results, keyed by a hash of everything sent,
    -- so uploading the same documents again costs no tokens.
    CREATE TABLE IF NOT EXISTS extraction_cache (
      cache_key TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      stored_path TEXT,
      plaintext TEXT NOT NULL DEFAULT '',
      sha256 TEXT,
      draft_count INTEGER NOT NULL DEFAULT 0,
      sent_as TEXT NOT NULL DEFAULT 'text',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_courses_term_id ON courses(term_id);
    CREATE INDEX IF NOT EXISTS idx_items_term_id ON items(term_id);
    CREATE INDEX IF NOT EXISTS idx_items_course_id ON items(course_id);
    CREATE INDEX IF NOT EXISTS idx_items_due_date ON items(due_date);
    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
    CREATE INDEX IF NOT EXISTS idx_usage_log_timestamp ON usage_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
  `);
  ensureItemMetadataColumns();
  ensureStarterWorkspace();
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
    DROP TABLE IF EXISTS extraction_cache;
    DROP TABLE IF EXISTS uploaded_files;
    DROP TABLE IF EXISTS settings;
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

// Adds optional assignment metadata without changing the existing core schema contract.
function ensureItemMetadataColumns() {
  const columns = database.prepare("PRAGMA table_info(items)").all();
  const names = new Set(columns.map((column) => column.name));
  const additions = [
    ["priority", "TEXT"],
    ["estimated_minutes", "INTEGER"],
    ["notes", "TEXT"],
    ["color", "TEXT"],
  ];
  for (const [name, definition] of additions) {
    if (!names.has(name)) {
      database.exec(`ALTER TABLE items ADD COLUMN ${name} ${definition}`);
    }
  }
}

// Creates a first-run workspace so the UI always has a term and selectable classes.
function ensureStarterWorkspace() {
  const existingTerm = database.prepare("SELECT id FROM terms ORDER BY id ASC LIMIT 1").get();
  if (existingTerm) return;

  const termResult = database.prepare(`
    INSERT INTO terms (name, start_date, end_date)
    VALUES (?, ?, ?)
  `).run("Fall 2026", "2026-08-24", "2026-12-11");
  const termId = insertId(termResult);

  database.prepare(`
    INSERT INTO courses (code, name, color, term_id)
    VALUES (?, ?, ?, ?)
  `).run("CS 3350", "Operating Systems", "#668cff", termId);
  database.prepare(`
    INSERT INTO courses (code, name, color, term_id)
    VALUES (?, ?, ?, ?)
  `).run("CS 3010", "Data Structures", "#bd86ff", termId);
  database.prepare(`
    INSERT INTO courses (code, name, color, term_id)
    VALUES (?, ?, ?, ?)
  `).run("MATH 3320", "Discrete Math", "#55b8a3", termId);
}

// Converts a SQLite insert id into a normal number.
function insertId(result) {
  return Number(result.lastInsertRowid);
}

let transactionDepth = 0;

// Runs the callback in one transaction and rolls it back if anything throws.
// A call inside another transaction joins the outer one, so an error anywhere
// rolls back everything.
function transaction(work) {
  if (transactionDepth > 0) return work();

  database.exec("BEGIN");
  transactionDepth += 1;
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    transactionDepth -= 1;
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

// Returns the term that contains the date, else the latest-starting term, else undefined.
function getCurrentTerm(date = localDate()) {
  return database.prepare(`
    SELECT id, name, start_date, end_date
    FROM terms
    WHERE start_date <= ? AND end_date >= ?
    ORDER BY start_date DESC, id DESC
    LIMIT 1
  `).get(date, date) || database.prepare(`
    SELECT id, name, start_date, end_date
    FROM terms
    ORDER BY start_date DESC, id DESC
    LIMIT 1
  `).get();
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
    optionalColor(course?.color, "Course color") || DEFAULT_COURSE_COLOR,
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
    optionalColor(course?.color, "Course color") || DEFAULT_COURSE_COLOR,
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
         items.priority, items.notes, items.estimated_minutes, items.color,
         items.completed_at, items.created_at, items.updated_at,
         courses.code AS course_code, courses.name AS course_name,
         courses.color AS course_color,
         COALESCE(items.color, courses.color) AS display_color
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

// Turns an item filter into SQL clauses. Every key is optional:
// termId, courseId, status, type, priority, verified (true/false), search (title or notes).
function itemFilterClauses(filter = {}) {
  const clauses = [];
  const params = [];
  if (filter?.termId) {
    clauses.push("items.term_id = ?");
    params.push(filter.termId);
  }
  if (filter?.courseId) {
    clauses.push("items.course_id = ?");
    params.push(filter.courseId);
  }
  if (filter?.status) {
    clauses.push("items.status = ?");
    params.push(oneOf(filter.status, ITEM_STATUSES, "Status"));
  }
  if (filter?.type) {
    clauses.push("items.type = ?");
    params.push(oneOf(filter.type, ITEM_TYPES, "Type"));
  }
  if (filter?.priority) {
    clauses.push("items.priority = ?");
    params.push(oneOf(filter.priority, ITEM_PRIORITIES, "Priority"));
  }
  if (filter?.verified === true) clauses.push("items.verified_at IS NOT NULL");
  if (filter?.verified === false) clauses.push("items.verified_at IS NULL");
  const search = blankToNull(filter?.search);
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push("(items.title LIKE ? ESCAPE '\\' OR items.notes LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  return { clauses, params };
}

// Returns items matching the optional filter, with undated rows last.
function listItems(filter = {}) {
  const { clauses, params } = itemFilterClauses(filter);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return database.prepare(`
    ${ITEM_SELECT}
    ${where}
    ${ITEM_ORDER}
  `).all(...params);
}

// Returns items whose due date falls inside the inclusive YYYY-MM-DD range,
// narrowed by the same optional filter as listItems.
function listItemsInRange(from, to, filter = {}) {
  const start = requireDate(from, "Range start");
  const end = requireDate(to, "Range end");
  if (start > end) {
    throw new Error("The range end must be on or after the start.");
  }

  const { clauses, params } = itemFilterClauses(filter);
  const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  return database.prepare(`
    ${ITEM_SELECT}
    WHERE items.due_date IS NOT NULL
      AND items.due_date >= ?
      AND items.due_date <= ?
      ${extra}
    ${ITEM_ORDER}
  `).all(start, end, ...params);
}

// Returns the home page summary for a local YYYY-MM-DD date (default today).
// Only verified items count, so unconfirmed AI guesses never show here.
function getSummary(today = localDate()) {
  const date = requireDate(today, "Today");
  const weekEnd = addDays(date, 7);
  const verified = `${ITEM_SELECT} WHERE items.verified_at IS NOT NULL`;
  const work = "items.type NOT IN ('holiday', 'study')";

  const dueToday = database.prepare(`
    ${verified} AND items.due_date = ? ${ITEM_ORDER}
  `).all(date);
  const upcoming = database.prepare(`
    ${verified} AND items.due_date > ? AND items.due_date <= ? ${ITEM_ORDER}
  `).all(date, weekEnd);
  const overdue = database.prepare(`
    ${verified} AND items.due_date < ? AND items.status <> 'done' AND ${work} ${ITEM_ORDER}
  `).all(date);
  const recentlyCompleted = database.prepare(`
    ${verified} AND items.status = 'done'
    ORDER BY items.completed_at DESC, items.id DESC
    LIMIT 5
  `).all();
  const needsReview = database.prepare(`
    SELECT COUNT(*) AS count FROM items WHERE verified_at IS NULL
  `).get().count;

  return {
    today: date,
    weekEnd,
    dueToday,
    upcoming,
    overdue,
    recentlyCompleted,
    counts: {
      dueToday: dueToday.length,
      upcoming: upcoming.length,
      overdue: overdue.length,
      needsReview: Number(needsReview),
    },
  };
}

// Returns the 11:59 PM default for dated assignments, quizzes, and projects
// that were given no time, otherwise the time as given.
function withDefaultDueTime(type, dueDate, dueTime) {
  if (dueTime || !dueDate || !DEFAULT_TIME_TYPES.includes(type)) return dueTime ?? null;
  return DEFAULT_DUE_TIME;
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

  const estimatedMinutes = optionalInteger(item.estimatedMinutes, "Estimated minutes");
  if (estimatedMinutes !== null && estimatedMinutes < 0) {
    throw new Error("Estimated minutes cannot be negative.");
  }

  return {
    title: requireText(item?.title, "item title"),
    type: oneOf(item.type, ITEM_TYPES, "Type", "assignment"),
    dueDate: optionalDate(item.dueDate, "Due date"),
    dueTime: optionalTime(item.dueTime),
    weightPct,
    status: oneOf(item.status, ITEM_STATUSES, "Status", "todo"),
    priority: optionalChoice(item.priority, ITEM_PRIORITIES, "Priority"),
    notes: blankToNull(item.notes),
    estimatedMinutes,
    color: optionalColor(item.color),
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
      title, type, due_date, due_time, weight_pct, status, priority, notes,
      estimated_minutes, color, term_id, course_id,
      source, date_text, week, weekday, source_quote, confidence, source_file,
      ai_due_date, verified_at, completed_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END,
      CASE WHEN ? = 'done' THEN datetime('now') ELSE NULL END
    )
  `).run(
    values.title,
    values.type,
    values.dueDate,
    withDefaultDueTime(values.type, values.dueDate, values.dueTime),
    values.weightPct,
    values.status,
    values.priority,
    values.notes,
    values.estimatedMinutes,
    values.color,
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
    values.status,
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
    priority: patch.priority !== undefined ? patch.priority : existing.priority,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    estimatedMinutes: patch.estimatedMinutes !== undefined
      ? patch.estimatedMinutes
      : existing.estimated_minutes,
    color: patch.color !== undefined ? patch.color : existing.color,
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
        status = ?, priority = ?, notes = ?, estimated_minutes = ?, color = ?,
        term_id = ?, course_id = ?, source = ?, date_text = ?,
        week = ?, weekday = ?, source_quote = ?, confidence = ?, source_file = ?,
        ai_due_date = ?,
        completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    values.title,
    values.type,
    values.dueDate,
    values.dueTime,
    values.weightPct,
    values.status,
    values.priority,
    values.notes,
    values.estimatedMinutes,
    values.color,
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
    values.status,
    id,
  );

  if (result.changes === 0) throw new Error("Item not found.");
  return getItem(id);
}

// Applies the same patch to every listed item in one transaction. Any error
// rolls the whole batch back. Use it for bulk status, priority, course, or date changes.
function updateItems(ids, patch) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("At least one item ID is required.");
  }
  return transaction(() => ids.map((id) => updateItem(id, patch || {})));
}

// Changes one item's status without touching its other fields.
function setItemStatus(id, status) {
  const chosen = oneOf(status, ITEM_STATUSES, "Status");
  const result = database.prepare(`
    UPDATE items
    SET status = ?,
        completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, datetime('now')) ELSE NULL END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(chosen, chosen, id);
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

// Deletes every listed item in one transaction. A missing id rolls it all back.
function deleteItems(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("At least one item ID is required.");
  }
  transaction(() => ids.forEach((id) => deleteItem(id)));
  return ids.length;
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
  const role = oneOf(blankToNull(message?.role), CHAT_ROLES, "Chat role");
  const content = blankToNull(message?.content);
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

const EXTRACTION_CACHE_LIMIT = 50;

// Returns the saved raw extraction result for a cache key, or null.
function getCachedExtraction(cacheKey) {
  const row = database.prepare(`
    SELECT items_json FROM extraction_cache WHERE cache_key = ?
  `).get(cacheKey);
  if (!row) return null;
  try {
    const result = JSON.parse(row.items_json);
    return result && typeof result === "object" ? result : null;
  } catch {
    return null;
  }
}

// Saves a raw extraction result under a cache key and keeps only the newest entries.
function saveCachedExtraction(cacheKey, items) {
  database.prepare(`
    INSERT OR REPLACE INTO extraction_cache (cache_key, items_json, created_at)
    VALUES (?, ?, datetime('now'))
  `).run(cacheKey, JSON.stringify(items));
  database.prepare(`
    DELETE FROM extraction_cache
    WHERE cache_key NOT IN (
      SELECT cache_key FROM extraction_cache ORDER BY created_at DESC, rowid DESC LIMIT ?
    )
  `).run(EXTRACTION_CACHE_LIMIT);
}

function saveUploadedFile(file) {
  if (file.sha256) {
    const existing = database.prepare(`
      SELECT id FROM uploaded_files WHERE sha256 = ?
      ORDER BY id DESC LIMIT 1
    `).get(file.sha256);
    if (existing) {
      database.prepare(`
        UPDATE uploaded_files
        SET name = ?, plaintext = ?, draft_count = ?, sent_as = ?, created_at = datetime('now')
        WHERE id = ?
      `).run(
        String(file.name).slice(0, 255),
        String(file.plaintext || "").slice(0, 400000),
        Number(file.draftCount || 0),
        file.sentAs === "file" ? "file" : "text",
        existing.id,
      );
      return database.prepare(
        "SELECT * FROM uploaded_files WHERE id = ?",
      ).get(existing.id);
    }
  }
  const result = database.prepare(`
    INSERT INTO uploaded_files (
      name, mime_type, file_size, stored_path, plaintext, sha256,
      draft_count, sent_as
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(file.name).slice(0, 255),
    file.mimeType || null,
    Number(file.fileSize || 0),
    file.storedPath || null,
    String(file.plaintext || "").slice(0, 400000),
    file.sha256 || null,
    Number(file.draftCount || 0),
    file.sentAs === "file" ? "file" : "text",
  );
  return database.prepare(
    "SELECT * FROM uploaded_files WHERE id = ?",
  ).get(result.lastInsertRowid);
}

function listUploadedFiles() {
  return database.prepare(`
    SELECT id, name, mime_type, file_size, plaintext, sha256,
           draft_count, sent_as, created_at
    FROM uploaded_files
    ORDER BY created_at DESC, id DESC
  `).all();
}

function deleteUploadedFile(id) {
  const result = database.prepare(
    "DELETE FROM uploaded_files WHERE id = ?",
  ).run(id);
  return result.changes > 0;
}

// Settings every caller gets even before anything is saved.
const DEFAULT_SETTINGS = {
  onboardingComplete: false,
  userName: null,
};
const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const MAX_SETTING_CHARS = 10000;

// Checks the known settings and returns the value to store.
function settingValue(key, value) {
  if (key === "onboardingComplete") {
    if (typeof value !== "boolean") throw new Error("onboardingComplete must be true or false.");
    return value;
  }
  if (key === "userName") {
    const name = blankToNull(value);
    if (name !== null && name.length > 60) throw new Error("The name can be at most 60 characters.");
    return name;
  }
  return value === undefined ? null : value;
}

// Returns every setting, with defaults filled in for unsaved keys.
function getSettings() {
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of database.prepare("SELECT key, value FROM settings").all()) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      // Ignore a corrupt value and keep the default.
    }
  }
  return settings;
}

// Saves the given keys (other keys are left as they are) and returns all settings.
// A null value resets that key to its default.
function updateSettings(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Settings must be an object.");
  }

  transaction(() => {
    for (const [key, raw] of Object.entries(patch)) {
      if (!SETTING_KEY.test(key)) throw new Error(`"${key}" is not a valid setting name.`);
      if (raw === null) {
        database.prepare("DELETE FROM settings WHERE key = ?").run(key);
        continue;
      }
      const json = JSON.stringify(settingValue(key, raw));
      if (json.length > MAX_SETTING_CHARS) throw new Error(`The ${key} setting is too large.`);
      database.prepare(`
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, json);
    }
  });
  return getSettings();
}

// Colors given to courses created during setup, so each course looks different.
const COURSE_PALETTE = ["#3157c8", "#c45c26", "#2f7d4a", "#8a3fb8", "#b8325a", "#1f8a99", "#a07a12", "#5a6b7d"];

// Creates (or reuses) a term and course and saves the confirmed items, all in
// one transaction. Used by onboarding after a syllabus upload with no term yet.
// setup: {
//   term: { id } or { name, startDate, endDate }  (reused if one matches exactly),
//   course: { id } or { code, name, color? } or null  (reused if the code exists in the term),
//   items: drafts from extract:run (may be empty),
// }
// Items get the term, and the course unless they set courseId or are holidays.
// An item whose dueDate still equals its weekDate (the date worked out from
// "Week N weekday") is recomputed from the final term start date, in case the
// user changed it. Returns { term, course, created, skipped }.
function createSetup(setup) {
  return transaction(() => {
    const term = resolveSetupTerm(setup?.term);
    const course = resolveSetupCourse(setup?.course, term);
    const items = Array.isArray(setup?.items) ? setup.items : [];

    const prepared = items.map((item) => {
      const next = { ...item, termId: term.id };
      if (next.courseId === undefined || next.courseId === null) {
        next.courseId = next.type === "holiday" ? null : (course ? course.id : null);
      }
      if (next.weekDate && next.dueDate === next.weekDate && next.week && next.weekday) {
        next.dueDate = resolveWeekDate(term, next.week, next.weekday) || next.dueDate;
      }
      return next;
    });

    const saved = prepared.length > 0
      ? createItems(prepared, { verified: true })
      : { created: [], skipped: [] };
    return { term, course, created: saved.created, skipped: saved.skipped };
  });
}

// Returns the setup's term: an existing one by id, an exact name-and-dates match, or a new one.
function resolveSetupTerm(input) {
  if (input?.id) {
    const existing = getTerm(input.id);
    if (!existing) throw new Error("Term not found.");
    return existing;
  }
  const values = termValues(input);
  const match = database.prepare(`
    SELECT id, name, start_date, end_date
    FROM terms
    WHERE lower(name) = lower(?) AND start_date = ? AND end_date = ?
  `).get(values.name, values.startDate, values.endDate);
  return match || createTerm(input);
}

// Returns the setup's course: an existing one by id, one with the same code in
// the term, a new one, or null when none was given.
function resolveSetupCourse(input, term) {
  if (!input) return null;
  if (input.id) {
    const existing = getCourse(input.id);
    if (!existing) throw new Error("Course not found.");
    if (existing.term_id !== term.id) throw new Error("That course belongs to a different term.");
    return existing;
  }
  if (!blankToNull(input.code) && !blankToNull(input.name)) return null;

  const code = requireText(input.code, "course code");
  const match = database.prepare(`
    SELECT id, code, name, color, term_id
    FROM courses
    WHERE term_id = ? AND lower(code) = lower(?)
  `).get(term.id, code);
  if (match) return match;

  const count = database.prepare("SELECT COUNT(*) AS count FROM courses").get().count;
  return createCourse({
    code,
    name: blankToNull(input.name) || code,
    color: blankToNull(input.color) || COURSE_PALETTE[Number(count) % COURSE_PALETTE.length],
    termId: term.id,
  });
}

module.exports = {
  SCHEMA_VERSION,
  openDatabase,
  closeDatabase,
  transaction,
  listTerms,
  getTerm,
  getCurrentTerm,
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
  getSummary,
  findDuplicate,
  withDefaultDueTime,
  createItem,
  createItems,
  updateItem,
  updateItems,
  setItemStatus,
  setItemVerified,
  verifyItems,
  deleteItem,
  deleteItems,
  listUsage,
  logUsage,
  listChatMessages,
  listRecentChatMessages,
  addChatMessage,
  clearChatMessages,
  getCachedExtraction,
  saveCachedExtraction,
  saveUploadedFile,
  listUploadedFiles,
  deleteUploadedFile,
  getSettings,
  updateSettings,
  createSetup,
};
