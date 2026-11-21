import React, { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";

const EMPTY_TERM = { name: "", startDate: "", endDate: "" };
const EMPTY_COURSE = { code: "", name: "", color: "#4a8fe7", termId: "" };

function shortDate(value) {
  if (!value) return "";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const number = (value) => Number(value || 0).toLocaleString();

// Two-step delete: the first click arms the button, the second deletes.
function DeleteButton({ label, armed, onArm, onConfirm }) {
  return armed
    ? <button className="danger-button settings-small" type="button" onClick={onConfirm}>Confirm delete</button>
    : <button className="icon-button" type="button" onClick={onArm} aria-label={label}><Icon name="trash" size={15} /></button>;
}

export default function SettingsPage({ terms, courses, onDataChanged }) {
  const [termForm, setTermForm] = useState(null); // { id?, name, startDate, endDate }
  const [courseForm, setCourseForm] = useState(null); // { id?, code, name, color, termId }
  const [armed, setArmed] = useState(null); // "term-1", "course-4", "chat", "files"
  const [usage, setUsage] = useState([]);
  const [fileCount, setFileCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadExtras() {
    const [nextUsage, files] = await Promise.all([
      window.database?.listUsage?.() ?? [],
      window.database?.listUploadedFiles?.() ?? [],
    ]);
    setUsage(nextUsage);
    setFileCount(files.length);
  }

  useEffect(() => {
    loadExtras().catch((nextError) => setError(nextError.message));
  }, []);

  const termNames = useMemo(() => new Map(terms.map((term) => [term.id, term.name])), [terms]);

  const totals = useMemo(() => {
    const byFeature = { chat: { requests: 0, input: 0, output: 0 }, extract: { requests: 0, input: 0, output: 0 } };
    let credits = 0;
    for (const row of usage) {
      const bucket = byFeature[row.feature] || (byFeature[row.feature] = { requests: 0, input: 0, output: 0 });
      bucket.requests += 1;
      bucket.input += row.input_tokens || 0;
      bucket.output += row.output_tokens || 0;
      credits += row.credits || 0;
    }
    return { byFeature, credits };
  }, [usage]);

  // Runs one change, shows its result, and refreshes app data.
  async function run(action, success) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setArmed(null);
      if (success) setNotice(typeof success === "function" ? success(result) : success);
      await onDataChanged();
      await loadExtras();
      return result;
    } catch (nextError) {
      setError(nextError.message || "That change could not be saved.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function saveTerm(event) {
    event.preventDefault();
    const values = { name: termForm.name.trim(), startDate: termForm.startDate, endDate: termForm.endDate };
    const saved = await run(
      () => (termForm.id ? window.database.updateTerm(termForm.id, values) : window.database.createTerm(values)),
      termForm.id ? "Term saved." : "Term added.",
    );
    if (saved) setTermForm(null);
  }

  async function saveCourse(event) {
    event.preventDefault();
    const values = {
      code: courseForm.code.trim(),
      name: courseForm.name.trim(),
      color: courseForm.color,
      termId: Number(courseForm.termId),
    };
    const saved = await run(
      () => (courseForm.id ? window.database.updateCourse(courseForm.id, values) : window.database.createCourse(values)),
      courseForm.id ? "Class saved." : "Class added.",
    );
    if (saved) setCourseForm(null);
  }

  function exportCalendar() {
    run(() => window.database.exportIcs(), (result) => (
      result?.canceled ? "" : `Exported ${result.count} ${result.count === 1 ? "item" : "items"} to ${result.path}.`
    ));
  }

  function clearChat() {
    run(() => window.database.clearChatMessages(), "Chat history cleared.");
  }

  async function clearFiles() {
    await run(async () => {
      const files = await window.database.listUploadedFiles();
      for (const file of files) await window.database.deleteUploadedFile(file.id);
      return files.length;
    }, (count) => `Removed ${count} file ${count === 1 ? "record" : "records"}.`);
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <div><span className="eyebrow">Deadline</span><h1>Settings</h1></div>
      </header>

      {error && <div className="database-error" role="alert">{error}</div>}
      {notice && <div className="files-result" role="status">{notice}</div>}

      <section className="settings-section">
        <div className="settings-head">
          <div>
            <h2>Terms</h2>
            <p>Each term holds its classes and assignments. Deleting a term deletes everything in it.</p>
          </div>
          {!termForm && <button className="secondary-button" type="button" onClick={() => setTermForm({ ...EMPTY_TERM })}><Icon name="plus" />Add term</button>}
        </div>

        <div className="settings-table">
          {terms.map((term) => (
            termForm?.id === term.id ? null : (
              <div className="settings-row" key={term.id}>
                <span className="settings-main"><b>{term.name}</b><small>{shortDate(term.start_date)} to {shortDate(term.end_date)}</small></span>
                <span className="settings-meta">{courses.filter((course) => course.term_id === term.id).length} classes</span>
                <span className="settings-actions">
                  <button className="settings-link" type="button" onClick={() => setTermForm({ id: term.id, name: term.name, startDate: term.start_date, endDate: term.end_date })}>Edit</button>
                  <DeleteButton label={`Delete ${term.name}`} armed={armed === `term-${term.id}`} onArm={() => setArmed(`term-${term.id}`)} onConfirm={() => run(() => window.database.deleteTerm(term.id), `${term.name} deleted.`)} />
                </span>
              </div>
            )
          ))}
          {termForm && (
            <form className="settings-form" onSubmit={saveTerm}>
              <label>Name<input value={termForm.name} onChange={(event) => setTermForm({ ...termForm, name: event.target.value })} placeholder="Spring 2027" required /></label>
              <label>Starts<input type="date" value={termForm.startDate} onChange={(event) => setTermForm({ ...termForm, startDate: event.target.value })} required /></label>
              <label>Ends<input type="date" value={termForm.endDate} onChange={(event) => setTermForm({ ...termForm, endDate: event.target.value })} required /></label>
              <span className="settings-form-actions">
                <button className="secondary-button" type="button" onClick={() => setTermForm(null)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={busy}>{termForm.id ? "Save term" : "Add term"}</button>
              </span>
            </form>
          )}
          {!terms.length && !termForm && <p className="settings-empty">No terms yet. Add one, or upload a syllabus on the Files page.</p>}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-head">
          <div>
            <h2>Classes</h2>
            <p>The color marks the class everywhere in the app. Deleting a class deletes its assignments.</p>
          </div>
          {!courseForm && terms.length > 0 && <button className="secondary-button" type="button" onClick={() => setCourseForm({ ...EMPTY_COURSE, termId: String(terms[0].id) })}><Icon name="plus" />Add class</button>}
        </div>

        <div className="settings-table">
          {courses.map((course) => (
            courseForm?.id === course.id ? null : (
              <div className="settings-row" key={course.id}>
                <span className="settings-main settings-course"><i style={{ background: course.color }} /><span><b>{course.code}</b><small>{course.name}</small></span></span>
                <span className="settings-meta">{termNames.get(course.term_id) || ""}</span>
                <span className="settings-actions">
                  <button className="settings-link" type="button" onClick={() => setCourseForm({ id: course.id, code: course.code, name: course.name, color: course.color || EMPTY_COURSE.color, termId: String(course.term_id) })}>Edit</button>
                  <DeleteButton label={`Delete ${course.code}`} armed={armed === `course-${course.id}`} onArm={() => setArmed(`course-${course.id}`)} onConfirm={() => run(() => window.database.deleteCourse(course.id), `${course.code} deleted.`)} />
                </span>
              </div>
            )
          ))}
          {courseForm && (
            <form className="settings-form course" onSubmit={saveCourse}>
              <label>Code<input value={courseForm.code} onChange={(event) => setCourseForm({ ...courseForm, code: event.target.value })} placeholder="CS 3350" required /></label>
              <label>Name<input value={courseForm.name} onChange={(event) => setCourseForm({ ...courseForm, name: event.target.value })} placeholder="Operating Systems" required /></label>
              <label>Term<select value={courseForm.termId} onChange={(event) => setCourseForm({ ...courseForm, termId: event.target.value })}>{terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}</select></label>
              <label>Color<input type="color" value={courseForm.color} onChange={(event) => setCourseForm({ ...courseForm, color: event.target.value })} /></label>
              <span className="settings-form-actions">
                <button className="secondary-button" type="button" onClick={() => setCourseForm(null)}>Cancel</button>
                <button className="primary-button" type="submit" disabled={busy}>{courseForm.id ? "Save class" : "Add class"}</button>
              </span>
            </form>
          )}
          {!courses.length && !courseForm && <p className="settings-empty">{terms.length ? "No classes yet." : "Add a term first, then its classes."}</p>}
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-head">
          <div>
            <h2>Calendar export</h2>
            <p>Save your dated, confirmed assignments as an .ics file for Google Calendar, Outlook, or Apple Calendar.</p>
          </div>
          <button className="secondary-button" type="button" onClick={exportCalendar} disabled={busy}>Export .ics</button>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-head">
          <div>
            <h2>Aivana usage</h2>
            <p>Tokens used by the assistant and file scans on this computer.</p>
          </div>
        </div>
        <div className="settings-usage">
          {[["Assistant", totals.byFeature.chat], ["File scans", totals.byFeature.extract]].map(([label, bucket]) => (
            <div key={label}>
              <span>{label}</span>
              <b>{number(bucket.input + bucket.output)}</b>
              <small>{number(bucket.requests)} requests, {number(bucket.input)} in, {number(bucket.output)} out</small>
            </div>
          ))}
          <div>
            <span>Credits</span>
            <b>{totals.credits ? totals.credits.toFixed(2) : "0"}</b>
            <small>All features combined</small>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-head">
          <div>
            <h2>Data on this computer</h2>
            <p>Everything stays in a local database. These remove saved records and cannot be undone.</p>
          </div>
        </div>
        <div className="settings-table">
          <div className="settings-row">
            <span className="settings-main"><b>Chat history</b><small>Messages with the assistant</small></span>
            <span className="settings-meta" />
            <span className="settings-actions">
              {armed === "chat"
                ? <button className="danger-button settings-small" type="button" onClick={clearChat}>Confirm clear</button>
                : <button className="settings-link" type="button" onClick={() => setArmed("chat")}>Clear</button>}
            </span>
          </div>
          <div className="settings-row">
            <span className="settings-main"><b>Uploaded file records</b><small>Names and text of scanned files. Your assignments stay.</small></span>
            <span className="settings-meta">{fileCount} {fileCount === 1 ? "file" : "files"}</span>
            <span className="settings-actions">
              {armed === "files"
                ? <button className="danger-button settings-small" type="button" onClick={clearFiles}>Confirm remove</button>
                : <button className="settings-link" type="button" onClick={() => setArmed("files")} disabled={!fileCount}>Remove</button>}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
