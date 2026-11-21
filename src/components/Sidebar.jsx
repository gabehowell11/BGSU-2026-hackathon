import React from "react";
import Icon from "./Icon";

export default function Sidebar({ collapsed, setCollapsed, page, setPage, courses }) {
  const links = [
    ["home", "Home"],
    ["calendar", "Calendar"],
    ["assignments", "Assignments"],
    ["chat", "Assistant"],
  ];
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <div className="brand-mark">A</div>
        {!collapsed && <span>AI Student Task Manager</span>}
        <button className="sidebar-toggle" type="button" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar"><Icon name="chevron" /></button>
      </div>
      <nav className="primary-nav" aria-label="Primary navigation">
        {links.map(([id, label]) => (
          <button key={id} type="button" className={page === id ? "active" : ""} onClick={() => setPage(id)} title={collapsed ? label : undefined}>
            <Icon name={id} /><span>{label}</span>
          </button>
        ))}
      </nav>
      {!collapsed && (
        <>
          <div className="sidebar-section">
            <span className="sidebar-label">Workspace</span>
            <button type="button"><Icon name="folder" /><span>Files</span></button>
            <button type="button"><Icon name="settings" /><span>Settings</span></button>
          </div>
          <div className="recent">
            <span className="sidebar-label">Recent classes</span>
            {courses.slice(0, 3).map((course) => (
              <button type="button" key={course.id} onClick={() => setPage("assignments")}><span className="course-dot" style={{ background: course.color }} /><span>{course.code}</span></button>
            ))}
          </div>
        </>
      )}
      <button className="profile" type="button" title="Profile"><span className="avatar">CE</span>{!collapsed && <><span className="profile-name">Carter</span><Icon name="more" /></>}</button>
    </aside>
  );
}
