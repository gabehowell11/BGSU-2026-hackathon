import React, { useMemo } from "react";
import Icon from "../components/Icon";

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDueDate(date) {
  if (!date) return "No due date";
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function HomePage({ items, courses, terms, setPage, openNew }) {
  const today = isoDate(new Date());
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndDate = isoDate(weekEnd);

  const summaries = useMemo(() => ({
    today: items.filter((item) => item.due_date === today && item.status !== "done").length,
    week: items.filter((item) => item.due_date >= today && item.due_date <= weekEndDate && item.status !== "done").length,
    overdue: items.filter((item) => item.due_date && item.due_date < today && item.status !== "done").length,
    completed: items.filter((item) => item.status === "done").length,
  }), [items, today, weekEndDate]);

  const upcoming = useMemo(() => items
    .filter((item) => item.due_date && item.due_date >= today && item.status !== "done")
    .sort((a, b) => `${a.due_date}${a.due_time || ""}`.localeCompare(`${b.due_date}${b.due_time || ""}`))
    .slice(0, 6), [items, today]);

  const todayItems = items
    .filter((item) => item.due_date === today)
    .sort((a, b) => (a.due_time || "23:59").localeCompare(b.due_time || "23:59"));

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <header className="page-header home-header">
        <div><span className="eyebrow">{dateLabel}</span><h1>Good morning</h1></div>
        <div className="home-actions">
          <button className="secondary-button" type="button" onClick={() => setPage("calendar")}>Open calendar</button>
          <button className="primary-button" type="button" onClick={openNew}><Icon name="plus" />Add assignment</button>
        </div>
      </header>

      <section className="summary-grid" aria-label="Assignment summary">
        {[
          ["Today", summaries.today],
          ["Next 7 days", summaries.week],
          ["Overdue", summaries.overdue],
          ["Completed", summaries.completed],
        ].map(([label, value]) => (
          <button type="button" className="summary-card" key={label} onClick={() => setPage("assignments")}>
            <span>{label}</span><strong>{value}</strong>
          </button>
        ))}
      </section>

      <div className="home-grid">
        <section className="home-panel">
          <div className="panel-header"><div><span className="eyebrow">Today</span><h2>{todayItems.length ? `${todayItems.length} items` : "Nothing scheduled"}</h2></div></div>
          <div className="today-list">
            {todayItems.map((item) => (
              <button type="button" className="today-row" key={item.id} onClick={() => setPage("assignments")}>
                <span className="today-check" style={{ borderColor: item.course_color || "#668cff" }} />
                <span className="today-main"><strong>{item.title}</strong><small>{item.course_code || item.type}</small></span>
                <span className="today-time">{item.due_time || "All day"}</span>
              </button>
            ))}
            {!todayItems.length && <div className="panel-empty">No assignments or events due today.</div>}
          </div>
        </section>

        <section className="home-panel">
          <div className="panel-header"><div><span className="eyebrow">Coming up</span><h2>Next 7 days</h2></div><button type="button" onClick={() => setPage("calendar")}>View calendar</button></div>
          <div className="upcoming-list">
            {upcoming.map((item) => (
              <button type="button" className="upcoming-row" key={item.id} onClick={() => setPage("calendar")}>
                <span className="upcoming-date"><b>{formatDueDate(item.due_date).split(" ")[1]}</b><small>{formatDueDate(item.due_date).split(" ")[0]}</small></span>
                <span className="upcoming-main"><strong>{item.title}</strong><small>{item.course_code || item.type}</small></span>
                <span className={`status status-${item.status}`}><span />{item.status === "done" ? "Done" : item.status === "in_progress" ? "In progress" : "To do"}</span>
              </button>
            ))}
            {!upcoming.length && <div className="panel-empty">Nothing upcoming this week.</div>}
          </div>
        </section>

        <section className="home-panel workload-panel">
          <div className="panel-header"><div><span className="eyebrow">Workload</span><h2>This week</h2></div></div>
          <div className="workload-list">
            {courses.slice(0, 4).map((course) => {
              const count = items.filter((item) => item.course_id === course.id && item.due_date >= today && item.due_date <= weekEndDate && item.status !== "done").length;
              return (
                <div className="workload-row" key={course.id}>
                  <span><i style={{ background: course.color }} />{course.code}</span>
                  <span className="workload-track"><b style={{ width: `${Math.min(100, count * 28)}%`, background: course.color }} /></span>
                  <b>{count}</b>
                </div>
              );
            })}
            {!courses.length && <div className="panel-empty">Add a class to begin tracking workload.</div>}
          </div>
        </section>
      </div>
    </>
  );
}
