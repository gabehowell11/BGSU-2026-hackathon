# AI Student Task Manager
## Who It's For
Students who need an easy way to track all of the important dates and assignments from their different classes.

## Core Functionality

### Features:
**Core:**
* Option to manually upload dates or assignments as a backup (without chatbot)
* Ability to upload files containing dates or assignment information and extract the info to be displayed (i.e. due dates, exams, holidays, etc.)
  * User MUST verify/confirm assignments and dates before saving
* Different ways to visualize upcoming dates and assignments:
  * Calendar view (by month, by week, or by day)
  * Assignment list, with status (not started/completed/etc.), a due date, a class section, priority?, notes?

**Standard:**
* AI Chat Bot/Agent to add/delete/modify assignments or dates, and more
  * Multi-line memory for back and forth conversation (advanced?)
  * "Stream" feature, live text response from Aivana

**Advanced:**
* Testing features (accuracy of AI, functional tests)
* Upload picture of paper assignment
* Export to external calendar apps

**Various Features**:
* Main "home" page which shows upcoming assignments/dates, and links

## Architecture
### Frontend: 
* React/html/css
### Backend: 
* Node.js with Electron
### Database: 
* SQLite - stored in Repository
