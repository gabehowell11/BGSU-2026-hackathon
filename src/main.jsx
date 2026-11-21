import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import AssignmentsPage from "./pages/AssignmentsPage";
import CalendarPage from "./pages/CalendarPage";
import HomePage from "./pages/HomePage";
import AssistantPage from "./pages/AssistantPage";
import FilesPage from "./pages/FilesPage";
import SettingsPage from "./pages/SettingsPage";
import Sidebar from "./components/Sidebar";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

function PlaceholderPage({ page }) {
  const title = page === "settings" ? "Settings" : page === "files" ? "Files" : "Coming soon";
  return (
    <header className="page-header">
      <div><span className="eyebrow">Coming next</span><h1>{title}</h1></div>
    </header>
  );
}

function App() {
  const [page, setPage] = useState("assignments");
  const [collapsed, setCollapsed] = useState(false);
  const [terms, setTerms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [items, setItems] = useState([]);
  const [databaseError, setDatabaseError] = useState("");

  // Reloads terms, classes and items, e.g. after Settings changes them.
  async function reloadData() {
    const [nextTerms, nextCourses, nextItems] = await Promise.all([
      window.database.listTerms(),
      window.database.listCourses(),
      window.database.listItems(),
    ]);
    setTerms(nextTerms);
    setCourses(nextCourses);
    setItems(nextItems);
  }

  useEffect(() => {
    if (!window.database) {
      setDatabaseError("Electron database unavailable.");
      return;
    }
    reloadData().catch((error) => setDatabaseError(error.message));
  }, []);

  return (
    <div className="window-shell">
      <header className="window-titlebar">
        <div className="window-title"><span className="window-mark">D</span><span>Deadline</span></div>
        <div className="window-controls">
          <button type="button" onClick={() => window.appWindow?.minimize()} aria-label="Minimize"><span className="control-minimize" /></button>
          <button type="button" onClick={() => window.appWindow?.maximize()} aria-label="Maximize"><span className="control-maximize" /></button>
          <button className="window-close" type="button" onClick={() => window.appWindow?.close()} aria-label="Close"><span className="control-close" /></button>
        </div>
      </header>
      <div className="app-shell">
        <Sidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          page={page}
          setPage={setPage}
          courses={courses}
        />
        <main className={`main-content${page === "chat" ? " assistant-main" : ""}`}>
        {databaseError && <div className="database-error" role="alert">{databaseError}</div>}
        {page === "home" && (
          <HomePage
            items={items}
            courses={courses}
            terms={terms}
            setPage={setPage}
            openNew={() => setPage("assignments")}
            setItems={setItems}
          />
        )}
        {page === "assignments" && (
          <AssignmentsPage
            items={items}
            courses={courses}
            terms={terms}
            setItems={setItems}
          />
        )}
        {page === "calendar" && (
          <CalendarPage
            items={items}
            courses={courses}
            terms={terms}
            setItems={setItems}
          />
        )}
        {page === "chat" && <AssistantPage setItems={setItems} />}
        {page === "files" && (
          <FilesPage
            terms={terms}
            courses={courses}
            setItems={setItems}
          />
        )}
        {page === "settings" && <SettingsPage terms={terms} courses={courses} onDataChanged={reloadData} />}
        {!["home", "assignments", "calendar", "chat", "files", "settings"].includes(page) && <PlaceholderPage page={page} />}
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
