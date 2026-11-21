# AI Student Task Manager

A minimal Electron application with a React frontend.

## Setup

1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Add your Aivana API key to `.env`.

## Run

```powershell
npm run dev
```

## Test Aivana

```powershell
npm run test:aivana
```

The API key stays in the Electron main process. The React renderer calls Aivana only through the preload IPC bridge.

## Local database

Assignments and calendar events are stored in a SQLite database at Electron's
`app.getPath("userData")` location. The database file is named
`student-task-manager.db`; it is not stored in the Git repository.