const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appWindow", {
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
});

contextBridge.exposeInMainWorld("profile", {
  get: () => ipcRenderer.invoke("profile:get"),
});

contextBridge.exposeInMainWorld("aivana", {
  // Reads a syllabus, schedule, or photo and returns unsaved drafts to review.
  // options: { termId?, courseId?, files?: [{ name, data }], text?, force? }. With no
  // files and no text, a file picker opens. Returns { canceled, cached, files,
  // sentAsText, sentAsFile, suggestedTerm, suggestedCourse, drafts }.
  // Re-uploading the same documents reuses the saved result for free; pass
  // force: true to ask Aivana again.
  // With a termId: save confirmed drafts with database.createItems(drafts, { verified: true }).
  // Without one (onboarding): suggestedTerm { name, startDate, endDate } and
  // suggestedCourse { code, name } are filled from the documents; save with
  // database.createSetup({ term, course, items }).
  extract: (options) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Scanning timed out. Try a smaller or text-based file.")),
        10 * 60 * 1000,
      );
    });
    return Promise.race([
      ipcRenderer.invoke("extract:run", options),
      timeout,
    ]).finally(() => clearTimeout(timer));
  },
  // Sends a chat message. Returns { reply, actions, rejected, messages }.
  // Nothing changes until confirmed actions go to applyChatActions.
  chat: (content) => ipcRenderer.invoke("chat:send", content),
  // Same as chat, but calls onDelta(text) with each piece of the reply as it
  // streams in. Resolves with { reply, actions, rejected, messages } when done.
  chatStream: (content, onDelta) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const listener = (_event, payload) => {
      if (payload?.requestId === requestId && typeof onDelta === "function") onDelta(payload.text);
    };
    ipcRenderer.on("chat:delta", listener);
    return ipcRenderer.invoke("chat:stream", requestId, content)
      .finally(() => ipcRenderer.removeListener("chat:delta", listener));
  },
  // Applies the chat actions the user confirmed, all or nothing.
  applyChatActions: (actions) => ipcRenderer.invoke("chat:apply-actions", actions),
});

contextBridge.exposeInMainWorld("settings", {
  // Returns all settings: { onboardingComplete, userName, ...anything saved }.
  // Show onboarding when onboardingComplete is false.
  get: () => ipcRenderer.invoke("settings:get"),
  // Saves only the keys given, e.g. { onboardingComplete: true, userName: "Sam" },
  // and returns all settings. Passing null for a key resets it.
  update: (patch) => ipcRenderer.invoke("settings:update", patch),
});

contextBridge.exposeInMainWorld("database", {
  // Returns every saved term.
  listTerms: () => ipcRenderer.invoke("terms:list"),
  // Saves a new term.
  createTerm: (term) => ipcRenderer.invoke("terms:create", term),
  // Replaces an existing term's name and dates.
  updateTerm: (id, term) => ipcRenderer.invoke("terms:update", id, term),
  // Deletes a term and the courses and items that belong to it.
  deleteTerm: (id) => ipcRenderer.invoke("terms:delete", id),
  // Returns every course, or the courses in one term.
  listCourses: (termId) => ipcRenderer.invoke("courses:list", termId),
  // Saves a course under a term.
  createCourse: (course) => ipcRenderer.invoke("courses:create", course),
  // Replaces a course's code, name, color, and term.
  updateCourse: (id, course) => ipcRenderer.invoke("courses:update", id, course),
  // Deletes a course and the items that belong to it.
  deleteCourse: (id) => ipcRenderer.invoke("courses:delete", id),
  // Returns items. Optional filter: { termId, courseId, status, type, priority, verified, search }.
  listItems: (filter) => ipcRenderer.invoke("items:list", filter),
  // Returns items due between two dates, with the same optional filter.
  listItemsInRange: (from, to, filter) => ipcRenderer.invoke("items:list-range", from, to, filter),
  // Returns the home page summary for today (or a given YYYY-MM-DD).
  getSummary: (today) => ipcRenderer.invoke("items:summary", today),
  // Saves one item.
  createItem: (item) => ipcRenderer.invoke("items:create", item),
  // Saves many items in one transaction, and can mark the batch verified.
  createItems: (items, options) => ipcRenderer.invoke("items:create-many", items, options),
  // Updates only the item fields that were sent.
  updateItem: (id, item) => ipcRenderer.invoke("items:update", id, item),
  // Applies one patch to many items, all or nothing (bulk status, priority, course, date).
  updateItems: (ids, patch) => ipcRenderer.invoke("items:update-many", ids, patch),
  // Changes one item's status.
  setItemStatus: (id, status) => ipcRenderer.invoke("items:set-status", id, status),
  // Marks one item verified.
  setItemVerified: (id) => ipcRenderer.invoke("items:verify", id),
  // Marks a list of items verified in one transaction.
  verifyItems: (ids) => ipcRenderer.invoke("items:verify-many", ids),
  // Deletes one item.
  deleteItem: (id) => ipcRenderer.invoke("items:delete", id),
  // Deletes many items, all or nothing.
  deleteItems: (ids) => ipcRenderer.invoke("items:delete-many", ids),
  // Saves verified, dated items to an .ics file the user picks. Same optional filter as listItems.
  exportIcs: (filter) => ipcRenderer.invoke("export:ics", filter),
  // Onboarding save, all or nothing: term { id } or { name, startDate, endDate },
  // course { id } or { code, name, color? } or null, items = confirmed drafts.
  // Matching terms and course codes are reused. Returns { term, course, created, skipped }.
  createSetup: (setup) => ipcRenderer.invoke("setup:create", setup),
  // Returns recorded Aivana usage, newest first.
  listUsage: () => ipcRenderer.invoke("usage:list"),
  // Returns the full saved chat.
  listChatMessages: () => ipcRenderer.invoke("chat:list"),
  // Returns at most the last 8 chat messages.
  listRecentChatMessages: () => ipcRenderer.invoke("chat:recent"),
  // Deletes every saved chat message.
  clearChatMessages: () => ipcRenderer.invoke("chat:clear"),
  // Returns and deletes the local registry of files sent or reused with Aivana.
  listUploadedFiles: () => ipcRenderer.invoke("uploaded-files:list"),
  deleteUploadedFile: (id) => ipcRenderer.invoke("uploaded-files:delete", id),
});
