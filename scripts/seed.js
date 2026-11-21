const path = require("node:path");
const database = require("../electron/database");

const appData = process.env.APPDATA;
if (!appData) {
  throw new Error("APPDATA is not set, so the Electron database folder cannot be found.");
}

const userDataDirectory = path.join(appData, "ai-student-task-manager");

const termInput = {
  name: "Fall 2026",
  startDate: "2026-08-24",
  endDate: "2026-12-11",
};

// Builds the shared term and course ids for one group of seed items.
function courseItems(termId, courseId) {
  return { termId, courseId };
}

// Wipes existing terms and inserts the Fall 2026 demo term, courses, and items.
function main() {
  const databasePath = database.openDatabase(userDataDirectory);

  for (const term of database.listTerms()) {
    database.deleteTerm(term.id);
  }

  const term = database.createTerm(termInput);
  const operatingSystems = database.createCourse({
    code: "CS 3350",
    name: "Operating Systems",
    color: "#3157c8",
    termId: term.id,
  });
  const dataStructures = database.createCourse({
    code: "CS 3010",
    name: "Data Structures",
    color: "#c45c26",
    termId: term.id,
  });
  const discreteMath = database.createCourse({
    code: "MATH 3320",
    name: "Discrete Math",
    color: "#2f7d4a",
    termId: term.id,
  });

  const os = courseItems(term.id, operatingSystems.id);
  const ds = courseItems(term.id, dataStructures.id);
  const math = courseItems(term.id, discreteMath.id);
  const termWide = courseItems(term.id, null);

  const verified = database.createItems([
    { ...termWide, title: "Labor Day", type: "holiday", dueDate: "2026-09-07", source: "manual" },
    { ...termWide, title: "Thanksgiving Break", type: "holiday", dueDate: "2026-11-26", source: "manual" },
    { ...os, title: "Syllabus quiz", type: "quiz", dueDate: "2026-08-28", dueTime: "23:59", status: "done", weightPct: 2, source: "manual" },
    { ...os, title: "Project 1", type: "project", dueDate: "2026-10-09", dueTime: "23:59", weightPct: 15, source: "manual" },
    { ...os, title: "Midterm", type: "exam", dueDate: "2026-10-16", dueTime: "10:00", weightPct: 20, source: "manual" },
    { ...os, title: "Lab 5", type: "assignment", dueDate: "2026-10-30", status: "in_progress", weightPct: 5, source: "manual" },
    { ...os, title: "Project 2", type: "project", dueDate: "2026-11-20", dueTime: "23:59", weightPct: 20, priority: "high", estimatedMinutes: 600, notes: "Thread scheduler. Demo in lab.", source: "manual" },
    { ...os, title: "Final exam", type: "exam", dueDate: "2026-12-09", dueTime: "08:00", weightPct: 25, source: "manual" },
    { ...ds, title: "Homework 1", type: "assignment", dueDate: "2026-09-04", status: "done", weightPct: 4, source: "manual" },
    { ...ds, title: "Homework 3", type: "assignment", dueDate: "2026-09-25", weightPct: 4, source: "manual" },
    { ...ds, title: "Quiz 2", type: "quiz", dueDate: "2026-10-02", weightPct: 5, source: "manual" },
    { ...ds, title: "Programming project", type: "project", dueDate: "2026-11-13", status: "in_progress", weightPct: 25, priority: "high", estimatedMinutes: 480, source: "manual" },
    { ...ds, title: "Final exam", type: "exam", dueDate: "2026-12-10", dueTime: "10:30", weightPct: 30, source: "manual" },
    { ...math, title: "Problem set 1", type: "assignment", dueDate: "2026-09-11", status: "done", weightPct: 5, source: "manual" },
    { ...math, title: "Exam 1", type: "exam", dueDate: "2026-10-02", dueTime: "09:30", weightPct: 20, source: "manual" },
    { ...math, title: "Problem set 5", type: "assignment", dueDate: "2026-11-06", weightPct: 5, priority: "medium", estimatedMinutes: 120, source: "manual" },
    { ...ds, title: "Study for final", type: "study", dueDate: "2026-12-07", dueTime: "18:00", estimatedMinutes: 180, color: "#7a4fd1", source: "manual" },
    { ...math, title: "Final exam", type: "exam", dueDate: "2026-12-08", dueTime: "08:00", weightPct: 30, source: "manual" },
  ], { verified: true });

  const pending = database.createItems([
    {
      ...os,
      title: "Reading response",
      type: "assignment",
      source: "ai",
      confidence: 0.42,
      dateText: "weekly reading response",
      sourceQuote: "Submit a short response to each week's reading.",
      sourceFile: "cs3350-syllabus.pdf",
    },
    {
      ...os,
      title: "Lab 4",
      type: "assignment",
      dueDate: "2026-11-06",
      dueTime: "23:59",
      weightPct: 5,
      source: "ai",
      confidence: 0.86,
      dateText: "Week 11 Friday",
      week: 11,
      weekday: "Friday",
      sourceQuote: "Lab 4 is due Week 11 Friday at 11:59pm.",
      sourceFile: "cs3350-syllabus.pdf",
    },
    {
      ...ds,
      title: "Homework 5",
      type: "assignment",
      weightPct: 4,
      source: "ai",
      confidence: 0.55,
      dateText: "Homework 5",
      sourceQuote: "Homework 5 will be posted after Quiz 2.",
      sourceFile: "cs3010-syllabus.pdf",
    },
    {
      ...math,
      title: "Problem set 4",
      type: "assignment",
      dueDate: "2026-11-02",
      weightPct: 5,
      source: "ai",
      confidence: 0.91,
      dateText: "Week 11 Monday",
      week: 11,
      weekday: "Monday",
      sourceQuote: "Problem set 4 is due Week 11 Monday.",
      sourceFile: "math3320-syllabus.pdf",
    },
    {
      ...math,
      title: "Problem set 6",
      type: "assignment",
      weightPct: 5,
      source: "ai",
      confidence: 0.3,
      dateText: "the last problem set",
      sourceQuote: "The last problem set is due before the final.",
      sourceFile: "math3320-syllabus.pdf",
    },
  ]);

  const items = database.listItems({ termId: term.id });
  const undated = items.filter((item) => !item.due_date).length;
  const unverified = items.filter((item) => !item.verified_at).length;

  console.log(`Seeded ${databasePath}`);
  console.log(`Term: ${term.name}`);
  console.log(`Courses: 3`);
  console.log(`Items: ${items.length} (${verified.created.length} verified, ${pending.created.length} unverified, ${undated} undated)`);
  database.closeDatabase();
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error("Close the Electron app if it is open, then run npm run seed again.");
  process.exitCode = 1;
}
