import { Version3Client } from 'jira.js'
import type { Issue, Project, SearchResults, Worklog } from 'jira.js/out/version3/models'
import type {
  MessageRequest,
  SearchIssuesPayload,
  AddWorklogPayload,
  UpdateWorklogPayload,
  DeleteWorklogPayload,
  GetIssuePayload,
  GetTransitionsPayload,
  TransitionIssuePayload,
  ResetExtensionWorklogsByDatePayload,
  GetProjectsPayload,
  SyncDataResponse,
} from '../types/messages'
import type { DomainSyncFailure, JiraDomainConfig, JiraIssueRef, SyncedIssueRecord } from '@/types/jira'
import { parseExtensionMetadataFromComment } from '../lib/worklogMetadata'
import { normalizeJiraDomain, parseJiraConfig } from '@/lib/jiraConfig'

interface EnhancedSearchResults extends SearchResults {
  nextPageToken?: string
  isLast?: boolean
}

interface JiraRuntimeConfig {
  email: string
  apiToken: string
  jiraDomains: JiraDomainConfig[]
}

async function getConfig(): Promise<JiraRuntimeConfig> {
  const storage = await chrome.storage.local.get('jira-sync-config')
  const raw = storage['jira-sync-config']

  if (!raw) {
    throw new Error('Jira credentials not configured')
  }

  try {
    const parsed = typeof raw === 'string'
      ? parseJiraConfig(JSON.parse(raw))
      : parseJiraConfig(raw)

    return {
      email: parsed.email,
      apiToken: parsed.apiToken,
      jiraDomains: parsed.jiraDomains,
    }
  } catch {
    throw new Error('Invalid Jira config format')
  }
}

function validateConfiguredDomains(config: JiraRuntimeConfig) {
  if (!config.email || !config.apiToken) {
    throw new Error('Missing Jira credentials')
  }

  if (!config.jiraDomains.length) {
    throw new Error('Missing Jira domains configuration')
  }
}

function getDomainConfig(config: JiraRuntimeConfig, domain: string): JiraDomainConfig {
  const normalizedDomain = normalizeJiraDomain(domain)
  if (!normalizedDomain) {
    throw new Error('Invalid Jira domain')
  }

  const found = config.jiraDomains.find(each => each.domain === normalizedDomain)
  if (!found) {
    throw new Error(`Linked Jira domain is not configured: ${normalizedDomain}`)
  }

  return found
}

function getClient(config: JiraRuntimeConfig, domain: string): Version3Client {
  const normalizedDomain = normalizeJiraDomain(domain)
  if (!normalizedDomain) {
    throw new Error('Invalid Jira domain')
  }

  return new Version3Client({
    host: `https://${normalizedDomain}`,
    authentication: {
      basic: { email: config.email, apiToken: config.apiToken },
    },
    baseRequestConfig: {
      adapter: 'fetch',
    },
  })
}

function issueRecordKey(record: SyncedIssueRecord): string {
  return `${normalizeJiraDomain(record.domain)}|${record.issue.key || ''}`
}

function normalizeStoredIssueRecords(raw: unknown, config: JiraRuntimeConfig): SyncedIssueRecord[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const deduped = new Map<string, SyncedIssueRecord>()
  const configuredDomains = config.jiraDomains.map(each => each.domain)
  const fallbackDomain = configuredDomains.length === 1 ? configuredDomains[0] : null

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const typed = item as Record<string, unknown>

    if (typed.issue && typeof typed.issue === 'object' && typeof typed.domain === 'string') {
      const domain = normalizeJiraDomain(typed.domain)
      if (!domain || !configuredDomains.includes(domain)) continue

      const issue = typed.issue as Issue
      if (!issue?.key) continue

      const record: SyncedIssueRecord = { domain, issue }
      deduped.set(issueRecordKey(record), record)
      continue
    }

    if (fallbackDomain && typeof typed.key === 'string') {
      const legacyIssue = typed as unknown as Issue
      const record: SyncedIssueRecord = {
        domain: fallbackDomain,
        issue: legacyIssue,
      }
      deduped.set(issueRecordKey(record), record)
    }
  }

  return Array.from(deduped.values())
}

async function searchIssuesWithPagination(
  client: Version3Client,
  jql: string,
  fields: string[],
  maxResults = 100,
): Promise<Issue[]> {
  let issues: Issue[] = []
  let nextPageToken: string | undefined = undefined
  let isLast = false

  do {
    const res = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
      jql,
      fields,
      maxResults,
      nextPageToken,
    }) as EnhancedSearchResults

    if (res.issues) {
      issues = [...issues, ...res.issues]
    }

    nextPageToken = res.nextPageToken
    isLast = res.isLast ?? (res.issues ? res.issues.length < maxResults : true)
  } while (!isLast && nextPageToken)

  return issues
}

async function syncDomain(domainConfig: JiraDomainConfig, config: JiraRuntimeConfig): Promise<SyncedIssueRecord[]> {
  const client = getClient(config, domainConfig.domain)
  const myself = await client.myself.getCurrentUser()
  const selectedProjectKeys = domainConfig.selectedProjectKeys || []

  let jql = `assignee = "${myself.accountId}" AND updated >= -30d ORDER BY updated DESC`
  if (selectedProjectKeys.length) {
    const projectList = selectedProjectKeys.map(key => `"${key}"`).join(',')
    jql = `(assignee = "${myself.accountId}" OR (project in (${projectList}) AND assignee is EMPTY)) AND updated >= -30d ORDER BY updated DESC`
  }

  const issues = await searchIssuesWithPagination(
    client,
    jql,
    ['summary', 'parent', 'status', 'project'],
    100,
  )

  return issues
    .filter(issue => !!issue.key)
    .map(issue => ({
      domain: domainConfig.domain,
      issue,
    }))
}

async function syncData(): Promise<SyncDataResponse> {
  const config = await getConfig()
  validateConfiguredDomains(config)

  const settled = await Promise.allSettled(
    config.jiraDomains.map(domainConfig => syncDomain(domainConfig, config)),
  )

  const syncedRecords: SyncedIssueRecord[] = []
  const failedDomains: DomainSyncFailure[] = []

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    const domain = config.jiraDomains[i].domain

    if (result.status === 'fulfilled') {
      syncedRecords.push(...result.value)
      continue
    }

    failedDomains.push({
      domain,
      error: result.reason instanceof Error ? result.reason.message : 'Unknown sync error',
    })
  }

  const deduped = new Map<string, SyncedIssueRecord>()
  for (const record of syncedRecords) {
    deduped.set(issueRecordKey(record), record)
  }

  const issues = Array.from(deduped.values())
  await chrome.storage.local.set({
    synced_issues: issues,
    last_sync: new Date().toISOString(),
    failed_domains: failedDomains,
  })

  return {
    success: failedDomains.length === 0 || issues.length > 0,
    count: issues.length,
    failedDomains,
  }
}

function getDayRangeMs(date: string): { dayStartMs: number, dayEndMs: number } {
  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59.999`)
  return {
    dayStartMs: dayStart.getTime(),
    dayEndMs: dayEnd.getTime(),
  }
}

async function findIssueKeysWithWorklogsOnDate(client: Version3Client, date: string): Promise<string[]> {
  const issueKeys = new Set<string>()
  const jql = `worklogDate = "${date}" AND worklogAuthor = currentUser() ORDER BY updated DESC`

  const issues = await searchIssuesWithPagination(client, jql, ['key'], 100)
  for (const issue of issues) {
    if (issue.key) issueKeys.add(issue.key)
  }

  return Array.from(issueKeys)
}

async function getIssueWorklogsInRange(
  client: Version3Client,
  issueKey: string,
  dayStartMs: number,
  dayEndMs: number,
): Promise<Worklog[]> {
  const worklogs: Worklog[] = []
  let startAt = 0
  const maxResults = 100

  while (true) {
    const page = await client.issueWorklogs.getIssueWorklog({
      issueIdOrKey: issueKey,
      startAt,
      maxResults,
      startedAfter: dayStartMs - 1,
      startedBefore: dayEndMs + 1,
    })

    const batch = page.worklogs || []
    worklogs.push(...batch)

    if (batch.length === 0 || startAt + batch.length >= page.total) {
      break
    }
    startAt += batch.length
  }

  return worklogs
}

async function resetWorklogsForDomain(
  config: JiraRuntimeConfig,
  domainConfig: JiraDomainConfig,
  date: string,
): Promise<{ deletedCount: number; matchedCount: number; scannedIssues: number }> {
  const client = getClient(config, domainConfig.domain)
  const { dayStartMs, dayEndMs } = getDayRangeMs(date)
  const issueKeys = await findIssueKeysWithWorklogsOnDate(client, date)

  let matchedCount = 0
  let deletedCount = 0

  for (const issueKey of issueKeys) {
    const issueWorklogs = await getIssueWorklogsInRange(client, issueKey, dayStartMs, dayEndMs)

    for (const worklog of issueWorklogs) {
      const meta = parseExtensionMetadataFromComment(worklog.comment)
      if (!meta || meta.date !== date) continue

      matchedCount++
      if (!worklog.id) continue

      try {
        await client.issueWorklogs.deleteWorklog({
          issueIdOrKey: issueKey,
          id: worklog.id,
        })
        deletedCount++
      } catch (e) {
        console.error(`[Jira Sync] Failed to delete worklog ${worklog.id} on ${domainConfig.domain}/${issueKey}`, e)
      }
    }
  }

  return {
    deletedCount,
    matchedCount,
    scannedIssues: issueKeys.length,
  }
}

function getClientFromRef(config: JiraRuntimeConfig, ref: JiraIssueRef): Version3Client {
  getDomainConfig(config, ref.domain)
  return getClient(config, ref.domain)
}

async function getStoredIssuesWithConfig(config: JiraRuntimeConfig): Promise<SyncedIssueRecord[]> {
  const data = await chrome.storage.local.get('synced_issues')
  return normalizeStoredIssueRecords(data.synced_issues, config)
}

async function handleMessage(request: MessageRequest) {
  const { type, payload } = request

  switch (type) {
    case 'SEARCH_ISSUES': {
      const config = await getConfig()
      validateConfiguredDomains(config)
      const { query, domain } = payload as SearchIssuesPayload

      const targetDomains = domain
        ? [getDomainConfig(config, domain)]
        : config.jiraDomains

      const isKey = /^[A-Z][A-Z0-9]+-\d+$/.test(query)
      const jql = isKey
        ? `(summary ~ "${query}" OR key = "${query}") ORDER BY updated DESC`
        : `summary ~ "${query}" ORDER BY updated DESC`

      const settled = await Promise.allSettled(
        targetDomains.map(async (domainConfig) => {
          const client = getClient(config, domainConfig.domain)
          const issues = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
            jql,
            fields: ['summary', 'parent', 'status', 'project'],
            maxResults: 100,
          })

          return (issues.issues || [])
            .filter(issue => !!issue.key)
            .map(issue => ({
              domain: domainConfig.domain,
              issue,
            }))
        }),
      )

      const records = new Map<string, SyncedIssueRecord>()
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue
        for (const issue of result.value) {
          records.set(issueRecordKey(issue), issue)
        }
      }

      return { issues: Array.from(records.values()) }
    }

    case 'ADD_WORKLOG': {
      const config = await getConfig()
      const { domain, issueKey, timeSpentSeconds, started, comment } = payload as AddWorklogPayload
      const client = getClientFromRef(config, { domain, issueKey })

      return client.issueWorklogs.addWorklog({
        issueIdOrKey: issueKey,
        timeSpentSeconds,
        started,
        comment: comment
          ? {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: comment }],
              },
            ],
          }
          : undefined,
      })
    }

    case 'UPDATE_WORKLOG': {
      const config = await getConfig()
      const { domain, issueKey, worklogId, timeSpentSeconds, started, comment } = payload as UpdateWorklogPayload
      const client = getClientFromRef(config, { domain, issueKey })

      return client.issueWorklogs.updateWorklog({
        issueIdOrKey: issueKey,
        id: worklogId,
        timeSpentSeconds,
        started,
        comment: comment
          ? {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: comment }],
              },
            ],
          }
          : undefined,
      })
    }

    case 'DELETE_WORKLOG': {
      const config = await getConfig()
      const { domain, issueKey, worklogId } = payload as DeleteWorklogPayload
      const client = getClientFromRef(config, { domain, issueKey })

      return client.issueWorklogs.deleteWorklog({
        issueIdOrKey: issueKey,
        id: worklogId,
      })
    }

    case 'GET_PROJECTS': {
      const { domain, email, apiToken } = payload as GetProjectsPayload
      let config: JiraRuntimeConfig
      try {
        config = await getConfig()
      } catch (e) {
        if (!(email && apiToken)) {
          throw e
        }
        config = {
          email,
          apiToken,
          jiraDomains: [],
        }
      }

      const normalizedDomain = normalizeJiraDomain(domain)
      if (!normalizedDomain) {
        throw new Error('Invalid Jira domain')
      }

      const hasOverrideCredentials = !!(email && apiToken)
      const client = hasOverrideCredentials
        ? new Version3Client({
          host: `https://${normalizedDomain}`,
          authentication: {
            basic: { email: email!, apiToken: apiToken! },
          },
          baseRequestConfig: {
            adapter: 'fetch',
          },
        })
        : (() => {
          validateConfiguredDomains(config)
          const domainConfig = getDomainConfig(config, normalizedDomain)
          return getClient(config, domainConfig.domain)
        })()

      let allProjects: Project[] = []
      let isLast = false
      let startAt = 0
      const maxResults = 50

      while (!isLast) {
        const res = await client.projects.searchProjects({
          startAt,
          maxResults,
        })

        if (res.values) {
          allProjects = [...allProjects, ...res.values]
        }

        isLast = res.isLast || false
        if (!isLast) {
          startAt += maxResults
        }
      }

      return {
        domain: normalizedDomain,
        projects: allProjects,
      }
    }

    case 'GET_ISSUE': {
      const config = await getConfig()
      const { domain, issueKey } = payload as GetIssuePayload
      const client = getClientFromRef(config, { domain, issueKey })
      const issue = await client.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ['description', 'status', 'summary', 'project'],
      })
      return { issue }
    }

    case 'GET_TRANSITIONS': {
      const config = await getConfig()
      const { domain, issueKey } = payload as GetTransitionsPayload
      const client = getClientFromRef(config, { domain, issueKey })
      const response = await client.issues.getTransitions({
        issueIdOrKey: issueKey,
      })
      return { transitions: response.transitions || [] }
    }

    case 'TRANSITION_ISSUE': {
      const config = await getConfig()
      const { domain, issueKey, transitionId } = payload as TransitionIssuePayload
      const client = getClientFromRef(config, { domain, issueKey })

      await client.issues.doTransition({
        issueIdOrKey: issueKey,
        transition: { id: transitionId },
      })

      try {
        const updatedIssue = await client.issues.getIssue({
          issueIdOrKey: issueKey,
          fields: ['summary', 'parent', 'status', 'project'],
        })

        const issues = await getStoredIssuesWithConfig(config)
        const updatedRecords = [...issues]
        const idx = updatedRecords.findIndex(each =>
          normalizeJiraDomain(each.domain) === normalizeJiraDomain(domain) && each.issue.key === issueKey,
        )

        const updatedRecord: SyncedIssueRecord = {
          domain: normalizeJiraDomain(domain),
          issue: updatedIssue,
        }

        if (idx >= 0) {
          updatedRecords[idx] = updatedRecord
        } else {
          updatedRecords.push(updatedRecord)
        }

        await chrome.storage.local.set({ synced_issues: updatedRecords })
      } catch (e) {
        console.error('Failed to update local cache after transition', e)
      }

      return { success: true }
    }

    case 'RESET_EXTENSION_WORKLOGS_BY_DATE': {
      const config = await getConfig()
      validateConfiguredDomains(config)
      const { date } = payload as ResetExtensionWorklogsByDatePayload

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Invalid date format, expected YYYY-MM-DD')
      }

      const settled = await Promise.allSettled(
        config.jiraDomains.map(domainConfig => resetWorklogsForDomain(config, domainConfig, date)),
      )

      let deletedCount = 0
      let matchedCount = 0
      let scannedIssues = 0

      for (let i = 0; i < settled.length; i++) {
        const result = settled[i]
        const domain = config.jiraDomains[i].domain
        if (result.status === 'fulfilled') {
          deletedCount += result.value.deletedCount
          matchedCount += result.value.matchedCount
          scannedIssues += result.value.scannedIssues
          continue
        }

        console.error(`[Jira Sync] Failed to reset worklogs for domain ${domain}`, result.reason)
      }

      return { deletedCount, matchedCount, scannedIssues }
    }

    case 'SYNC_DATA':
      return syncData()

    case 'GET_STORED_ISSUES': {
      const config = await getConfig()
      const data = await chrome.storage.local.get(['synced_issues', 'last_sync', 'failed_domains'])
      const issues = normalizeStoredIssueRecords(data.synced_issues, config)

      return {
        issues,
        last_sync: data.last_sync,
        failed_domains: Array.isArray(data.failed_domains) ? data.failed_domains : [],
      }
    }

    default:
      throw new Error(`Unknown message type: ${type}`)
  }
}

chrome.runtime.onMessage.addListener((req, _, sendResponse) => {
  handleMessage(req)
    .then(sendResponse)
    .catch((e) => {
      console.error('Jira Sync Error:', e)
      sendResponse({ error: e.message || 'Unknown error' })
    })

  return true
})

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return

  chrome.runtime.openOptionsPage().catch((e) => {
    console.error('[Jira Sync] Failed to open setup page on install', e)
  })
})
