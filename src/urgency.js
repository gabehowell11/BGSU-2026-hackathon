// Deadline's color system: an item's color says how close its deadline is.
// calm (blue)  -> due in more than 3 days
// warm (amber) -> due within 3 days
// hot  (red)   -> due within 24 hours, or overdue
// done / events fade to grey; class colors are only used as small chips.

const HOUR = 60 * 60 * 1000;
const NOT_DEADLINES = new Set(["holiday", "other"]);

// Due moment for an item; items without a time are due at the end of the day.
export function dueMs(item) {
  if (!item?.due_date) return null;
  return new Date(`${item.due_date}T${item.due_time || "23:59"}:00`).getTime();
}

export function isDeadline(item) {
  return !NOT_DEADLINES.has(item?.type);
}

export function urgency(item, now = Date.now()) {
  if (item.status === "done") return "done";
  if (!isDeadline(item)) return "event";
  const due = dueMs(item);
  if (due == null) return "none";
  const left = due - now;
  if (left <= 0) return "late";
  if (left < 24 * HOUR) return "hot";
  if (left <= 72 * HOUR) return "warm";
  return "calm";
}

const COLORS = {
  late: "var(--u-hot)",
  hot: "var(--u-hot)",
  warm: "var(--u-warm)",
  calm: "var(--u-calm)",
  done: "var(--faint)",
  event: "var(--muted)",
  none: "var(--faint)",
};

export function urgencyColor(item, now) {
  return COLORS[urgency(item, now)];
}
