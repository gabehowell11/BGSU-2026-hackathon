import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  const [prompt, setPrompt] = useState("Say hello in five words.");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [assignments, setAssignments] = useState([]);
  const [assignmentForm, setAssignmentForm] = useState({
    title: "",
    className: "",
    dueDate: "",
    status: "not_started",
    priority: "normal",
    notes: "",
  });
  const [databaseError, setDatabaseError] = useState("");

  useEffect(() => {
    window.database.listAssignments()
      .then(setAssignments)
      .catch((error) => setDatabaseError(error.message));
  }, []);

  async function addAssignment(event) {
    event.preventDefault();
    setDatabaseError("");

    try {
      await window.database.createAssignment(assignmentForm);
      setAssignments(await window.database.listAssignments());
      setAssignmentForm({
        title: "",
        className: "",
        dueDate: "",
        status: "not_started",
        priority: "normal",
        notes: "",
      });
    } catch (error) {
      setDatabaseError(error.message || "Could not save the assignment.");
    }
  }

  async function deleteAssignment(id) {
    setDatabaseError("");

    try {
      await window.database.deleteAssignment(id);
      setAssignments(await window.database.listAssignments());
    } catch (error) {
      setDatabaseError(error.message || "Could not delete the assignment.");
    }
  }

  async function askAivana(event) {
    event.preventDefault();
    setLoading(true);
    setAnswer("");

    try {
      setAnswer(await window.aivana.generate(prompt));
    } catch (error) {
      setAnswer(error.message || "Aivana request failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>AI Student Task Manager</h1>

      {databaseError && <p role="alert" className="error">{databaseError}</p>}

      <section>
        <h2>Add assignment</h2>
        <form className="assignment-form" onSubmit={addAssignment}>
          <label htmlFor="title">Title</label>
          <input
            id="title"
            value={assignmentForm.title}
            onChange={(event) =>
              setAssignmentForm({ ...assignmentForm, title: event.target.value })
            }
            required
          />

          <label htmlFor="className">Class</label>
          <input
            id="className"
            value={assignmentForm.className}
            onChange={(event) =>
              setAssignmentForm({ ...assignmentForm, className: event.target.value })
            }
          />

          <label htmlFor="dueDate">Due date</label>
          <input
            id="dueDate"
            type="date"
            value={assignmentForm.dueDate}
            onChange={(event) =>
              setAssignmentForm({ ...assignmentForm, dueDate: event.target.value })
            }
          />

          <label htmlFor="status">Status</label>
          <select
            id="status"
            value={assignmentForm.status}
            onChange={(event) =>
              setAssignmentForm({ ...assignmentForm, status: event.target.value })
            }
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </select>

          <button type="submit">Save assignment</button>
        </form>
      </section>

      <section>
        <h2>Assignments</h2>
        {assignments.length === 0 ? (
          <p>No assignments saved yet.</p>
        ) : (
          <ul className="assignment-list">
            {assignments.map((assignment) => (
              <li key={assignment.id}>
                <div>
                  <strong>{assignment.title}</strong>
                  {assignment.class_name && <span> - {assignment.class_name}</span>}
                  {assignment.due_date && <div>Due: {assignment.due_date}</div>}
                  <div>Status: {assignment.status.replace("_", " ")}</div>
                </div>
                <button
                  type="button"
                  onClick={() => deleteAssignment(assignment.id)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={askAivana}>
        <label htmlFor="prompt">Prompt</label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows="4"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Asking..." : "Ask Aivana"}
        </button>
      </form>
      {answer && (
        <section>
          <h2>Response</h2>
          <p>{answer}</p>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
