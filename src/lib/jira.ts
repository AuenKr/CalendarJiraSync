import Fuse from 'fuse.js'
import type { Issue, Project, Worklog, Transition } from 'jira.js/out/version3/models'
import type {
  MessageType,
  SearchIssuesPayload,
  AddWorklogPayload,
  UpdateWorklogPayload,
  DeleteWorklogPayload,
  CreateIssuePayload,
  SearchIssuesResponse,
  AddWorklogResponse,
  UpdateWorklogResponse,
  DeleteWorklogResponse,
  GetProjectsResponse,
  CreateIssueResponse,
  SyncDataResponse,
  GetStoredIssuesResponse,
  GetIssueResponse,
  GetIssuePayload,
  UpdateIssueDescriptionPayload,
  UpdateIssueDescriptionResponse,
  GetTransitionsPayload,
  GetTransitionsResponse,
  TransitionIssuePayload,
  TransitionIssueResponse,
} from '../types/messages'

// Re-export types for UI components
export type JiraIssue = Issue
export type JiraProject = Project
export type JiraWorklog = Worklog
export type JiraTransition = Transition

export interface SearchResult {
  source: 'local' | 'api'
  issues: JiraIssue[]
}

// Helper to send message to background script
const sendToBackground = async <T>(type: MessageType, payload: unknown): Promise<T> => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError)
      } else if (response && response.error) {
        reject(new Error(response.error))
      } else {
        resolve(response as T)
      }
    })
  })
}

const TTL = 30 * 60 * 1000; // 30 minutes

export const searchIssues = async (query: string, linkedTaskId: string | null, forceApi = false): Promise<SearchResult> => {
  const stored = await sendToBackground<GetStoredIssuesResponse>('GET_STORED_ISSUES', {})
  // GetLinkedTask
  let linkedTask: Issue[] = []
  if (linkedTaskId) {
    linkedTask = stored.issues.filter(i => i.key === linkedTaskId)
  }

  // First try to search locally
  if (!forceApi) {
    try {
      // Check TTL
      const lastSync = stored.last_sync ? new Date(stored.last_sync).getTime() : 0
      if (Date.now() - lastSync > TTL) {
        // Trigger background sync (fire and forget)
        sendToBackground('SYNC_DATA', {})
      }

      if (stored.issues && stored.issues.length > 0) {
        const fuse = new Fuse(stored.issues, {
          keys: ['key', 'fields.summary'],
          threshold: 0.3,
          distance: 100,
        })

        const results = fuse.search(query)
        if (results.length > 0) {
          return { source: 'local', issues: [...linkedTask, ...results.map(r => r.item)] }
        }
      }
    } catch (e) {
      console.warn('Local search failed, falling back to API', e)
    }
  }

  // Fallback to API
  const payload: SearchIssuesPayload = { query }
  const data = await sendToBackground<SearchIssuesResponse>('SEARCH_ISSUES', payload)
  return { source: 'api', issues: [...linkedTask, ...data.issues] }
}

export const syncData = async (): Promise<SyncDataResponse> => {
  return await sendToBackground<SyncDataResponse>('SYNC_DATA', {})
}

export const addWorklog = async (issueKey: string, timeSpentSeconds: number, started: string, comment?: string): Promise<JiraWorklog> => {
  const payload: AddWorklogPayload = { issueKey, timeSpentSeconds, started, comment }
  return await sendToBackground<AddWorklogResponse>('ADD_WORKLOG', payload)
}

export const updateWorklog = async (issueKey: string, worklogId: string, timeSpentSeconds: number, started?: string, comment?: string): Promise<JiraWorklog> => {
  const payload: UpdateWorklogPayload = { issueKey, worklogId, timeSpentSeconds, started, comment }
  return await sendToBackground<UpdateWorklogResponse>('UPDATE_WORKLOG', payload)
}

export const deleteWorklog = async (issueKey: string, worklogId: string): Promise<void> => {
  const payload: DeleteWorklogPayload = { issueKey, worklogId }
  return await sendToBackground<DeleteWorklogResponse>('DELETE_WORKLOG', payload)
}

export const getProjects = async (): Promise<JiraProject[]> => {
  return await sendToBackground<GetProjectsResponse>('GET_PROJECTS', {})
}

export const createIssue = async (projectKey: string, summary: string, parentKey?: string): Promise<JiraIssue> => {
  const payload: CreateIssuePayload = { projectKey, summary, parentKey }
  return await sendToBackground<CreateIssueResponse>('CREATE_ISSUE', payload)
}

export const getIssue = async (issueKey: string): Promise<JiraIssue> => {
  // Try to find in local cache first
  try {
    const stored = await sendToBackground<GetStoredIssuesResponse>('GET_STORED_ISSUES', {})
    const cachedIssue = stored.issues.find(i => i.key === issueKey)
    if (cachedIssue) {
      // console.log('[Jira Sync] Found issue in local cache', issueKey)
      return cachedIssue
    }
  } catch (e) {
    console.warn('Failed to check local cache for issue', e)
  }

  const payload: GetIssuePayload = { issueKey }
  const response = await sendToBackground<GetIssueResponse>('GET_ISSUE', payload)
  return response.issue
}

export const updateIssueDescription = async (issueKey: string, description: string): Promise<void> => {
  const payload: UpdateIssueDescriptionPayload = { issueKey, description }
  await sendToBackground<UpdateIssueDescriptionResponse>('UPDATE_ISSUE_DESCRIPTION', payload)
}

export const getTransitions = async (issueKey: string): Promise<JiraTransition[]> => {
  const payload: GetTransitionsPayload = { issueKey }
  const response = await sendToBackground<GetTransitionsResponse>('GET_TRANSITIONS', payload)
  return response.transitions
}

export const transitionIssue = async (issueKey: string, transitionId: string): Promise<void> => {
  const payload: TransitionIssuePayload = { issueKey, transitionId }
  await sendToBackground<TransitionIssueResponse>('TRANSITION_ISSUE', payload)
}
