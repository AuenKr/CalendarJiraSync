# Calendar Jira Sync V2

## New features

### 1. Smart Work Log Filtering (Prevent Duplicates)

- **Concept**: Maintain a `lastLoggedTime` pointer for each day (or globally) to ensure we never double-log or log incomplete events.
- **Per-Day History**: Store `lastLoggedTime` specifically for each calendar date (LRU Cache of ~30 days) to allow safe back-filling of previous days if they weren't synced yet, while preventing duplicates on already synced days.
- **Rules**:
  1. **Completed Events Only**: An event is only considered for logging if `Current Time` > `Event End Time`. Events currently in progress are ignored until the next sync when they are finished.
  2. **Strict Cutoff**:
     - Only process events that end **after** the `lastLoggedTime`.
     - Events ending **before** `lastLoggedTime` are strictly ignored, even if edited.
     - _Note_: This means edits to past (already synced) events are not reflected in Jira worklogs for now.
  3. **Day Boundary**:
     - If syncing for "Today" (and `lastLoggedTime` was "Yesterday"), filter events ending between `Start of Today` and `Current Time`.
     - If syncing again "Today", filter events ending between `lastLoggedTime` (e.g., 2:00 PM) and `Current Time` (e.g., 5:00 PM).

### 2. Work Log Content

- **Format**: Instead of appending to the Jira Task Description, add details to the **Worklog Comment**:
  - Content: `[Event Title] \n[Date]\n[Start Time] - [End Time]\n[Event Description]`
  - This keeps the main task description clean.

### 3. Setup Experience Improvements

- **Smart URL Handling**:
  - Allow flexible inputs for Jira Domain: `company`, `company.atlassian.net`, `https://company.atlassian.net/`, `www.company...`.
  - Auto-suggestion in ui(in dropdown menu) to: `company.atlassian.net`.
  - If user select the suggestion it value get added to the input box

### 4. Jira Task Status Management

- **Goal**: View and update the status of a linked Jira task directly from Google Calendar.
- **Locations**:
  - **Event Popup (Bubble)**: When clicking an event, if the title contains a Jira key (e.g., `[PROJ-123]`), inject a dropdown showing the current status.
  - **Edit Event Page**: Similar control available in the full-screen edit view.
- **Functionality**:
  - Display current status (e.g., "In Progress").
  - Allow changing status (transitioning the issue).
  - **Sorting**: In the task search results (autocomplete), prioritize tasks by status: `In Progress` > `To Do` > `Done`.

## Bugs to Fix

- **Reload Focus Issue**:
  - **Scenario**: Reload page -> Click empty slot -> Popup opens -> Focus is on Title input.
  - **Issue**: Typing does not trigger the Jira autocomplete.
  - **Fix**: Ensure the content script correctly re-attaches listeners to the active input element even after page reloads/dynamic navigation.

- **Linked Task Visibility**:
  - **Issue**: If an event is already linked to a Jira task (title contains `[KEY-123]`), that task might not appear in the search results if it's not in the local cache or if the search query doesn't rank it high.
  - **Fix**: Ensure the currently linked issue is always fetched and displayed at the top of the search results, even if the search query is empty or unrelated.
