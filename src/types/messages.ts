import type { Issue, Project, Worklog } from 'jira.js/out/version3/models'

export interface UpdateIssueDescriptionPayload {
  issueKey: string
  description: string
}

export interface UpdateIssueDescriptionResponse {
  success: boolean
}

export interface GetIssuePayload {
  issueKey: string
}

export interface GetIssueResponse {
  issue: Issue
}

export type MessageType = 
  | 'SEARCH_ISSUES'
  | 'ADD_WORKLOG'
  | 'UPDATE_WORKLOG'
  | 'DELETE_WORKLOG'
  | 'GET_PROJECTS'
  | 'CREATE_ISSUE'
  | 'SYNC_DATA'
  | 'GET_STORED_ISSUES'
  | 'FETCH_CALENDAR_EVENTS'
  | 'GET_ISSUE'
  | 'UPDATE_ISSUE_DESCRIPTION'

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

export interface CreateIssuePayload {
  projectKey: string
  summary: string
  parentKey?: string
}

export interface MessageRequest {
  type: MessageType
  payload: 
    | SearchIssuesPayload 
    | AddWorklogPayload 
    | UpdateWorklogPayload 
    | DeleteWorklogPayload 
    | CreateIssuePayload 
    | UpdateIssueDescriptionPayload
    | GetIssuePayload
    | {}
}

export interface SearchIssuesResponse {
  issues: Issue[]
}

export type AddWorklogResponse = Worklog
export type UpdateWorklogResponse = Worklog
export type DeleteWorklogResponse = void

export type GetProjectsResponse = Project[]

export type CreateIssueResponse = Issue
