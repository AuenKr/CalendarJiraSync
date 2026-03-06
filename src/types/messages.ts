import type { Issue, Project, Transition, Worklog } from 'jira.js/out/version3/models'
import type { DomainSyncFailure, JiraIssueRef, SyncedIssueRecord } from '@/types/jira'

export type GetIssuePayload = JiraIssueRef

export interface GetIssueResponse {
  issue: Issue
}

export type GetTransitionsPayload = JiraIssueRef

export interface GetTransitionsResponse {
  transitions: Transition[]
}

export interface TransitionIssuePayload extends JiraIssueRef {
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
  failedDomains?: DomainSyncFailure[]
}

export interface GetProjectsPayload {
  domain: string
  email?: string
  apiToken?: string
}

export interface GetProjectsResponse {
  domain: string
  projects: Project[]
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
  date?: string
}

export interface SyncDataResponse {
  success: boolean
  count: number
  failedDomains?: DomainSyncFailure[]
}

export interface GetStoredIssuesResponse {
  issues: SyncedIssueRecord[]
  last_sync?: string
  failed_domains?: DomainSyncFailure[]
}

export interface SearchIssuesPayload {
  query: string
  domain?: string
}

export interface AddWorklogPayload extends JiraIssueRef {
  timeSpentSeconds: number
  started: string
  comment?: string
}

export interface UpdateWorklogPayload extends JiraIssueRef {
  worklogId: string
  timeSpentSeconds: number
  started?: string
  comment?: string
}

export interface DeleteWorklogPayload extends JiraIssueRef {
  worklogId: string
}

export interface MessageRequest {
  type: MessageType
  payload:
    | SearchIssuesPayload
    | AddWorklogPayload
    | UpdateWorklogPayload
    | DeleteWorklogPayload
    | GetProjectsPayload
    | GetIssuePayload
    | GetTransitionsPayload
    | TransitionIssuePayload
    | ResetExtensionWorklogsByDatePayload
    | Record<string, never>
}

export interface SearchIssuesResponse {
  issues: SyncedIssueRecord[]
}

export type AddWorklogResponse = Worklog
export type UpdateWorklogResponse = Worklog
export type DeleteWorklogResponse = void
