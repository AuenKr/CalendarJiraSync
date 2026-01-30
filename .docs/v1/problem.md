# Problem

Jira Calendar Sync

Why?
Because logging time in Jira sucks.

Why do I have to log time in the first place?

- Because it helps me to track my own metrics, and increase my accuracy of estimates in logger terms.
- Reality check.
- Helps me during reflection.

Why did I choose google calendar for syncing?
I have to check it for seeing, scheduling, etc. Cannot be avoided I think.

Why sync time from calendar only?
Calendar UI is way better for organizing my time.

# My Opinionated Solution

Build an extension:
User flows:

1. While creating the calendar, users can link the tasks of jira from those tasks.(fuzzy search result while typing from cache value and an api call if no task in found related to that to jira for finding task)
2. While creating a task, if no such task matches in the jira task list, it shows the option to create task along with attaching parent(same as fuzzy search result) and other related things that can be added while creating task.
3. While updating the task, the work log period should be sync(delete event should delete task, updating event should update prev work log time, and so on)
4. While attaching the event(for the first time), he should ask for an estimated time expectantly.

Other flow
Setup flow: 5. When the user loads the extension, it redirects to a setup page, where user setup jira with their api key. The page contains how to setup the extension(like links for getting jira api key, etc).
When the user add their config values. Fetch the spaces from jira. Show them to user. Ask user to selected spaces from jira. And after he selected then in background, run the process to get all the tasks related to those spaces. Which will be used later while later as cache while the user try to link the calendar event to the Jira task

Technical Requirements:
Frontend should be in typescript and react(why because i only know that)
State management: Zustand(with all data fetched from jira to local-storage for cache)
Input Type Checking: Zod
There will be no backend. All requests happen from frontend(The jira api key is stored in some secure storage not backend).
Use bun runtime instead of node.
Along with vite
Always use tanstack react query

Use the frontend skill you have for building the UI

# Implementation Tasks

## Setup & Configuration
- [x] **Setup Page UI**: Create a user-friendly setup page for entering Jira credentials. (Status: Completed)
- [x] **Credential Storage**: Securely store Jira Domain, Email, and API Token. (Status: Completed)
- [x] **Project Fetching**: Fetch available Jira projects/spaces after credentials are set. (Status: Completed)
- [x] **Project Selection**: Allow user to select which projects to sync. (Status: Completed)
- [x] **Initial Background Sync**: Fetch and cache tasks from selected projects. (Status: Completed)

## Core Features
- [x] **Calendar UI Injection**: Inject extension UI into Google Calendar event creation/edit modal. (Status: Completed)
- [x] **Task Linking (Fuzzy Search)**: Implement search bar with local cache + API fallback. (Status: Completed)
- [x] **Task Creation**: UI to create a new Jira task directly from Calendar. (Status: Completed)
- [x] **Worklog Sync**:
    - [x] Create worklog on event creation. (Status: Completed - Manual trigger with auto-fill)
    - [x] Update worklog on event resize/move. (Status: Completed - Via "Update Worklog" button which reads new time)
    - [x] Delete worklog on event deletion. (Status: Completed - Intercepts GCal delete button)
- [x] **Estimated Time Prompt**: Ask for estimated time when linking a task for the first time. (Status: Completed)

## Infrastructure
- [x] **Background Script**: Handle API requests and background syncing. (Status: Completed)
- [x] **State Management**: Zustand store setup. (Status: Completed)
- [x] **Jira API Client**: Helper functions for Jira API interaction. (Status: Completed)
