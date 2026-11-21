const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const database = require("./database");
require("dotenv").config();

function createWindow() {
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    window.loadURL(devServerUrl);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("aivana:generate", async (_event, prompt) => {
  if (!prompt || typeof prompt !== "string") {
    throw new Error("A prompt is required.");
  }

  if (!process.env.AIVANA_API_KEY) {
    throw new Error("AIVANA_API_KEY is not set. Copy .env.example to .env.");
  }

  const { default: Aivana } = await import("@aivana/sdk");
  const client = new Aivana({ apiKey: process.env.AIVANA_API_KEY });
  const response = await client.generate(prompt, { maxTokens: 50 });
  return response.answer;
});

ipcMain.handle("assignments:list", () => database.listAssignments());

ipcMain.handle("assignments:create", (_event, assignment) => {
  if (!assignment?.title?.trim()) {
    throw new Error("An assignment title is required.");
  }

  return database.createAssignment(assignment);
});

ipcMain.handle("assignments:update", (_event, id, assignment) => {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("A valid assignment ID is required.");
  }
  if (!assignment?.title?.trim()) {
    throw new Error("An assignment title is required.");
  }

  return database.updateAssignment(id, assignment);
});

ipcMain.handle("assignments:delete", (_event, id) => {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("A valid assignment ID is required.");
  }

  return database.deleteAssignment(id);
});

ipcMain.handle("calendar-events:list", () => database.listCalendarEvents());

ipcMain.handle("calendar-events:create", (_event, event) => {
  if (!event?.title?.trim()) {
    throw new Error("An event title is required.");
  }
  if (!event?.eventDate) {
    throw new Error("An event date is required.");
  }

  return database.createCalendarEvent(event);
});

app.whenReady().then(() => {
  const databasePath = database.openDatabase(app.getPath("userData"));
  console.log(`SQLite database: ${databasePath}`);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  database.closeDatabase();
});
