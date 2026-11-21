require("dotenv").config();

const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const database = require("./database");
const { registerIpcHandlers } = require("./ipc");

app.setName("AI Student Task Manager");

// Opens the app window, loading the Vite dev server or the built page.
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

// Opens the database and the window once Electron is ready.
app.whenReady().then(() => {
  const databasePath = database.openDatabase(app.getPath("userData"));
  console.log(`SQLite database: ${databasePath}`);
  registerIpcHandlers();
  createWindow();

  // Reopens a window on macOS when the dock icon is clicked and none are open.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quits the app when the last window closes, except on macOS.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Closes the database before the app exits.
app.on("before-quit", () => {
  database.closeDatabase();
});
