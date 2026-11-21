import React, { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import AssignmentDrawer from "../components/AssignmentDrawer";
import Icon from "../components/Icon";
import { urgency, urgencyColor } from "../urgency";

const STATUS_LABELS = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

function formatDate(date) {
  if (!date) return "No date";
  return new Date(`${date}T12:00:00`).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }) {
  return (
    <span className={`status status-${status}`}>
      <span />
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function AssignmentsPage({ items, courses, terms, setItems }) {
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [rowSelection, setRowSelection] = useState({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItem, setDrawerItem] = useState(undefined);

  const columns = useMemo(() => [
    {
      id: "select",
      header: ({ table }) => (
        <input type="checkbox" checked={table.getIsAllRowsSelected()} onChange={table.getToggleAllRowsSelectedHandler()} aria-label="Select all" />
      ),
      cell: ({ row }) => (
        <input type="checkbox" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} aria-label={`Select ${row.original.title}`} />
      ),
      size: 44,
    },
    {
      accessorKey: "title",
      header: "Assignment",
      cell: ({ row }) => (
        <button className="assignment-name" type="button" onClick={() => openEdit(row.original)}>
          <span className="type-mark" style={{ background: urgencyColor(row.original) }} />
          <span>
            <strong>{row.original.title}</strong>
            {(row.original.weight_pct || row.original.estimated_minutes || row.original.notes) && (
              <small>{[
                row.original.weight_pct ? `${row.original.weight_pct}%` : "",
                row.original.estimated_minutes ? `${Math.round(row.original.estimated_minutes / 60 * 10) / 10}h` : "",
                row.original.notes,
              ].filter(Boolean).join(" · ")}</small>
            )}
          </span>
        </button>
      ),
    },
    {
      accessorKey: "course_code",
      header: "Class",
      cell: ({ row }) => (
        <span className="course-cell">
          <span className="course-dot" style={{ background: row.original.course_color || "#4a8fe7" }} />
          {row.original.course_code || "No class"}
        </span>
      ),
    },
    {
      accessorKey: "due_date",
      header: "Due date",
      cell: ({ row }) => (
        <span className={`due-cell u-${urgency(row.original)}`}>
          {formatDate(row.original.due_date)}
          {row.original.due_time && <small>{row.original.due_time}</small>}
        </span>
      ),
      sortingFn: (left, right) => (left.original.due_date || "9999").localeCompare(right.original.due_date || "9999"),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) => row.original.priority
        ? <span className={`priority priority-${row.original.priority}`}>{row.original.priority}</span>
        : <span className="muted-cell">—</span>,
      sortingFn: (left, right) => {
        const rank = { high: 0, medium: 1, low: 2 };
        return (rank[left.original.priority] ?? 3) - (rank[right.original.priority] ?? 3);
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => <span className="type-label">{row.original.type}</span>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <button className="row-menu" type="button" onClick={() => openEdit(row.original)} aria-label={`Open ${row.original.title}`}><Icon name="more" /></button>
      ),
    },
  ], []);

  const filteredItems = useMemo(() => items.filter((item) => {
    if (tab === "todo" && item.status !== "todo") return false;
    if (tab === "in_progress" && item.status !== "in_progress") return false;
    if (tab === "done" && item.status !== "done") return false;
    if (courseFilter !== "all" && String(item.course_id) !== courseFilter) return false;
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (search && !`${item.title} ${item.course_code || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [items, tab, courseFilter, typeFilter, search]);

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: { rowSelection },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { sorting: [{ id: "due_date", desc: false }] },
  });

  const selectedIds = table.getSelectedRowModel().rows.map((row) => row.original.id);

  function openNew() {
    setDrawerItem(undefined);
    setDrawerOpen(true);
  }

  function openEdit(item) {
    setDrawerItem(item);
    setDrawerOpen(true);
  }

  async function saveItem(values) {
    if (window.database) {
      if (drawerItem) await window.database.updateItem(drawerItem.id, values);
      else await window.database.createItem({ ...values, source: "manual" });
      setItems(await window.database.listItems());
    } else {
      const course = courses.find((entry) => entry.id === values.courseId);
      if (drawerItem) {
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
          verified_at: new Date().toISOString(),
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
    setRowSelection({});
    setDrawerOpen(false);
  }

  async function bulkStatus(status) {
    if (!status) return;
    if (window.database) {
      await Promise.all(selectedIds.map((id) => window.database.setItemStatus(id, status)));
      setItems(await window.database.listItems());
    } else {
      setItems((current) => current.map((item) => selectedIds.includes(item.id) ? { ...item, status } : item));
    }
    setRowSelection({});
  }

  async function bulkCourse(courseId) {
    if (!courseId) return;
    if (window.database) {
      await Promise.all(selectedIds.map((id) => window.database.updateItem(id, {
        courseId: courseId === "none" ? null : Number(courseId),
      })));
      setItems(await window.database.listItems());
    } else {
      const course = courses.find((entry) => String(entry.id) === courseId);
      setItems((current) => current.map((item) => selectedIds.includes(item.id) ? {
        ...item,
        course_id: courseId === "none" ? null : course?.id,
        course_code: course?.code,
        course_name: course?.name,
        course_color: course?.color,
      } : item));
    }
    setRowSelection({});
  }

  async function bulkMoveDate(dueDate) {
    if (!dueDate) return;
    if (window.database) {
      await Promise.all(selectedIds.map((id) => window.database.updateItem(id, { dueDate })));
      setItems(await window.database.listItems());
    } else {
      setItems((current) => current.map((item) => selectedIds.includes(item.id) ? { ...item, due_date: dueDate } : item));
    }
    setRowSelection({});
  }

  async function bulkDelete() {
    if (window.database) {
      await Promise.all(selectedIds.map((id) => window.database.deleteItem(id)));
      setItems(await window.database.listItems());
    } else {
      setItems((current) => current.filter((item) => !selectedIds.includes(item.id)));
    }
    setRowSelection({});
  }

  const counts = {
    all: items.length,
    todo: items.filter((item) => item.status === "todo").length,
    in_progress: items.filter((item) => item.status === "in_progress").length,
    done: items.filter((item) => item.status === "done").length,
  };

  return (
    <>
      <header className="page-header">
        <div><span className="eyebrow">{terms[0]?.name || "Current term"}</span><h1>Assignments</h1></div>
        <button className="primary-button" type="button" onClick={openNew}><Icon name="plus" />New assignment</button>
      </header>
      <div className="table-toolbar">
        <div className="tabs" role="tablist">
          {[["all", "All"], ["todo", "To do"], ["in_progress", "In progress"], ["done", "Completed"]].map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}<span>{counts[id]}</span></button>
          ))}
        </div>
        <div className="toolbar-actions">
          {selectedIds.length > 0 ? (
            <div className="bulk-actions">
              <span>{selectedIds.length} selected</span>
              <select className="filter-select" defaultValue="" onChange={(event) => bulkStatus(event.target.value)} aria-label="Change selected status"><option value="" disabled>Status</option><option value="todo">To do</option><option value="in_progress">In progress</option><option value="done">Completed</option></select>
              <select className="filter-select" defaultValue="" onChange={(event) => bulkCourse(event.target.value)} aria-label="Change selected class"><option value="" disabled>Class</option><option value="none">No class</option>{courses.map((course) => <option key={course.id} value={String(course.id)}>{course.code}</option>)}</select>
              <input className="bulk-date" type="date" aria-label="Move selected due date" onChange={(event) => bulkMoveDate(event.target.value)} />
              <button className="icon-button" type="button" onClick={bulkDelete} aria-label="Delete selected"><Icon name="trash" /></button>
            </div>
          ) : (
            <>
              <label className="search-field"><Icon name="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assignments" /></label>
              <select className="filter-select" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="all">All classes</option>{courses.map((course) => <option key={course.id} value={String(course.id)}>{course.code}</option>)}</select>
              <select className="filter-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">All types</option><option value="assignment">Assignments</option><option value="project">Projects</option><option value="quiz">Quizzes</option><option value="exam">Exams</option><option value="holiday">Holidays</option><option value="other">Other events</option></select>
            </>
          )}
        </div>
      </div>
      <div className="assignment-table-wrap">
        <table className="assignment-table">
          <thead>{table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>{headerGroup.headers.map((header) => (
              <th key={header.id} className={header.column.id === "select" ? "check-column" : header.column.id === "actions" ? "more-column" : ""}>
                {header.column.getCanSort()
                  ? <button className="sort-header" type="button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}</button>
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}</tr>
          ))}</thead>
          <tbody>{table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.getIsSelected() ? "selected" : ""} onDoubleClick={() => openEdit(row.original)}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className={cell.column.id === "select" ? "check-column" : cell.column.id === "actions" ? "more-column" : ""}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
        {table.getRowModel().rows.length === 0 && <div className="empty-state">No assignments match these filters.</div>}
      </div>
      <AssignmentDrawer open={drawerOpen} item={drawerItem} courses={courses} terms={terms} onClose={() => setDrawerOpen(false)} onSave={saveItem} onDelete={deleteItem} />
    </>
  );
}
