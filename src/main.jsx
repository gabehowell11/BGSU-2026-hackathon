import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import AssignmentsPage from "./pages/AssignmentsPage";
import CalendarPage from "./pages/CalendarPage";
import HomePage from "./pages/HomePage";
import Sidebar from "./components/Sidebar";
import "./styles.css";

function PlaceholderPage({ page }) {
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

  useEffect(() => {
    if (!window.database) {
      setDatabaseError("Electron database unavailable.");
      return;
    }

    Promise.all([
      window.database.listTerms(),
      window.database.listCourses(),
      window.database.listItems(),
    ]).then(([nextTerms, nextCourses, nextItems]) => {
      setTerms(nextTerms);
      setCourses(nextCourses);
      setItems(nextItems);
    }).catch((error) => setDatabaseError(error.message));
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        page={page}
        setPage={setPage}
        courses={courses}
      />
      <main className="main-content">
        {databaseError && <div className="database-error" role="alert">{databaseError}</div>}
        {page === "home" && (
          <HomePage
            items={items}
            courses={courses}
            terms={terms}
            setPage={setPage}
            openNew={() => setPage("assignments")}
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
        {page !== "home" && page !== "assignments" && page !== "calendar" && <PlaceholderPage page={page} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
