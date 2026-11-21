import React, { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";
import { urgency as urgencyOf, urgencyColor } from "../urgency";

const DAY_MS = 24 * 60 * 60 * 1000;
const LINE_DAYS = 14;
const LANES = 3;
const LABEL_SPAN = 12; // % of the line a label occupies
const NOT_DEADLINES = new Set(["holiday", "other"]);

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Due moment for an item; items without a time are due at the end of the day.
function dueAt(item) {
  if (!item.due_date) return null;
  return new Date(`${item.due_date}T${item.due_time || "23:59"}:00`).getTime();
}

function shortDay(ms) {
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function shortDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function relative(ms, now) {
  const diff = ms - now;
  const days = Math.floor(diff / DAY_MS);
  if (days >= 1) return `in ${days}d`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `in ${hours}h`;
  return `in ${Math.max(1, Math.floor(diff / 60_000))}m`;
}

function countdownParts(diff) {
  const total = Math.max(0, Math.floor(diff / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (value) => String(value).padStart(2, "0");

function greeting(hour) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Up late";
}

function hoursLeft(ms) {
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

// One sentence that says what matters right now.
function statusLine({ overdue, next, now, dueTodayCount, hasItems }) {
  if (!hasItems) return "No deadlines yet. Add an assignment and Deadline starts counting.";
  if (overdue.length === 1) return `${overdue[0].title} is overdue. Start there.`;
  if (overdue.length > 1) return `${overdue.length} things are overdue. Start with ${overdue[0].title}.`;
  if (!next) return "Nothing left on the clock. Everything is done.";
  const left = next.due - now;
  if (left < DAY_MS) {
    const more = dueTodayCount > 1 ? ` ${dueTodayCount - 1} more due today.` : "";
    return `${next.title} is due in ${hoursLeft(left)}.${more}`;
  }
  if (left <= 3 * DAY_MS) {
    return `Next up is ${next.title}, due ${new Date(next.due).toLocaleDateString(undefined, { weekday: "long" })}.`;
  }
  return `Nothing due in the next 3 days. ${next.title} is next, in ${Math.floor(left / DAY_MS)} days.`;
}

// Puts each mark on the first lane where its label doesn't collide with another.
function layoutMarks(entries) {
  const lanes = Array.from({ length: LANES }, () => []);
  return entries.map((entry) => {
    const flip = entry.pos > 100 - LABEL_SPAN;
    const from = flip ? entry.pos - LABEL_SPAN : entry.pos;
    const to = flip ? entry.pos : entry.pos + LABEL_SPAN;
    const lane = lanes.findIndex((taken) => taken.every(([a, b]) => to <= a || from >= b));
    if (lane >= 0) lanes[lane].push([from, to]);
    return { ...entry, lane, flip };
  });
}

export default function HomePage({ items, courses, terms, setPage, openNew, setItems }) {
  const [now, setNow] = useState(() => Date.now());
  const [completing, setCompleting] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const todayKey = isoDate(new Date(now));
  const lineStart = new Date(`${todayKey}T00:00:00`).getTime();
  const lineEnd = lineStart + LINE_DAYS * DAY_MS;
  const weekEnd = lineStart + 7 * DAY_MS;

  const open = useMemo(
    () => items
      .filter((item) => item.status !== "done" && item.due_date)
      .map((item) => ({ ...item, due: dueAt(item) }))
      .sort((a, b) => a.due - b.due),
    [items],
  );

  const deadlines = open.filter((item) => !NOT_DEADLINES.has(item.type));
  const next = deadlines.find((item) => item.due > now);
  const overdue = deadlines.filter((item) => item.due <= now);
  const dueToday = open.filter((item) => item.due_date === todayKey && item.due > now);
  const docket = [...overdue, ...dueToday.filter((item) => !overdue.includes(item))];
  const thisWeek = deadlines.filter((item) => item.due > now && item.due < weekEnd);
  const comingUp = open.filter((item) => item.due_date > todayKey && item.due < lineEnd).slice(0, 6);
  const doneCount = items.filter((item) => item.status === "done").length;

  const marks = useMemo(() => layoutMarks(
    open
      .filter((item) => item.due >= lineStart && item.due < lineEnd)
      .map((item) => ({ item, pos: ((item.due - lineStart) / (lineEnd - lineStart)) * 100 })),
  ), [open, lineStart, lineEnd]);
  const hiddenMarks = marks.filter((mark) => mark.lane < 0).length;
  const nowPos = ((now - lineStart) / (lineEnd - lineStart)) * 100;

  const remaining = next ? next.due - now : 0;
  const parts = countdownParts(remaining);
  const nextLevel = next ? ` ${urgencyOf(next, now)}` : "";

  const workload = courses.map((course) => ({
    course,
    week: thisWeek.filter((item) => item.course_id === course.id),
    term: deadlines.filter((item) => item.course_id === course.id && item.due > now).length,
  }));

  async function markDone(item) {
    if (!window.database?.setItemStatus) return;
    setCompleting(item.id);
    try {
      await window.database.setItemStatus(item.id, "done");
      setItems(await window.database.listItems());
    } finally {
      setCompleting(null);
    }
  }

  const dateLabel = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="dl-home">
      <header className="dl-welcome">
        <div className="dl-welcome-text">
          <span className="eyebrow">{dateLabel}{terms[0]?.name ? ` in ${terms[0].name}` : ""}</span>
          <h1>{greeting(new Date(now).getHours())}</h1>
          <p>{statusLine({ overdue, next, now, dueTodayCount: dueToday.length, hasItems: items.length > 0 })}</p>
        </div>
        <div className="home-actions">
          <button className="secondary-button" type="button" onClick={() => setPage("calendar")}>Open calendar</button>
          <button className="primary-button" type="button" onClick={openNew}><Icon name="plus" />Add assignment</button>
        </div>
      </header>

      <section className={`dl-next${nextLevel}`} aria-label="Next deadline">
        {next ? (
          <>
            <div className="dl-next-item">
              <span className="dl-next-label">Next deadline</span>
              <button type="button" className="dl-next-title" onClick={() => setPage("assignments")}>{next.title}</button>
              <span className="dl-next-meta">
                {next.course_code && <><i style={{ background: next.course_color }} />{next.course_code}</>}
                <span>Due {new Date(next.due).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </span>
              <button type="button" className="dl-done-button" onClick={() => markDone(next)} disabled={completing === next.id}>
                <span className="dl-box" />Mark done
              </button>
            </div>
            <div className="dl-clock" role="timer" aria-label={`${parts.days} days ${parts.hours} hours ${parts.minutes} minutes left`}>
              {parts.days > 0 && <span className="dl-unit days"><b>{parts.days}</b><small>{parts.days === 1 ? "day" : "days"}</small></span>}
              <span className="dl-unit"><b>{pad(parts.hours)}</b><small>hrs</small></span>
              <span className="dl-sep">:</span>
              <span className="dl-unit"><b>{pad(parts.minutes)}</b><small>min</small></span>
              <span className="dl-sep">:</span>
              <span className="dl-unit"><b>{pad(parts.seconds)}</b><small>sec</small></span>
            </div>
          </>
        ) : (
          <div className="dl-next-item">
            <span className="dl-next-label">Next deadline</span>
            <span className="dl-next-title">Nothing due</span>
            <span className="dl-next-meta">Add an assignment and the countdown starts here.</span>
          </div>
        )}
      </section>

      <nav className="dl-tally" aria-label="Assignment counts">
        <button type="button" onClick={() => setPage("assignments")}><b>{dueToday.length}</b> due today</button>
        <button type="button" onClick={() => setPage("assignments")}><b>{thisWeek.length}</b> in the next 7 days</button>
        <button type="button" className={overdue.length ? "late" : ""} onClick={() => setPage("assignments")}><b>{overdue.length}</b> overdue</button>
        <button type="button" onClick={() => setPage("assignments")}><b>{doneCount}</b> done</button>
      </nav>

      <section className="dl-line" aria-label="Next two weeks">
        <div className="dl-line-head">
          <h2>The next two weeks</h2>
          {hiddenMarks > 0 && <button type="button" onClick={() => setPage("calendar")}>{hiddenMarks} more on the calendar</button>}
        </div>
        <div className="dl-track">
          <div className="dl-days" aria-hidden="true">
            {Array.from({ length: LINE_DAYS }, (_, index) => {
              const ms = lineStart + index * DAY_MS;
              const weekday = new Date(ms).getDay();
              return (
                <span key={ms} className={`${index === 0 ? "today" : ""}${weekday === 0 || weekday === 6 ? " weekend" : ""}`}>
                  <small>{shortDay(ms)}</small>
                </span>
              );
            })}
          </div>
          <div className="dl-axis" />
          <div className="dl-now" style={{ left: `${nowPos}%` }}><span>now</span></div>
          {marks.map(({ item, pos, lane, flip }) => (
            <button
              key={item.id}
              type="button"
              className={`dl-mark${lane < 0 ? " tick-only" : ""}${flip ? " flip" : ""}${NOT_DEADLINES.has(item.type) ? " event" : ""}`}
              style={{ left: `${pos}%`, "--lane": Math.max(lane, 0), "--mark": urgencyColor(item, now) }}
              onClick={() => setPage("calendar")}
              title={`${item.title} · ${shortDate(item.due)} ${item.due_time || ""}`}
            >
              {lane >= 0 && <span className="dl-mark-label"><b>{item.title}</b><small>{item.due_time || "all day"}</small></span>}
            </button>
          ))}
        </div>
      </section>

      <div className="dl-columns">
        <section className="dl-col">
          <h2>{overdue.length ? "Overdue and due today" : "Due today"}</h2>
          {docket.map((item) => (
            <div className={`dl-row${item.due <= now ? " late" : ""}`} key={item.id}>
              <button type="button" className="dl-check" onClick={() => markDone(item)} disabled={completing === item.id} aria-label={`Mark ${item.title} done`}><span className="dl-box" /></button>
              <span className="dl-row-time">{item.due <= now && item.due_date !== todayKey ? shortDate(item.due) : item.due_time || "all day"}</span>
              <button type="button" className="dl-row-main" onClick={() => setPage("assignments")}>
                <b>{item.title}</b><small>{item.course_code || item.type}</small>
              </button>
            </div>
          ))}
          {!docket.length && <p className="dl-empty">Nothing due today.</p>}
        </section>

        <section className="dl-col">
          <h2>Coming up</h2>
          {comingUp.map((item) => (
            <button type="button" className="dl-row dl-row-link" key={item.id} onClick={() => setPage("calendar")}>
              <span className="dl-row-time">{shortDay(item.due)}</span>
              <span className="dl-row-main"><b>{item.title}</b><small>{item.course_code || item.type}</small></span>
              <span className="dl-row-rel" style={{ color: urgencyColor(item, now) }}>{relative(item.due, now)}</span>
            </button>
          ))}
          {!comingUp.length && <p className="dl-empty">Nothing in the next two weeks.</p>}
        </section>

        <section className="dl-col">
          <h2>By class, next 7 days</h2>
          {workload.map(({ course, week, term }) => (
            <div className="dl-class" key={course.id}>
              <span className="dl-class-code"><i style={{ background: course.color }} />{course.code}</span>
              <span className="dl-ticks" aria-label={`${week.length} due this week`}>
                {week.map((item) => <i key={item.id} style={{ background: urgencyColor(item, now) }} title={item.title} />)}
              </span>
              <span className="dl-class-count">{week.length}<small>/{term}</small></span>
            </div>
          ))}
          {!courses.length && <p className="dl-empty">Add a class to see its workload.</p>}
          {courses.length > 0 && <p className="dl-footnote">One mark per item due this week, colored by how close it is. The number after the slash is everything still due this term.</p>}
        </section>
      </div>
    </div>
  );
}
