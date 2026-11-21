import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import Icon from "./Icon";

export default function AssignmentDrawer({ open, item, courses, terms, onClose, onSave, onDelete }) {
  const [form, setForm] = useState({});

  useEffect(() => {
    const event = item && !["assignment", "project", "quiz", "exam"].includes(item.type);
    setForm({
      kind: event ? "event" : "assignment",
      title: item?.title || "",
      courseId: item?.course_id || "",
      dueDate: item?.due_date || "",
      endDate: item?.end_date || "",
      dueTime: item?.due_time || "23:59",
      status: item?.status || "todo",
      type: item?.type || "assignment",
      priority: item?.priority || "medium",
      estimatedMinutes: item?.estimated_minutes || "",
      weightPct: item?.weight_pct || "",
      notes: item?.notes || "",
      allDay: item?.all_day ? true : Boolean(event && !item?.due_time),
    });
  }, [item, open]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (!form.title?.trim()) return;
    onSave({
      title: form.title.trim(),
      courseId: form.courseId ? Number(form.courseId) : null,
      termId: terms[0]?.id,
      dueDate: form.dueDate || null,
      endDate: form.endDate || null,
      dueTime: form.allDay ? null : (form.dueTime || null),
      status: form.kind === "event" ? "todo" : form.status,
      type: form.type,
      priority: form.priority,
      estimatedMinutes: form.estimatedMinutes === "" ? null : Number(form.estimatedMinutes),
      weightPct: form.weightPct === "" ? null : Number(form.weightPct),
      notes: form.notes.trim() || null,
      allDay: form.allDay,
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="drawer" aria-describedby={undefined}>
          <div className="drawer-header">
            <div><span className="eyebrow">{item ? "Assignment" : "Create"}</span><Dialog.Title>{item ? "Edit assignment" : "New assignment"}</Dialog.Title></div>
            <Dialog.Close asChild><button className="icon-button" type="button" aria-label="Close"><Icon name="close" /></button></Dialog.Close>
          </div>
          <form className="assignment-form" onSubmit={submit}>
            <div className="creation-kind" role="radiogroup" aria-label="Creation type">
              <button type="button" className={form.kind === "assignment" ? "active" : ""} onClick={() => { update("kind", "assignment"); update("type", "assignment"); }}><strong>Assignment</strong><span>Work with a due date</span></button>
              <button type="button" className={form.kind === "event" ? "active" : ""} onClick={() => { update("kind", "event"); update("status", "todo"); update("type", "holiday"); }}><strong>Event</strong><span>Date or class schedule item</span></button>
            </div>
            <label>Title<input value={form.title || ""} onChange={(event) => update("title", event.target.value)} placeholder={form.kind === "assignment" ? "Assignment name" : "Event name"} required /></label>
            <label>{form.kind === "assignment" ? "Class" : "Linked class"}<select value={form.courseId || ""} onChange={(event) => update("courseId", event.target.value)}><option value="">No class</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.code} - {course.name}</option>)}</select></label>
            <div className="form-row">
              <label>{form.kind === "assignment" ? "Due date" : "Start date"}<input type="date" value={form.dueDate || ""} onChange={(event) => update("dueDate", event.target.value)} /></label>
              <label>{form.kind === "assignment" ? "Due time" : "End date"}{form.kind === "assignment" ? <input type="time" value={form.dueTime || ""} onChange={(event) => update("dueTime", event.target.value)} disabled={form.allDay} /> : <input type="date" value={form.endDate || ""} onChange={(event) => update("endDate", event.target.value)} />}</label>
            </div>
            <label className="check-label"><input type="checkbox" checked={Boolean(form.allDay)} onChange={(event) => update("allDay", event.target.checked)} />All day</label>
            {form.kind === "event" ? (
              <div className="form-row">
                <label>Event type<select value={form.type || "holiday"} onChange={(event) => update("type", event.target.value)}><option value="holiday">Holiday</option><option value="exam">Exam</option><option value="quiz">Quiz</option><option value="other">Other event</option></select></label>
                {!form.allDay && <label>Time<input type="time" value={form.dueTime || ""} onChange={(event) => update("dueTime", event.target.value)} /></label>}
              </div>
            ) : (
              <div className="form-row">
                <label>Status<select value={form.status || "todo"} onChange={(event) => update("status", event.target.value)}><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Done</option></select></label>
                <label>Type<select value={form.type || "assignment"} onChange={(event) => update("type", event.target.value)}><option value="assignment">Assignment</option><option value="quiz">Quiz</option><option value="exam">Exam</option><option value="project">Project</option><option value="holiday">Holiday</option><option value="other">Other</option></select></label>
              </div>
            )}
            {form.kind === "assignment" && (
              <div className="form-row">
                <label>Priority<select value={form.priority || "medium"} onChange={(event) => update("priority", event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
                <label>Estimated time<input type="number" min="0" step="15" value={form.estimatedMinutes || ""} onChange={(event) => update("estimatedMinutes", event.target.value)} placeholder="Minutes" /></label>
              </div>
            )}
            {form.kind === "assignment" && <label>Course weight (%)<input type="number" min="0" max="100" step="0.5" value={form.weightPct || ""} onChange={(event) => update("weightPct", event.target.value)} placeholder="Optional" /></label>}
            <label>Notes<textarea value={form.notes || ""} onChange={(event) => update("notes", event.target.value)} rows="3" placeholder="Optional details" /></label>
            <div className="drawer-actions">
              {item && <button className="danger-button" type="button" onClick={() => onDelete(item)}><Icon name="trash" />Delete</button>}
              <span />
              <Dialog.Close asChild><button className="secondary-button" type="button">Cancel</button></Dialog.Close>
              <button className="primary-button" type="submit">{item ? "Save" : "Create"}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
