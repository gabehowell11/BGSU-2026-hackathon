const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

let database;

function openDatabase(userDataDirectory) {
  fs.mkdirSync(userDataDirectory, { recursive: true });

  const databasePath = path.join(userDataDirectory, "student-task-manager.db");
  database = new DatabaseSync(databasePath);

  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      class_name TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'not_started',
      priority TEXT NOT NULL DEFAULT 'normal',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      class_name TEXT NOT NULL DEFAULT '',
      event_date TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'event',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_assignments_due_date
      ON assignments(due_date);

    CREATE INDEX IF NOT EXISTS idx_calendar_events_date
      ON calendar_events(event_date);
  `);

  return databasePath;
}

function listAssignments() {
  return database.prepare(`
    SELECT id, title, class_name, due_date, status, priority, notes,
           created_at, updated_at
    FROM assignments
    ORDER BY
      CASE WHEN due_date IS NULL OR due_date = '' THEN 1 ELSE 0 END,
      due_date ASC,
      id DESC
  `).all();
}

function createAssignment(assignment) {
  const result = database.prepare(`
    INSERT INTO assignments (
      title, class_name, due_date, status, priority, notes
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    assignment.title.trim(),
    (assignment.className || "").trim(),
    assignment.dueDate || null,
    assignment.status || "not_started",
    assignment.priority || "normal",
    assignment.notes || "",
  );

  return database.prepare(`
    SELECT id, title, class_name, due_date, status, priority, notes,
           created_at, updated_at
    FROM assignments
    WHERE id = ?
  `).get(result.lastInsertRowid);
}

function updateAssignment(id, assignment) {
  const result = database.prepare(`
    UPDATE assignments
    SET title = ?,
        class_name = ?,
        due_date = ?,
        status = ?,
        priority = ?,
        notes = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    assignment.title.trim(),
    (assignment.className || "").trim(),
    assignment.dueDate || null,
    assignment.status || "not_started",
    assignment.priority || "normal",
    assignment.notes || "",
    id,
  );

  if (result.changes === 0) {
    throw new Error("Assignment not found.");
  }

  return database.prepare(`
    SELECT id, title, class_name, due_date, status, priority, notes,
           created_at, updated_at
    FROM assignments
    WHERE id = ?
  `).get(id);
}

function deleteAssignment(id) {
  const result = database.prepare(
    "DELETE FROM assignments WHERE id = ?",
  ).run(id);

  if (result.changes === 0) {
    throw new Error("Assignment not found.");
  }

  return true;
}

function listCalendarEvents() {
  return database.prepare(`
    SELECT id, title, class_name, event_date, event_type, notes,
           created_at, updated_at
    FROM calendar_events
    ORDER BY event_date ASC, id ASC
  `).all();
}

function createCalendarEvent(event) {
  const result = database.prepare(`
    INSERT INTO calendar_events (
      title, class_name, event_date, event_type, notes
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    event.title.trim(),
    (event.className || "").trim(),
    event.eventDate,
    event.eventType || "event",
    event.notes || "",
  );

  return database.prepare(
    "SELECT * FROM calendar_events WHERE id = ?",
  ).get(result.lastInsertRowid);
}

function closeDatabase() {
  if (database) {
    database.close();
    database = undefined;
  }
}

module.exports = {
  openDatabase,
  closeDatabase,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  listCalendarEvents,
  createCalendarEvent,
};
