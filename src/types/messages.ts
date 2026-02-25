import type { Issue, Project, Worklog, Transition } from 'jira.js/out/version3/models'

export interface GetIssuePayload {
  issueKey: string
}

export interface GetIssueResponse {
  issue: Issue
}

export interface GetTransitionsPayload {
  issueKey: string
}

export interface GetTransitionsResponse {
  transitions: Transition[]
}

export interface TransitionIssuePayload {
  issueKey: string
  transitionId: string
}

export interface TransitionIssueResponse {
  success: boolean
}

export interface ResetExtensionWorklogsByDatePayload {
  date: string
}

export interface ResetExtensionWorklogsByDateResponse {
  deletedCount: number
  matchedCount: number
  scannedIssues: number
}

export type MessageType = 
  | 'SEARCH_ISSUES'
  | 'ADD_WORKLOG'
  | 'UPDATE_WORKLOG'
  | 'DELETE_WORKLOG'
  | 'GET_PROJECTS'
  | 'SYNC_DATA'
  | 'GET_STORED_ISSUES'
  | 'FETCH_CALENDAR_EVENTS'
  | 'GET_ISSUE'
  | 'GET_TRANSITIONS'
  | 'TRANSITION_ISSUE'
  | 'RESET_EXTENSION_WORKLOGS_BY_DATE'

export interface CalendarEvent {
  id?: string
  title: string
  startTime: string
  endTime: string
  description?: string
}

export interface FetchCalendarEventsResponse {
  events: CalendarEvent[]
  date?: string // Today's date if detected
}


export interface SyncDataResponse {
  success: boolean
  count: number
}

export interface GetStoredIssuesResponse {
  issues: Issue[]
  last_sync?: string
}

export interface SearchIssuesPayload {
  query: string
}

export interface AddWorklogPayload {
  issueKey: string
  timeSpentSeconds: number
  started: string
  comment?: string
}

export interface UpdateWorklogPayload {
  issueKey: string
  worklogId: string
  timeSpentSeconds: number
  started?: string
  comment?: string
}

export interface DeleteWorklogPayload {
  issueKey: string
  worklogId: string
}

export interface MessageRequest {
  type: MessageType
  payload: 
    | SearchIssuesPayload 
    | AddWorklogPayload 
    | UpdateWorklogPayload 
    | DeleteWorklogPayload 
    | GetIssuePayload
    | GetTransitionsPayload
    | TransitionIssuePayload
    | ResetExtensionWorklogsByDatePayload
    | Record<string, never>
}

export interface SearchIssuesResponse {
  issues: Issue[]
}

export type AddWorklogResponse = Worklog
export type UpdateWorklogResponse = Worklog
export type DeleteWorklogResponse = void

export type GetProjectsResponse = Project[]
