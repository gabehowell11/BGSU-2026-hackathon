# Deadline

A desktop planner for students. Upload a syllabus, schedule, or photo of a handout and Deadline pulls out every due date, exam, and holiday for you to review. Track everything in a calendar or a sortable assignment list, and ask the built-in Aivana assistant to add, move, or complete items.

Built with Electron, Node.js, React, and SQLite.

## How to run the project

**Requirements:** Recent version of Node.js, and an Aivana API key.

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy .env.example to .env and set your key:

   ```
   AIVANA_API_KEY=your_aivana_api_key
   ```

3. Start the app in development mode:

   ```powershell
   npm run dev
   ```

Data is stored locally in student-task-manager.db in Electron's user data folder.
## Aivana features used

All Aivana calls go through the Electron main process at electron/aivana.js, React does not interact with the API calls.

- **AI Assistant Chatbot with Streaming**: Replies stream in live, using recent chat history and a snapshot of the planner. It has the ability to perform CRUD operations on the Database, but only after prompting the user.
- **Document and image extraction**: Syllabus, schedules, and photos of assignment handouts are turned into draft items with dates, times, and grade weights for you to review before saving.
- **Structured output and generation options**: Responses from Aivana include json formatting, temperature options, max token limits, and no web search, which means we get consistent outputs.
- **Usage tracking/Token considerations**: Tokens and credits from every response are tracked and displayed in the settings. PDFs and other text-based file formats are translated to plain text before being sent to the Aivana API to save maximum tokens.

## Known limitations

- **Answer size limit.** Aivana answers are capped at about 2,048 tokens, so long documents are split into parts and read separately. Very dense schedules can take several requests, and a part that still runs too long may be only partly read (the app shows a warning when this happens).
- **Upload limits.** At most 5 files and 40 MB per upload; 10 MB per PDF, Word, or CSV file and 8 MB per image.
- **Extraction accuracy.** Dates written as "Week 11 Friday" depend on the term dates being correct, and handwritten or low-quality photos may be misread. Always review drafts before confirming them.
- **Assistant context.** To save tokens, the assistant only sees overdue items, the last 7 days, the next 45 days, and undated to-dos (up to 80 items), and older chat messages are shortened. It may not know about items outside that window.
