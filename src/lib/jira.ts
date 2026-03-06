import Fuse from 'fuse.js'
import type { Issue, Project, Transition, Worklog } from 'jira.js/out/version3/models'
import type {
  MessageType,
  SearchIssuesPayload,
  AddWorklogPayload,
  UpdateWorklogPayload,
  DeleteWorklogPayload,
  DeleteWorklogResponse,
  GetProjectsPayload,
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
import type { DomainSyncFailure, JiraIssueRef, SyncedIssueRecord } from '@/types/jira'
import { issueRefKey } from '@/lib/jiraLink'
import { normalizeJiraDomain } from '@/lib/jiraConfig'

export type JiraIssue = Issue
export type JiraProject = Project
export type JiraWorklog = Worklog
export type JiraTransition = Transition

export interface SearchResult {
  source: 'local' | 'api'
  issues: SyncedIssueRecord[]
}

export interface StoredIssuesResult {
  issues: SyncedIssueRecord[]
  lastSync?: string
  failedDomains?: DomainSyncFailure[]
}

export type SyncDataResult = SyncDataResponse

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

function recordKey(record: SyncedIssueRecord): string {
  const issueKey = record.issue.key || ''
  return `${normalizeJiraDomain(record.domain)}|${issueKey}`
}

function matchesRef(record: SyncedIssueRecord, ref: JiraIssueRef): boolean {
  return record.issue.key === ref.issueKey && normalizeJiraDomain(record.domain) === normalizeJiraDomain(ref.domain)
}

const TASK_CACHE_TTL_MS = 30 * 60 * 1000
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

const searchIssuesFromApi = async (
  query: string,
  linkedTaskRef: JiraIssueRef | null,
  linkedTask: SyncedIssueRecord[],
): Promise<SearchResult> => {
  const payload: SearchIssuesPayload = { query }
  const data = await sendToBackground<SearchIssuesResponse>('SEARCH_ISSUES', payload)

  let resolvedLinkedTask = linkedTask
  let apiIssues = data.issues || []

  if (resolvedLinkedTask.length === 0 && linkedTaskRef) {
    const foundInApi = apiIssues.find(i => matchesRef(i, linkedTaskRef))
    if (foundInApi) {
      resolvedLinkedTask = [foundInApi]
    }
  }

  if (linkedTaskRef) {
    apiIssues = apiIssues.filter(each => !matchesRef(each, linkedTaskRef))
  }

  const deduped = new Map<string, SyncedIssueRecord>()
  for (const item of [...resolvedLinkedTask, ...apiIssues]) {
    deduped.set(recordKey(item), item)
  }

  return {
    source: 'api',
    issues: Array.from(deduped.values()),
  }
}

export const searchIssues = async (query: string, linkedTaskRef: JiraIssueRef | null, forceApi = false): Promise<SearchResult> => {
  const stored = await sendToBackground<GetStoredIssuesResponse>('GET_STORED_ISSUES', {})

  let linkedTask: SyncedIssueRecord[] = []
  if (linkedTaskRef) {
    const found = (stored.issues || []).find(i => matchesRef(i, linkedTaskRef))
    if (found) {
      linkedTask = [found]
    }
  }

  if (!forceApi) {
    try {
      if (stored.issues && stored.issues.length > 0) {
        const fuse = new Fuse(stored.issues, {
          keys: ['issue.key', 'issue.fields.summary', 'domain'],
          threshold: 0.3,
          distance: 100,
        })

        const results = fuse.search(query)
        const searchResult = results
          .map(r => r.item)
          .filter(item => !linkedTaskRef || !matchesRef(item, linkedTaskRef))

        if (searchResult.length > 0) {
          const deduped = new Map<string, SyncedIssueRecord>()
          for (const item of [...linkedTask, ...searchResult]) {
            deduped.set(recordKey(item), item)
          }
          return { source: 'local', issues: Array.from(deduped.values()) }
        }
      }

      return await searchIssuesFromApi(query, linkedTaskRef, linkedTask)
    } catch (e) {
      console.warn('Local search failed', e)
      try {
        return await searchIssuesFromApi(query, linkedTaskRef, linkedTask)
      } catch (apiError) {
        console.warn('API search failed after local search failure', apiError)
        return { source: 'local', issues: linkedTask }
      }
    }
  }

  return await searchIssuesFromApi(query, linkedTaskRef, linkedTask)
}

export const syncData = async (): Promise<SyncDataResult> => {
  return await sendToBackground<SyncDataResult>('SYNC_DATA', {})
}

export const getStoredIssues = async (): Promise<StoredIssuesResult> => {
  const data = await sendToBackground<GetStoredIssuesResponse>('GET_STORED_ISSUES', {})
  return {
    issues: data.issues || [],
    lastSync: data.last_sync,
    failedDomains: data.failed_domains,
  }
}

export const addWorklog = async (
  issueRef: JiraIssueRef,
  timeSpentSeconds: number,
  started: string,
  comment?: string,
): Promise<JiraWorklog> => {
  const payload: AddWorklogPayload = { ...issueRef, timeSpentSeconds, started, comment }
  return await sendToBackground<AddWorklogResponse>('ADD_WORKLOG', payload)
}

export const updateWorklog = async (
  issueRef: JiraIssueRef,
  worklogId: string,
  timeSpentSeconds: number,
  started?: string,
  comment?: string,
): Promise<JiraWorklog> => {
  const payload: UpdateWorklogPayload = { ...issueRef, worklogId, timeSpentSeconds, started, comment }
  return await sendToBackground<UpdateWorklogResponse>('UPDATE_WORKLOG', payload)
}

export const deleteWorklog = async (issueRef: JiraIssueRef, worklogId: string): Promise<void> => {
  const payload: DeleteWorklogPayload = { ...issueRef, worklogId }
  return await sendToBackground<DeleteWorklogResponse>('DELETE_WORKLOG', payload)
}

export const getProjects = async (
  domain: string,
  credentials?: { email: string; apiToken: string },
): Promise<JiraProject[]> => {
  const payload: GetProjectsPayload = {
    domain,
    email: credentials?.email,
    apiToken: credentials?.apiToken,
  }
  const response = await sendToBackground<GetProjectsResponse>('GET_PROJECTS', payload)
  return response.projects || []
}

export const getIssue = async (issueRef: JiraIssueRef): Promise<JiraIssue> => {
  try {
    const stored = await sendToBackground<GetStoredIssuesResponse>('GET_STORED_ISSUES', {})
    const cachedIssue = (stored.issues || []).find(i => issueRefKey({
      domain: i.domain,
      issueKey: i.issue.key || '',
    }) === issueRefKey(issueRef))
    if (cachedIssue) {
      return cachedIssue.issue
    }
  } catch (e) {
    console.warn('Failed to check local cache for issue', e)
  }

  const payload: GetIssuePayload = issueRef
  const response = await sendToBackground<GetIssueResponse>('GET_ISSUE', payload)
  return response.issue
}

export const getTransitions = async (issueRef: JiraIssueRef): Promise<JiraTransition[]> => {
  const payload: GetTransitionsPayload = issueRef
  const response = await sendToBackground<GetTransitionsResponse>('GET_TRANSITIONS', payload)
  return response.transitions
}

export const transitionIssue = async (issueRef: JiraIssueRef, transitionId: string): Promise<void> => {
  const payload: TransitionIssuePayload = { ...issueRef, transitionId }
  await sendToBackground<TransitionIssueResponse>('TRANSITION_ISSUE', payload)
}

export const resetExtensionWorklogsByDate = async (date: string): Promise<ResetExtensionWorklogsByDateResponse> => {
  const payload: ResetExtensionWorklogsByDatePayload = { date }
  return await sendToBackground<ResetExtensionWorklogsByDateResponse>('RESET_EXTENSION_WORKLOGS_BY_DATE', payload)
}
