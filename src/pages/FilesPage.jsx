import React, { useEffect, useMemo, useState } from "react";
import Icon from "../components/Icon";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Plain label for how a file was read.
function fileKind(file) {
  if (file.mime_type?.startsWith("image/")) return "Image";
  if (file.mime_type === "application/pdf") return file.sent_as === "file" ? "Scanned PDF" : "PDF";
  return "Text";
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(`${value.replace(" ", "T")}Z`).toLocaleString();
}

export default function FilesPage({ terms, courses, setItems }) {
  const [files, setFiles] = useState([]);
  const [termId, setTermId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [selected, setSelected] = useState({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resultMessage, setResultMessage] = useState("");

  useEffect(() => {
    if (terms.length && !termId) setTermId(String(terms[0].id));
  }, [terms, termId]);

  useEffect(() => {
    if (!window.database?.listUploadedFiles) return;
    window.database.listUploadedFiles()
      .then(setFiles)
      .catch((nextError) => setError(nextError.message));
  }, []);

  const termCourses = useMemo(
    () => courses.filter((course) => !termId || String(course.term_id) === termId),
    [courses, termId],
  );

  async function refreshFiles() {
    if (window.database?.listUploadedFiles) {
      setFiles(await window.database.listUploadedFiles());
    }
  }

  async function uploadFile() {
    setLoading(true);
    setError("");
    setResultMessage("");
    setDrafts([]);
    setSelected({});

    try {
      if (!window.aivana?.extract) throw new Error("File extraction is unavailable.");
      const result = await window.aivana.extract({
        termId: termId ? Number(termId) : undefined,
        courseId: courseId ? Number(courseId) : undefined,
      });

      if (result.canceled) return;
      await refreshFiles();

      if (result.noDates) {
        setResultMessage(result.reason);
        return;
      }

      if (!result.drafts.length) {
        setResultMessage("No dated assignments were found in this file.");
        return;
      }

      const nextDrafts = result.drafts.map((draft) => ({
        ...draft,
        termId: termId ? Number(termId) : draft.termId,
        courseId: courseId ? Number(courseId) : draft.courseId,
        title: draft.title,
        dueDate: draft.dueDate || "",
      }));
      setDrafts(nextDrafts);
      setSelected(Object.fromEntries(nextDrafts.map((draft) => [draft.draftId, true])));
      setReviewOpen(true);
      setResultMessage(
        `${result.cached ? "Loaded saved scan" : "Scanned"} ${result.files.join(", ")}. Review the assignments before saving.`,
      );
    } catch (nextError) {
      setError(nextError.message || "The file could not be scanned.");
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(draftId, patch) {
    setDrafts((current) => current.map((draft) =>
      draft.draftId === draftId ? { ...draft, ...patch } : draft,
    ));
  }

  async function confirmAssignments() {
    const confirmed = drafts
      .filter((draft) => selected[draft.draftId])
      .map((draft) => ({
        title: draft.title.trim(),
        type: draft.type,
        dueDate: draft.dueDate || null,
        dueTime: draft.dueTime || null,
        weightPct: draft.weightPct,
        status: "todo",
        notes: draft.sourceQuote ? `Source: ${draft.sourceQuote}` : null,
        termId: draft.termId,
        courseId: draft.courseId,
        source: "ai",
        dateText: draft.dateText,
        week: draft.week,
        weekday: draft.weekday,
        sourceQuote: draft.sourceQuote,
        confidence: draft.confidence,
        sourceFile: draft.sourceFile,
        aiDueDate: draft.aiDueDate,
      }))
      .filter((draft) => draft.title && draft.dueDate);

    if (!confirmed.length) {
      setError("Select at least one assignment and give it a due date.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await window.database.createItems(confirmed, { verified: true });
      setItems(await window.database.listItems());
      setReviewOpen(false);
      setDrafts([]);
      setSelected({});
      setResultMessage(`${confirmed.length} assignment${confirmed.length === 1 ? "" : "s"} saved.`);
    } catch (nextError) {
      setError(nextError.message || "Could not save the assignments.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteFile(file) {
    setError("");
    try {
      await window.database.deleteUploadedFile(file.id);
      setFiles((current) => current.filter((entry) => entry.id !== file.id));
    } catch (nextError) {
      setError(nextError.message || "Could not remove the file.");
    }
  }

  return (
    <>
      <header className="page-header files-header">
        <div>
          <span className="eyebrow">Document workspace</span>
          <h1>Files</h1>
        </div>
        <button className="primary-button" type="button" onClick={uploadFile} disabled={loading}>
          <Icon name="plus" size={16} />
          {loading ? "Scanning..." : "Upload file"}
        </button>
      </header>

      {error && <div className="database-error" role="alert">{error}</div>}
      {resultMessage && <div className="files-result">{resultMessage}</div>}

      <p className="file-hint">PDF, Word, TXT, CSV, or photos and scans of handouts. Up to 5 files at a time.</p>

      <section className="file-controls">
        <label>
          <span>Term</span>
          <select value={termId} onChange={(event) => {
            setTermId(event.target.value);
            setCourseId("");
          }}>
            {terms.map((term) => (
              <option key={term.id} value={term.id}>{term.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Course</span>
          <select value={courseId} onChange={(event) => setCourseId(event.target.value)}>
            <option value="">All courses in term</option>
            {termCourses.map((course) => (
              <option key={course.id} value={course.id}>{course.code} {course.name}</option>
            ))}
          </select>
        </label>
      </section>

      <section className="files-table-wrap">
        <div className="files-table-header">
          <span>File</span>
          <span>Scanned</span>
          <span>Assignments found</span>
          <span />
        </div>
        {files.length === 0 ? (
          <div className="empty-state">No files have been sent to Aivana yet.</div>
        ) : files.map((file) => (
          <div className="file-row" key={file.id}>
            <div className="file-name">
              <span className="file-icon"><Icon name="folder" size={16} /></span>
              <div>
                <strong>{file.name}</strong>
                <small>{fileKind(file)}{file.file_size ? `, ${formatSize(file.file_size)}` : ""}</small>
              </div>
            </div>
            <span>{formatDateTime(file.created_at)}</span>
            <span className="file-count">{file.draft_count}</span>
            <button className="icon-button" type="button" onClick={() => deleteFile(file)} aria-label={`Remove ${file.name}`}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
      </section>

      {reviewOpen && (
        <>
          <button className="drawer-overlay" type="button" aria-label="Close review" onClick={() => setReviewOpen(false)} />
          <aside className="review-drawer" aria-label="Review extracted assignments">
            <div className="drawer-header">
              <div>
                <span className="eyebrow">Extraction complete</span>
                <h2>Review assignments</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setReviewOpen(false)} aria-label="Close review">
                <Icon name="close" />
              </button>
            </div>

            <div className="draft-list">
              {drafts.map((draft) => (
                <label className="draft-card" key={draft.draftId}>
                  <input
                    type="checkbox"
                    checked={Boolean(selected[draft.draftId])}
                    onChange={(event) => setSelected((current) => ({
                      ...current,
                      [draft.draftId]: event.target.checked,
                    }))}
                  />
                  <div>
                    <input
                      className="draft-title"
                      value={draft.title}
                      onChange={(event) => updateDraft(draft.draftId, { title: event.target.value })}
                    />
                    <div className="draft-fields">
                      <input
                        type="date"
                        value={draft.dueDate || ""}
                        onChange={(event) => updateDraft(draft.draftId, { dueDate: event.target.value })}
                      />
                      <select
                        value={draft.type}
                        onChange={(event) => updateDraft(draft.draftId, { type: event.target.value })}
                      >
                        <option value="assignment">Assignment</option>
                        <option value="quiz">Quiz</option>
                        <option value="exam">Exam</option>
                        <option value="project">Project</option>
                        <option value="holiday">Holiday</option>
                        <option value="study">Study</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    {draft.sourceQuote && <small>Source: {draft.sourceQuote}</small>}
                    {draft.warnings?.length > 0 && (
                      <small className="draft-warning">{draft.warnings.join(" ")}</small>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="review-actions">
              <button className="secondary-button" type="button" onClick={() => setReviewOpen(false)}>Cancel</button>
              <button className="primary-button" type="button" onClick={confirmAssignments} disabled={loading}>
                {loading ? "Saving..." : "Confirm selected"}
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
