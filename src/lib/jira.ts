import Fuse from 'fuse.js'
import type { Issue, Project, Worklog, Transition } from 'jira.js/out/version3/models'
import type {
  MessageType,
  SearchIssuesPayload,
  AddWorklogPayload,
  UpdateWorklogPayload,
  DeleteWorklogPayload,
  DeleteWorklogResponse,
  GetProjectsResponse,
  SyncDataResponse,
  SearchIssuesResponse,
  AddWorklogResponse,
  UpdateWorklogResponse,
  GetStoredIssuesResponse,
  GetIssueResponse,
  GetIssuePayload,
  GetTransitionsPayload,
  GetTransitionsResponse,
  TransitionIssuePayload,
  TransitionIssueResponse,
  ResetExtensionWorklogsByDatePayload,
  ResetExtensionWorklogsByDateResponse,
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

export interface StoredIssuesResult {
  issues: JiraIssue[]
  lastSync?: string
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

const TASK_CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes
let inFlightTaskCacheRefresh: Promise<SyncDataResponse> | null = null

export function isTaskCacheStale(lastSync?: string): boolean {
  if (!lastSync) return true

  const lastSyncMs = new Date(lastSync).getTime()
  if (!Number.isFinite(lastSyncMs)) return true

  const staleMs = Date.now() - lastSyncMs
  return staleMs > TASK_CACHE_TTL_MS
}

export async function refreshTaskCacheIfStale(lastSync?: string, force = false): Promise<SyncDataResponse | null> {
  if (!force && !isTaskCacheStale(lastSync)) {
    return null
  }

  if (!inFlightTaskCacheRefresh) {
    inFlightTaskCacheRefresh = sendToBackground<SyncDataResponse>('SYNC_DATA', {})
      .finally(() => {
        inFlightTaskCacheRefresh = null
      })
  }

  return await inFlightTaskCacheRefresh
}

const searchIssuesFromApi = async (query: string, linkedTaskId: string | null, linkedTask: Issue[]): Promise<SearchResult> => {
  const payload: SearchIssuesPayload = { query }
  const data = await sendToBackground<SearchIssuesResponse>('SEARCH_ISSUES', payload)

  let resolvedLinkedTask = linkedTask
  let apiIssues = data.issues
  if (resolvedLinkedTask.length === 0 && linkedTaskId) {
    const foundInApi = apiIssues.find(i => i.key === linkedTaskId)
    if (foundInApi) {
      resolvedLinkedTask = [foundInApi]
    }
  }

  // Filter linked task out of API results so we don't show it twice
  apiIssues = apiIssues.filter(each => each.key !== linkedTaskId)
  return {
    source: 'api',
    issues: [...resolvedLinkedTask, ...apiIssues],
  }
}

export const searchIssues = async (query: string, linkedTaskId: string | null, forceApi = false): Promise<SearchResult> => {
  const stored = await sendToBackground<GetStoredIssuesResponse>('GET_STORED_ISSUES', {})
  // GetLinkedTask
  let linkedTask: Issue[] = []
  if (linkedTaskId) {
    const found = stored.issues.find(i => i.key === linkedTaskId)
    if (found) {
      linkedTask = [found]
    }
  }

  // Search local cache first unless explicitly forcing API search
  if (!forceApi) {
    try {
      if (stored.issues && stored.issues.length > 0) {
        const fuse = new Fuse(stored.issues, {
          keys: ['key', 'fields.summary'],
          threshold: 0.3,
          distance: 100,
        })

        const results = fuse.search(query)
        const searchResult = results
          .map(r => r.item)
          .filter(item => item.key !== linkedTaskId)
        if (searchResult.length > 0) {
          return { source: 'local', issues: [...linkedTask, ...searchResult] }
        }
      }

      // No local match: automatically fallback to Jira API search.
      return await searchIssuesFromApi(query, linkedTaskId, linkedTask)
    } catch (e) {
      console.warn('Local search failed', e)
      try {
        return await searchIssuesFromApi(query, linkedTaskId, linkedTask)
      } catch (apiError) {
        console.warn('API search failed after local search failure', apiError)
        return { source: 'local', issues: linkedTask }
      }
    }
  }

  return await searchIssuesFromApi(query, linkedTaskId, linkedTask)
}

export const syncData = async (): Promise<SyncDataResponse> => {
  return await sendToBackground<SyncDataResponse>('SYNC_DATA', {})
}

export const getStoredIssues = async (): Promise<StoredIssuesResult> => {
  const data = await sendToBackground<GetStoredIssuesResponse>('GET_STORED_ISSUES', {})
  return {
    issues: data.issues || [],
    lastSync: data.last_sync,
  }
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

export const getTransitions = async (issueKey: string): Promise<JiraTransition[]> => {
  const payload: GetTransitionsPayload = { issueKey }
  const response = await sendToBackground<GetTransitionsResponse>('GET_TRANSITIONS', payload)
  return response.transitions
}

export const transitionIssue = async (issueKey: string, transitionId: string): Promise<void> => {
  const payload: TransitionIssuePayload = { issueKey, transitionId }
  await sendToBackground<TransitionIssueResponse>('TRANSITION_ISSUE', payload)
}

export const resetExtensionWorklogsByDate = async (date: string): Promise<ResetExtensionWorklogsByDateResponse> => {
  const payload: ResetExtensionWorklogsByDatePayload = { date }
  return await sendToBackground<ResetExtensionWorklogsByDateResponse>('RESET_EXTENSION_WORKLOGS_BY_DATE', payload)
}
