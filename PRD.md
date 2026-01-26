# Product Requirements Document: Jira Calendar Sync Extension

## 1. Overview

This browser extension aims to simplify time logging in Jira by syncing directly from Google Calendar. It addresses the friction of manual time logging by integrating it into the user's existing calendar workflow.

## 2. User Flows

### 2.1. Setup & Configuration

**Goal:** Authenticate user and configure Jira scope.

1. **Installation:** User installs the extension.
2. **Onboarding:** Upon first load, user is redirected to a setup page.
3. **Authentication:** User enters Jira Domain, Email, and API Token.
    - _Guidance:_ Provide links/instructions on how to generate a Jira API token.
4. **Scope Selection:**
    - Extension fetches available Jira projects/spaces.
    - User selects relevant projects to sync.
5. **Initial Sync:** Extension performs a background sync to cache tasks from selected projects for offline/fast access.

### 2.2. Linking Calendar Events to Jira Tasks

**Goal:** Associate a calendar event with a specific Jira issue.

1. **Event Creation/Edit:** User creates or opens an event in Google Calendar.
2. **Task Search:** User starts typing a task name/ID in the extension interface (injected into the event UI).
3. **Fuzzy Search:**
    - System searches local cache first for instant results.
    - If no match found, system queries Jira API.
4. **Selection:** User selects the matching Jira task.
5. **Link:** The calendar event is now linked to the Jira task.

### 2.3. Creating New Jira Tasks from Calendar

**Goal:** Create a Jira task on the fly if it doesn't exist.

1. **Search Fail:** User searches for a task but finds no match.
2. **Create Option:** System presents "Create new task" option.
3. **Task Details:**
    - User provides summary (pre-filled from search query).
    - User can select a parent task (Epic/Story) using the same fuzzy search mechanism.
    - User sets other required fields (Project, Issue Type).
4. **Creation:** Task is created in Jira and immediately linked to the current calendar event.

### 2.4. Time Logging & Sync

**Goal:** Automatically log worklogs based on calendar event duration.

1. **Event Update:** User updates the start/end time of a linked event.
2. **Sync Logic:**
    - **New Link:** Prompt user for "Estimated Time" if applicable (or use event duration).
    - **Update Duration:** Update the existing worklog in Jira to match new event duration.
    - **Delete Event:** Remove the corresponding worklog from Jira.
3. **Feedback:** Visual indication that sync is successful.

## 3. Technical Requirements

### 3.1. Tech Stack

- **Runtime:** Bun
- **Build Tool:** Vite
- **Frontend:** React + TypeScript
- **State Management:** Zustand (with persistence to local storage/chrome storage)
- **Data Fetching:** TanStack Query (React Query)
- **Validation:** Zod
- **Styling:** Tailwind CSS (inferred from `components/ui`)

### 3.2. Architecture

- **No Backend:** Pure client-side extension.
- **Security:** Jira API Key stored securely in browser storage (not sent to any third-party server).
- **Background Script:** Handles Jira API communication to avoid CORS issues and manage background syncing.
- **Content Script:** Injects UI into Google Calendar.
- **Caching:** Store fetched Jira tasks locally to enable fast fuzzy search.

## 4. Data Models

- **Config:** `jiraDomain`, `email`, `apiToken`, `selectedProjectKeys`.
- **Cache:** List of `JiraIssue` (id, key, summary, project).

## 5. Constraints & Assumptions

- User has a valid Jira account and permissions.
- Google Calendar UI structure remains relatively stable (for DOM injection).
