import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const EMPTY_TERM = { name: "", startDate: "", endDate: "" };
const EMPTY_COURSE = { code: "", name: "", color: "#3157c8", termId: "" };
const EMPTY_ITEM = {
  title: "",
  type: "assignment",
  dueDate: "",
  dueTime: "",
  status: "todo",
  termId: "",
  courseId: "",
};

const STATUS_LABELS = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

// Renders the term, course, and item forms plus the one-shot Aivana prompt.
function App() {
  const [prompt, setPrompt] = useState("Say hello in five words.");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [terms, setTerms] = useState([]);
  const [courses, setCourses] = useState([]);
  const [items, setItems] = useState([]);
  const [termForm, setTermForm] = useState(EMPTY_TERM);
  const [courseForm, setCourseForm] = useState(EMPTY_COURSE);
  const [itemForm, setItemForm] = useState(EMPTY_ITEM);
  const [databaseError, setDatabaseError] = useState("");

  // Loads terms, courses, and items from the database into the page.
  async function loadData() {
    const [nextTerms, nextCourses, nextItems] = await Promise.all([
      window.database.listTerms(),
      window.database.listCourses(),
      window.database.listItems(),
    ]);
    setTerms(nextTerms);
    setCourses(nextCourses);
    setItems(nextItems);
  }

  useEffect(() => {
    loadData().catch((error) => setDatabaseError(error.message));
  }, []);

  // Saves the term form and reloads the lists.
  async function addTerm(event) {
    event.preventDefault();
    setDatabaseError("");

    try {
      await window.database.createTerm(termForm);
      setTermForm(EMPTY_TERM);
      await loadData();
    } catch (error) {
      setDatabaseError(error.message || "Could not save the term.");
    }
  }

  // Saves the course form and reloads the lists.
  async function addCourse(event) {
    event.preventDefault();
    setDatabaseError("");

    try {
      await window.database.createCourse(courseForm);
      setCourseForm(EMPTY_COURSE);
      await loadData();
    } catch (error) {
      setDatabaseError(error.message || "Could not save the course.");
    }
  }

  // Saves a manual item and reloads the lists.
  async function addItem(event) {
    event.preventDefault();
    setDatabaseError("");

    try {
      await window.database.createItem({ ...itemForm, source: "manual" });
      setItemForm(EMPTY_ITEM);
      await loadData();
    } catch (error) {
      setDatabaseError(error.message || "Could not save the item.");
    }
  }

  // Deletes one term, course, or item, then reloads the lists.
  async function remove(action, id) {
    setDatabaseError("");

    try {
      await action(id);
      await loadData();
    } catch (error) {
      setDatabaseError(error.message || "Could not delete that row.");
    }
  }

  // Sends the prompt to Aivana and shows the answer.
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
        <h2>Term</h2>
        <form className="data-form" onSubmit={addTerm}>
          <label htmlFor="termName">Name</label>
          <input
            id="termName"
            value={termForm.name}
            onChange={(event) => setTermForm({ ...termForm, name: event.target.value })}
            placeholder="Fall 2026"
            required
          />
          <label htmlFor="startDate">Start</label>
          <input
            id="startDate"
            type="date"
            value={termForm.startDate}
            onChange={(event) => setTermForm({ ...termForm, startDate: event.target.value })}
            required
          />
          <label htmlFor="endDate">End</label>
          <input
            id="endDate"
            type="date"
            value={termForm.endDate}
            onChange={(event) => setTermForm({ ...termForm, endDate: event.target.value })}
            required
          />
          <button type="submit">Save term</button>
        </form>
        {terms.length === 0 ? (
          <p>No term saved yet. The start date is the anchor for “Week 6 Friday”.</p>
        ) : (
          <ul className="record-list">
            {terms.map((term) => (
              <li key={term.id}>
                <div>
                  <strong>{term.name}</strong>
                  <div>{term.start_date} to {term.end_date}</div>
                </div>
                <button type="button" onClick={() => remove(window.database.deleteTerm, term.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Course</h2>
        <form className="data-form" onSubmit={addCourse}>
          <label htmlFor="courseCode">Code</label>
          <input
            id="courseCode"
            value={courseForm.code}
            onChange={(event) => setCourseForm({ ...courseForm, code: event.target.value })}
            placeholder="CS 3350"
            required
          />
          <label htmlFor="courseName">Name</label>
          <input
            id="courseName"
            value={courseForm.name}
            onChange={(event) => setCourseForm({ ...courseForm, name: event.target.value })}
            required
          />
          <label htmlFor="courseColor">Color</label>
          <input
            id="courseColor"
            type="color"
            value={courseForm.color}
            onChange={(event) => setCourseForm({ ...courseForm, color: event.target.value })}
          />
          <label htmlFor="courseTerm">Term</label>
          <select
            id="courseTerm"
            value={courseForm.termId}
            onChange={(event) => setCourseForm({ ...courseForm, termId: event.target.value })}
            required
          >
            <option value="">Select a term</option>
            {terms.map((term) => (
              <option key={term.id} value={term.id}>{term.name}</option>
            ))}
          </select>
          <button type="submit">Save course</button>
        </form>
        {courses.length === 0 ? (
          <p>No courses saved yet.</p>
        ) : (
          <ul className="record-list">
            {courses.map((course) => (
              <li key={course.id}>
                <div>
                  <strong style={{ color: course.color }}>{course.code}</strong>
                  <span> {course.name}</span>
                </div>
                <button type="button" onClick={() => remove(window.database.deleteCourse, course.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Items</h2>
        <form className="data-form" onSubmit={addItem}>
          <label htmlFor="itemTitle">Title</label>
          <input
            id="itemTitle"
            value={itemForm.title}
            onChange={(event) => setItemForm({ ...itemForm, title: event.target.value })}
            required
          />
          <label htmlFor="itemType">Type</label>
          <select
            id="itemType"
            value={itemForm.type}
            onChange={(event) => setItemForm({ ...itemForm, type: event.target.value })}
          >
            <option value="assignment">Assignment</option>
            <option value="quiz">Quiz</option>
            <option value="exam">Exam</option>
            <option value="project">Project</option>
            <option value="holiday">Holiday</option>
            <option value="other">Other</option>
          </select>
          <label htmlFor="itemTerm">Term</label>
          <select
            id="itemTerm"
            value={itemForm.termId}
            onChange={(event) => setItemForm({
              ...itemForm,
              termId: event.target.value,
              courseId: "",
            })}
            required
          >
            <option value="">Select a term</option>
            {terms.map((term) => (
              <option key={term.id} value={term.id}>{term.name}</option>
            ))}
          </select>
          <label htmlFor="itemCourse">Course</label>
          <select
            id="itemCourse"
            value={itemForm.courseId}
            onChange={(event) => setItemForm({ ...itemForm, courseId: event.target.value })}
          >
            <option value="">Term-wide, no course</option>
            {courses
              .filter((course) => String(course.term_id) === String(itemForm.termId))
              .map((course) => (
                <option key={course.id} value={course.id}>{course.code}</option>
              ))}
          </select>
          <label htmlFor="itemDueDate">Due date</label>
          <input
            id="itemDueDate"
            type="date"
            value={itemForm.dueDate}
            onChange={(event) => setItemForm({ ...itemForm, dueDate: event.target.value })}
          />
          <label htmlFor="itemDueTime">Due time</label>
          <input
            id="itemDueTime"
            type="time"
            value={itemForm.dueTime}
            onChange={(event) => setItemForm({ ...itemForm, dueTime: event.target.value })}
          />
          <label htmlFor="itemStatus">Status</label>
          <select
            id="itemStatus"
            value={itemForm.status}
            onChange={(event) => setItemForm({ ...itemForm, status: event.target.value })}
          >
            <option value="todo">To do</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
          </select>
          <button type="submit">Save item</button>
        </form>
        {items.length === 0 ? (
          <p>No items saved yet.</p>
        ) : (
          <ul className="record-list">
            {items.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span> · {item.type}</span>
                  {item.course_code && <span> · {item.course_code}</span>}
                  <div>
                    {item.due_date ? `Due: ${item.due_date}` : "Needs a date"}
                    {item.due_time ? ` ${item.due_time}` : ""}
                  </div>
                  <div>
                    {STATUS_LABELS[item.status] || item.status}
                    {!item.verified_at && <span className="unverified"> · Unverified</span>}
                  </div>
                </div>
                <button type="button" onClick={() => remove(window.database.deleteItem, item.id)}>
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
