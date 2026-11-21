import React, { useState } from "react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Formats a local date as YYYY-MM-DD so it matches stored due dates.
function isoDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// Builds the six weeks shown for a month, including the spillover days.
function monthDays(year, month) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const start = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

// Groups dated items by their due date. Undated items are left out.
function itemsByDate(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!item.due_date) continue;
    const rows = grouped.get(item.due_date) || [];
    rows.push(item);
    grouped.set(item.due_date, rows);
  }
  return grouped;
}

// Shows one month, with each item on the day it is due.
function Calendar({ items }) {
  const today = new Date();
  const [visible, setVisible] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

  const days = monthDays(visible.year, visible.month);
  const datedItems = itemsByDate(items);
  const title = new Date(visible.year, visible.month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  // Moves the visible month forward or backward.
  function changeMonth(offset) {
    const next = new Date(visible.year, visible.month + offset, 1);
    setVisible({ year: next.getFullYear(), month: next.getMonth() });
  }

  return (
    <section>
      <div className="calendar-header">
        <button type="button" onClick={() => changeMonth(-1)}>Previous</button>
        <h2>{title}</h2>
        <button type="button" onClick={() => changeMonth(1)}>Next</button>
      </div>
      <div className="calendar-weekdays">
        {WEEKDAYS.map((day) => <div key={day}>{day}</div>)}
      </div>
      <div className="calendar-grid">
        {days.map((day) => {
          const date = isoDate(day);
          const inMonth = day.getMonth() === visible.month;
          const dayItems = datedItems.get(date) || [];
          const className = [
            "calendar-day",
            inMonth ? "" : "outside",
            date === isoDate(today) ? "today" : "",
          ].filter(Boolean).join(" ");

          return (
            <div key={date} className={className}>
              <div className="calendar-date">{day.getDate()}</div>
              {dayItems.map((item) => (
                <div
                  key={item.id}
                  className="calendar-item"
                  style={{ borderLeftColor: item.course_color || "#3157c8" }}
                  title={`${item.title}${item.due_time ? ` ${item.due_time}` : ""}`}
                >
                  {item.title}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default Calendar;
