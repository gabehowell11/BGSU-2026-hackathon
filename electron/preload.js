const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aivana", {
  // Sends a prompt to the main process and returns Aivana's answer.
  generate: (prompt) => ipcRenderer.invoke("aivana:generate", prompt),
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
  // Returns items, optionally limited to one term.
  listItems: (filter) => ipcRenderer.invoke("items:list", filter),
  // Returns items due between two dates.
  listItemsInRange: (from, to) => ipcRenderer.invoke("items:list-range", from, to),
  // Saves one item.
  createItem: (item) => ipcRenderer.invoke("items:create", item),
  // Saves many items in one transaction, and can mark the batch verified.
  createItems: (items, options) => ipcRenderer.invoke("items:create-many", items, options),
  // Updates only the item fields that were sent.
  updateItem: (id, item) => ipcRenderer.invoke("items:update", id, item),
  // Changes one item's status.
  setItemStatus: (id, status) => ipcRenderer.invoke("items:set-status", id, status),
  // Marks one item verified.
  setItemVerified: (id) => ipcRenderer.invoke("items:verify", id),
  // Marks a list of items verified in one transaction.
  verifyItems: (ids) => ipcRenderer.invoke("items:verify-many", ids),
  // Deletes one item.
  deleteItem: (id) => ipcRenderer.invoke("items:delete", id),
  // Returns recorded Aivana usage, newest first.
  listUsage: () => ipcRenderer.invoke("usage:list"),
  // Returns the full saved chat.
  listChatMessages: () => ipcRenderer.invoke("chat:list"),
  // Returns at most the last 8 chat messages.
  listRecentChatMessages: () => ipcRenderer.invoke("chat:recent"),
  // Deletes every saved chat message.
  clearChatMessages: () => ipcRenderer.invoke("chat:clear"),
});
