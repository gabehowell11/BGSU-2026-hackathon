const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("aivana", {
  generate: (prompt) => ipcRenderer.invoke("aivana:generate", prompt),
});

contextBridge.exposeInMainWorld("database", {
  listAssignments: () => ipcRenderer.invoke("assignments:list"),
  createAssignment: (assignment) =>
    ipcRenderer.invoke("assignments:create", assignment),
  updateAssignment: (id, assignment) =>
    ipcRenderer.invoke("assignments:update", id, assignment),
  deleteAssignment: (id) =>
    ipcRenderer.invoke("assignments:delete", id),
  listCalendarEvents: () =>
    ipcRenderer.invoke("calendar-events:list"),
  createCalendarEvent: (event) =>
    ipcRenderer.invoke("calendar-events:create", event),
});
