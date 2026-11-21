const { ipcMain } = require("electron");
const database = require("./database");
const aivana = require("./aivana");
const { registerExtractionHandlers } = require("./extraction");
const { registerChatHandlers } = require("./chat");
const { registerIcsHandlers } = require("./ics");
const { requiredId, requiredIds, optionalId, itemFilter, itemIds } = require("./validation");

// Add new channels in the feature file (registerExtractionHandlers in
// extraction.js, and so on) and call that function from here. Do not add
// handlers in main.js.
function registerIpcHandlers() {
  // Smoke test still used by the current test page. Delete it once the page
  // uses extract:run and chat:send instead.
  ipcMain.handle("aivana:generate", (_event, prompt) => aivana.generate(prompt));

  // extract:run
  registerExtractionHandlers();
  // chat:send, chat:apply-actions
  registerChatHandlers();
  // export:ics
  registerIcsHandlers();

  // Returns every saved term.
  ipcMain.handle("terms:list", () => database.listTerms());
  // Saves a new term.
  ipcMain.handle("terms:create", (_event, term) => database.createTerm(term));
  // Replaces an existing term's name and dates.
  ipcMain.handle("terms:update", (_event, id, term) => {
    return database.updateTerm(requiredId(id, "term"), term);
  });
  // Deletes a term and the courses and items that belong to it.
  ipcMain.handle("terms:delete", (_event, id) => database.deleteTerm(requiredId(id, "term")));

  // Returns every course, or the courses in one term.
  ipcMain.handle("courses:list", (_event, termId) => {
    return database.listCourses(optionalId(termId, "term"));
  });
  // Saves a course under a term.
  ipcMain.handle("courses:create", (_event, course) => database.createCourse({
    ...course,
    termId: requiredId(course?.termId, "term"),
  }));
  // Replaces a course's code, name, color, and term.
  ipcMain.handle("courses:update", (_event, id, course) => database.updateCourse(
    requiredId(id, "course"),
    { ...course, termId: requiredId(course?.termId, "term") },
  ));
  // Deletes a course and the items that belong to it.
  ipcMain.handle("courses:delete", (_event, id) => {
    return database.deleteCourse(requiredId(id, "course"));
  });

  // Returns items. Optional filter keys: termId, courseId, status, type,
  // priority, verified (true/false), search (matches title or notes).
  ipcMain.handle("items:list", (_event, filter) => database.listItems(itemFilter(filter)));
  // Returns items due between two dates, with the same optional filter.
  ipcMain.handle("items:list-range", (_event, from, to, filter) => {
    return database.listItemsInRange(from, to, itemFilter(filter));
  });
  // Returns the home page summary: due today, next 7 days, overdue, recently completed.
  ipcMain.handle("items:summary", (_event, today) => database.getSummary(today || undefined));
  // Saves one item.
  ipcMain.handle("items:create", (_event, item) => database.createItem({
    ...itemIds(item),
    termId: requiredId(item?.termId, "term"),
  }));
  // Saves many items in one transaction, and can mark the batch verified.
  ipcMain.handle("items:create-many", (_event, items, options) => database.createItems(
    (Array.isArray(items) ? items : []).map((item) => ({
      ...itemIds(item),
      termId: requiredId(item?.termId, "term"),
    })),
    { verified: options?.verified === true },
  ));
  // Updates only the item fields that were sent.
  ipcMain.handle("items:update", (_event, id, item) => {
    return database.updateItem(requiredId(id, "item"), itemIds(item));
  });
  // Applies one patch to many items in one transaction (bulk edit).
  ipcMain.handle("items:update-many", (_event, ids, patch) => {
    return database.updateItems(requiredIds(ids, "item"), itemIds(patch));
  });
  // Changes one item's status.
  ipcMain.handle("items:set-status", (_event, id, status) => {
    return database.setItemStatus(requiredId(id, "item"), status);
  });
  // Marks one item verified.
  ipcMain.handle("items:verify", (_event, id) => database.setItemVerified(requiredId(id, "item")));
  // Marks a list of items verified in one transaction.
  ipcMain.handle("items:verify-many", (_event, ids) => database.verifyItems(
    (Array.isArray(ids) ? ids : []).map((id) => requiredId(id, "item")),
  ));
  // Deletes one item.
  ipcMain.handle("items:delete", (_event, id) => database.deleteItem(requiredId(id, "item")));
  // Deletes many items in one transaction and returns how many were deleted.
  ipcMain.handle("items:delete-many", (_event, ids) => {
    return database.deleteItems(requiredIds(ids, "item"));
  });

  // Creates or reuses a term and course and saves confirmed drafts, all at once
  // (onboarding after a setup-mode extract:run).
  ipcMain.handle("setup:create", (_event, setup) => database.createSetup({
    term: setup?.term?.id ? { id: requiredId(setup.term.id, "term") } : setup?.term,
    course: setup?.course?.id ? { id: requiredId(setup.course.id, "course") } : setup?.course,
    // The term id is filled in by createSetup, so any term id on a draft is dropped.
    items: (Array.isArray(setup?.items) ? setup.items : []).map(({ termId: _termId, ...item }) => itemIds(item)),
  }));

  // Returns all settings, with defaults (onboardingComplete: false, userName: null).
  ipcMain.handle("settings:get", () => database.getSettings());
  // Saves only the keys sent and returns all settings. null resets a key.
  ipcMain.handle("settings:update", (_event, patch) => database.updateSettings(patch));

  // Returns recorded Aivana usage, newest first. Writes happen inside aivana.js.
  ipcMain.handle("usage:list", () => database.listUsage());

  // Returns files that produced or reused an Aivana extraction.
  ipcMain.handle("uploaded-files:list", () => database.listUploadedFiles());
  ipcMain.handle("uploaded-files:delete", (_event, id) => {
    return database.deleteUploadedFile(requiredId(id, "uploaded file"));
  });

  // Returns the full saved chat. Writes happen inside chat.js.
  ipcMain.handle("chat:list", () => database.listChatMessages());
  // Returns at most the last 8 chat messages.
  ipcMain.handle("chat:recent", () => database.listRecentChatMessages());
  // Deletes every saved chat message.
  ipcMain.handle("chat:clear", () => database.clearChatMessages());
}

module.exports = { registerIpcHandlers };
