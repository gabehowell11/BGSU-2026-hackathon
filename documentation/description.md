# AI Student Task Manager

## Who It's For

Students who need an easy way to track all of the important dates and assignments from their different classes.

## Core Functionality

### Features:

**Core:**

- Option to manually upload dates or assignments as a backup (without chatbot)
- Ability to upload files containing dates or assignment information and extract the info to be displayed (i.e. due dates, exams, holidays, etc.)
  - User MUST verify/confirm assignments and dates before saving
- Different ways to visualize upcoming dates and assignments:
  - Calendar view (by month, by week, or by day)
  - Assignment list, with status (not started/completed/etc.), a due date, a class section, priority?, notes?

**Standard:**

- AI Chat Bot/Agent to add/delete/modify assignments or dates, and more
  - Multi-line memory for back and forth conversation (advanced?)
  - "Stream" feature, live text response from Aivana

**Advanced:**

- Testing features (accuracy of AI, functional tests)
- Upload picture of paper assignment
- Export to external calendar apps

**Various Features**:

- Main "home" page which shows upcoming assignments/dates, and links

## Architecture

### Frontend:

- React framework
- HTML/CSS
- UI Primitives with Radix
- Tailwind for CSS
- Calendar library?
- TanStack table for filtering/sorting/selection, etc.
- Custom components for anything else

### Backend:

- Node.js with Electron
- Pass info to frontend with ICF
- API calls to Aivana

### Database:

- SQLite DB
- Schema TBD

## Pages/Design

### Sidebar

- Logo/App name
- Collapse button
- Navigation between pages
  - Home/Calendar/Assignments/Chat/Settings/Files
- Quick Add button
- Recently viewed assignments/classes
- Profile/username?

### Home Page

- Top Section
  - Greeting/Introduction + current date
  - Summary of what is due:
    - Today, this week, overdue, recently completed
  - Quick Actions
    - Add assignment
    - Upload file/syllabus
    - Open calendar
    - Ask Aivana
- "Widgets"
  - Today
    - Simple view of todays assignments with name, due date, course, status, and checkbox
  - Coming up
    - Next 7 days
    - Show time until assignments are due (i.e. "2 days left")
    - Course workload/heatmap (identify busy weeks)
    - Quick links and Aivana Panel

### Calendar Page

- Modern style calendar with options for day/week/month view
- Drag and drop calendar events
- Filter by assignment type, status, class, etc.
- Ability to search through titles
- Each event has selectable color
- Month view:
  - Google-calendar style grid
  - Assignment blocks w/ due date, title, and color
  - Overflow indicator for full calendar days
  - Click a day to open day view
  - Double click or click plus button to add assignment, which opens already made assignment creating modal
  - Distinct/unique style for overdue/completed/not started/exams/holidays/study blocks, ec.
- Week View:
  - Seven columns with small blocks for events in each column
  - Time lines
  - Seperate view for "all-day" events
  - Event blocks have time, title, class, and status
  - Expandable long titles
- Day View:
  - Chronological list
  - Hourly time scale, with time lines for every 30min
  - Assignments are full(/expandable) cards with title, due date and time, class, status, priority, and quick actions
  - Add class/holiday/exam

### Assignment List Page

- Meant for sorting, bulk editing, or workload managment
- Essentially a large table with columns for:
  - Selection checkbox
  - Assignment name
  - Class
  - Due date / time?
  - Status (not started, in prog, completed)
  - Priority/Notes/Estimated Time (optional)
- Can select multiple assignments and commit bulk actions:
  - Complete, change status/priority/class, move date, delete
- Features:
  - Searching, filtering, and sorting
  - Maybe eventually add compact or card views
- Double clicking or opening an assignment will show same "assignment creation (/editing)" modal, which might pull in from the right side?
  - Required fields:
    - Title, due date, class
  - Default fields:
    - Due time (11:59PM)
    - Status (not started)
  - Optional fields:
    - Type, priority, notes, estimated time, etc.

### Aivana Chat and Upload Page

- Upload workflow:
  - Upload file or image
  - Info extracted
  - Pop up assignment creation modal
  - Allow user to change and fix fields then confirm
  - Save and add new assignment or event to DB
- Aivana Chat features
  - Persistant chat drawer
  - Conversation history (?)
  - Live streaming response (?)
  - Need to confirm any changes that will effect DB (adding/moving/delete assignments or events)
- Ability to export info/data to an ics file and google calendar/outlook, etc.
