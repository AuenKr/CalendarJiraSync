### 1. Jira Task Status Management

- **Goal**: View and update the status of a linked Jira task directly from Google Calendar.
- **Locations**:
  - **Event Popup (Bubble)**: When clicking an event, if the title contains a Jira key (e.g., `[PROJ-123]`), inject a dropdown showing the current status.
  - **Edit Event Page**: Similar control available in the full-screen edit view.
- **Functionality**:
  - Display current status (e.g., "In Progress").
  - Allow changing status (transitioning the issue).
  - **Sorting**: In the task search results (autocomplete), prioritize tasks by status: `In Progress` > `To Do` > `Done`.
