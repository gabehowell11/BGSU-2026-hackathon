import React, { useMemo, useState } from "react";
import AssignmentDrawer from "../components/AssignmentDrawer";
import Icon from "../components/Icon";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthDays(year, month) {
  const start = new Date(year, month, 1);
  start.setDate(1 - start.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function weekDays(date) {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export default function CalendarPage({ items, courses, terms, setItems }) {
  const [view, setView] = useState("month");
  const [visibleDate, setVisibleDate] = useState(new Date());
  const [courseFilter, setCourseFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItem, setDrawerItem] = useState(undefined);
  const [draftDate, setDraftDate] = useState("");

  const filteredItems = useMemo(() => items.filter((item) => {
    if (courseFilter !== "all" && String(item.course_id) !== courseFilter) return false;
    if (search && !item.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [items, courseFilter, search]);

  const itemsByDate = useMemo(() => {
    const result = new Map();
    filteredItems.forEach((item) => {
      if (!item.due_date) return;
      const rows = result.get(item.due_date) || [];
      rows.push(item);
      result.set(item.due_date, rows);
    });
    return result;
  }, [filteredItems]);

  function move(offset) {
    const next = new Date(visibleDate);
    if (view === "month") next.setMonth(next.getMonth() + offset);
    else if (view === "week") next.setDate(next.getDate() + (offset * 7));
    else next.setDate(next.getDate() + offset);
    setVisibleDate(next);
  }

  function openNew(date = isoDate(visibleDate)) {
    setDraftDate(date);
    setDrawerItem({ due_date: date });
    setDrawerOpen(true);
  }

  function openEdit(item) {
    setDraftDate(item.due_date || "");
    setDrawerItem(item);
    setDrawerOpen(true);
  }

  async function saveItem(values) {
    if (window.database) {
      if (drawerItem?.id) await window.database.updateItem(drawerItem.id, values);
      else await window.database.createItem({ ...values, source: "manual" });
      setItems(await window.database.listItems());
    } else {
      const course = courses.find((entry) => entry.id === values.courseId);
      if (drawerItem?.id) {
        setItems((current) => current.map((item) => item.id === drawerItem.id ? {
          ...item,
          ...values,
          course_id: values.courseId,
          course_code: course?.code,
          course_name: course?.name,
          course_color: course?.color,
          due_date: values.dueDate,
          due_time: values.dueTime,
        } : item));
      } else {
        setItems((current) => [...current, {
          id: Math.max(0, ...current.map((item) => item.id)) + 1,
          ...values,
          course_id: values.courseId,
          course_code: course?.code,
          course_name: course?.name,
          course_color: course?.color,
          due_date: values.dueDate,
          due_time: values.dueTime,
        }]);
      }
    }
    setDrawerOpen(false);
  }

  async function deleteItem(item) {
    if (window.database) {
      await window.database.deleteItem(item.id);
      setItems(await window.database.listItems());
    } else {
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    }
    setDrawerOpen(false);
  }

  const title = visibleDate.toLocaleString(undefined, view === "month"
    ? { month: "long", year: "numeric" }
    : view === "week"
      ? { month: "short", day: "numeric", year: "numeric" }
      : { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <>
      <header className="page-header calendar-header">
        <div><span className="eyebrow">{terms[0]?.name || "Current term"}</span><h1>Calendar</h1></div>
        <div className="calendar-toolbar">
          <label className="search-field"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" /></label>
          <select className="filter-select" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="all">All classes</option>{courses.map((course) => <option key={course.id} value={String(course.id)}>{course.code}</option>)}</select>
          <button className="primary-button" type="button" onClick={() => openNew()}><Icon name="plus" />Add</button>
        </div>
      </header>

      <div className="calendar-controls">
        <div className="calendar-nav">
          <button type="button" className="icon-button" onClick={() => move(-1)} aria-label="Previous">‹</button>
          <button type="button" className="secondary-button" onClick={() => setVisibleDate(new Date())}>Today</button>
          <button type="button" className="icon-button" onClick={() => move(1)} aria-label="Next">›</button>
          <h2>{title}</h2>
        </div>
        <div className="view-switch" aria-label="Calendar view">
          {["month", "week", "day"].map((option) => (
            <button key={option} type="button" className={view === option ? "active" : ""} onClick={() => setView(option)}>{option}</button>
          ))}
        </div>
      </div>

      {view === "month" && (
        <div className="calendar-month">
          <div className="calendar-weekdays">{WEEKDAYS.map((day) => <div key={day}>{day}</div>)}</div>
          <div className="calendar-grid">
            {monthDays(visibleDate.getFullYear(), visibleDate.getMonth()).map((date) => {
              const key = isoDate(date);
              const dayItems = itemsByDate.get(key) || [];
              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    "calendar-day",
                    date.getMonth() !== visibleDate.getMonth() ? "outside" : "",
                    key === isoDate(new Date()) ? "today" : "",
                  ].join(" ").trim()}
                  onClick={() => { setVisibleDate(date); setView("day"); }}
                  onDoubleClick={() => openNew(key)}
                >
                  <span className="calendar-date">{date.getDate()}</span>
                  <span className="calendar-day-items">
                    {dayItems.slice(0, 3).map((item) => (
                      <span key={item.id} className="calendar-item" style={{ borderLeftColor: item.course_color || "#668cff" }} onClick={(event) => { event.stopPropagation(); openEdit(item); }}>
                        {item.due_time && <small>{item.due_time}</small>}<b>{item.title}</b>
                      </span>
                    ))}
                    {dayItems.length > 3 && <span className="calendar-overflow">+{dayItems.length - 3} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {view === "week" && (
        <div className="calendar-week">
          {weekDays(visibleDate).map((date) => {
            const key = isoDate(date);
            const dayItems = itemsByDate.get(key) || [];
            return (
              <section className="week-column" key={key}>
                <button type="button" className="week-heading" onClick={() => { setVisibleDate(date); setView("day"); }}>
                  <span>{WEEKDAYS[date.getDay()]}</span><b>{date.getDate()}</b>
                </button>
                <div className="week-events">
                  {dayItems.map((item) => (
                    <button type="button" key={item.id} className="week-event" style={{ borderLeftColor: item.course_color || "#668cff" }} onClick={() => openEdit(item)}>
                      {item.due_time && <small>{item.due_time}</small>}<strong>{item.title}</strong><span>{item.course_code || item.type}</span>
                    </button>
                  ))}
                  <button type="button" className="week-add" onClick={() => openNew(key)}><Icon name="plus" />Add</button>
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === "day" && (
        <div className="calendar-day-view">
          <div className="day-timeline">
            {(itemsByDate.get(isoDate(visibleDate)) || []).sort((a, b) => (a.due_time || "23:59").localeCompare(b.due_time || "23:59")).map((item) => (
              <button type="button" className="day-event" key={item.id} onClick={() => openEdit(item)}>
                <span className="day-time">{item.due_time || "All day"}</span>
                <span className="day-event-line" style={{ background: item.course_color || "#668cff" }} />
                <span className="day-event-main"><strong>{item.title}</strong><small>{item.course_code || item.type}{item.notes ? ` · ${item.notes}` : ""}</small></span>
                <span className={`status status-${item.status}`}><span />{item.status === "done" ? "Done" : item.status === "in_progress" ? "In progress" : "To do"}</span>
              </button>
            ))}
            {(itemsByDate.get(isoDate(visibleDate)) || []).length === 0 && <div className="empty-state">No items scheduled for this day.</div>}
          </div>
          <button type="button" className="day-add" onClick={() => openNew(isoDate(visibleDate))}><Icon name="plus" />Add to this day</button>
        </div>
      )}

      <AssignmentDrawer
        open={drawerOpen}
        item={drawerItem?.due_date && !drawerItem?.id ? { ...drawerItem, due_date: drawerItem.due_date || draftDate } : drawerItem}
        courses={courses}
        terms={terms}
        onClose={() => setDrawerOpen(false)}
        onSave={saveItem}
        onDelete={deleteItem}
      />
    </>
  );
}
