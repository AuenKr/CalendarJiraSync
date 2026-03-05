
import { Version3Client } from "jira.js"
import type { Issue, Project, SearchResults, Worklog } from "jira.js/out/version3/models"
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
} from "../types/messages"
import { parseExtensionMetadataFromComment } from "../lib/worklogMetadata"

/* ----------------------------- CONFIG ----------------------------- */

async function getConfig() {
  const storage = await chrome.storage.local.get("jira-sync-config")

  if (!storage["jira-sync-config"]) {
    throw new Error("Jira credentials not configured")
  }

  try {
    const parsed = JSON.parse(storage["jira-sync-config"] as string)
    return parsed.state || {}
  } catch {
    throw new Error("Invalid Jira config format")
  }
}

function normalizeDomain(domain: string) {
  if (!domain) return ""
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "")
}

/* ----------------------------- CLIENTS ----------------------------- */

async function getClient() {
  const { jiraDomain, email, apiToken } = await getConfig()

  if (!jiraDomain || !email || !apiToken) {
    throw new Error("Missing Jira credentials")
  }

  const normalized = normalizeDomain(jiraDomain)
  if (!normalized) {
    throw new Error("Invalid Jira domain")
  }

  return new Version3Client({
    host: `https://${normalized}`,
    authentication: {
      basic: { email, apiToken },
    },
    baseRequestConfig: {
      adapter: 'fetch', // Force use of Fetch API for Service Worker compatibility
    }
  })
}

/* ----------------------------- SYNC CORE ----------------------------- */

interface EnhancedSearchResults extends SearchResults {
  nextPageToken?: string
  isLast?: boolean
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

  let nextPageToken: string | undefined = undefined
  let isLast = false

  do {
    const res = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
      jql,
      fields: ['key'],
      maxResults: 100,
      nextPageToken,
    }) as EnhancedSearchResults

    for (const issue of (res.issues || [])) {
      if (issue.key) issueKeys.add(issue.key)
    }

    nextPageToken = res.nextPageToken
    isLast = res.isLast ?? (res.issues ? res.issues.length < 100 : true)
  } while (!isLast && nextPageToken)

  console.log('[Jira Sync][Background] Reset Step: issue scan completed', { date, issues: issueKeys.size })
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

  console.log('[Jira Sync][Background] Reset Step: fetched worklogs in range', { issueKey, count: worklogs.length })
  return worklogs
}

async function syncData() {
  const client = await getClient()
  const config = await getConfig()

  const myself = await client.myself.getCurrentUser()
  const selectedProjectKeys: string[] = config.selectedProjectKeys || []

  let issues: Issue[] = []

  if (selectedProjectKeys.length) {
    const jql = `(assignee = "${myself.accountId}" OR (project in (${selectedProjectKeys.join(',')}) AND assignee is EMPTY)) AND updated >= -30d ORDER BY updated DESC`
    
    let nextPageToken: string | undefined = undefined
    let isLast = false

    do {
      const res = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
        jql,
        fields: ["summary", "parent", "status", "project"],
        maxResults: 100,
        nextPageToken,
      }) as EnhancedSearchResults

      if (res.issues) {
        issues = [...issues, ...res.issues]
      }

      nextPageToken = res.nextPageToken
      isLast = res.isLast ?? (res.issues ? res.issues.length < 100 : true)
    } while (!isLast && nextPageToken)

  } else {
    const res =
      await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
        jql: `assignee = "${myself.accountId}" AND updated >= -30d ORDER BY updated DESC`,
        fields: ["summary", "parent", "status", "project"],
        maxResults: 100,
      })

    issues = res.issues || []
  }

  await chrome.storage.local.set({
    synced_issues: issues,
    last_sync: new Date().toISOString(),
  })

  return { success: true, count: issues.length }
}

/* ----------------------------- MESSAGE HANDLER ----------------------------- */

async function handleMessage(request: MessageRequest) {
  const { type, payload } = request

  switch (type) {
    case "SEARCH_ISSUES": {
      const client = await getClient()
      const { query } = payload as SearchIssuesPayload

      // General search: not restricted to selected projects or assignee
      const isKey = /^[A-Z][A-Z0-9]+-\d+$/.test(query)
      const jql = isKey 
        ? `(summary ~ "${query}" OR key = "${query}") ORDER BY updated DESC`
        : `summary ~ "${query}" ORDER BY updated DESC`

      const res =
        await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
          jql,
          fields: ["summary", "parent", "status"],
        })

      return { issues: res.issues || [] }
    }

    case "ADD_WORKLOG": {
      const client = await getClient()
      const { issueKey, timeSpentSeconds, started, comment } =
        payload as AddWorklogPayload

      return client.issueWorklogs.addWorklog({
        issueIdOrKey: issueKey,
        timeSpentSeconds,
        started,
        comment: comment
          ? {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: comment }],
              },
            ],
          }
          : undefined,
      })
    }

    case "UPDATE_WORKLOG": {
      const client = await getClient()
      const { issueKey, worklogId, timeSpentSeconds, started, comment } =
        payload as UpdateWorklogPayload

      return client.issueWorklogs.updateWorklog({
        issueIdOrKey: issueKey,
        id: worklogId,
        timeSpentSeconds,
        started,
        comment: comment
          ? {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: comment }],
              },
            ],
          }
          : undefined,
      })
    }

    case "DELETE_WORKLOG": {
      const client = await getClient()
      const { issueKey, worklogId } = payload as DeleteWorklogPayload

      return client.issueWorklogs.deleteWorklog({
        issueIdOrKey: issueKey,
        id: worklogId,
      })
    }

    case "GET_PROJECTS": {
      const client = await getClient()
      let allProjects: Project[] = []
      let isLast = false
      let startAt = 0
      const maxResults = 50

      while (!isLast) {
        const res = await client.projects.searchProjects({
          startAt,
          maxResults
        })
        
        if (res.values) {
          allProjects = [...allProjects, ...res.values]
        }
        
        isLast = res.isLast || false
        if (!isLast) {
          startAt += maxResults
        }
      }
      
      return allProjects
    }

    case "GET_ISSUE": {
      const client = await getClient()
      const { issueKey } = payload as GetIssuePayload
      const issue = await client.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ["description", "status", "summary"]
      })
      return { issue }
    }

    case "GET_TRANSITIONS": {
      const client = await getClient()
      const { issueKey } = payload as GetTransitionsPayload
      const response = await client.issues.getTransitions({
        issueIdOrKey: issueKey
      })
      return { transitions: response.transitions || [] }
    }

    case "TRANSITION_ISSUE": {
      const client = await getClient()
      const { issueKey, transitionId } = payload as TransitionIssuePayload
      await client.issues.doTransition({
        issueIdOrKey: issueKey,
        transition: {
          id: transitionId
        }
      })

      // Update local cache
      try {
        const updatedIssue = await client.issues.getIssue({
          issueIdOrKey: issueKey,
          fields: ["summary", "parent", "status", "project"]
        })

        const data = await chrome.storage.local.get("synced_issues")
        const issues = (data.synced_issues || []) as Issue[]
        
        const index = issues.findIndex(i => i.key === issueKey)
        if (index !== -1) {
          issues[index] = updatedIssue
        } else {
          issues.push(updatedIssue)
        }

        await chrome.storage.local.set({ synced_issues: issues })
      } catch (e) {
        console.error("Failed to update local cache after transition", e)
      }

      return { success: true }
    }

    case "RESET_EXTENSION_WORKLOGS_BY_DATE": {
      const client = await getClient()
      const { date } = payload as ResetExtensionWorklogsByDatePayload
      console.log('[Jira Sync][Background] Reset Step 1: received reset request', { date })

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('Invalid date format, expected YYYY-MM-DD')
      }

      const { dayStartMs, dayEndMs } = getDayRangeMs(date)
      const issueKeys = await findIssueKeysWithWorklogsOnDate(client, date)

      let matchedCount = 0
      let deletedCount = 0

      for (const issueKey of issueKeys) {
        console.log('[Jira Sync][Background] Reset Step 2: scanning issue', { issueKey })
        const issueWorklogs = await getIssueWorklogsInRange(client, issueKey, dayStartMs, dayEndMs)

        for (const worklog of issueWorklogs) {
          const meta = parseExtensionMetadataFromComment(worklog.comment)
          if (!meta) continue
          if (meta.date !== date) continue

          matchedCount++
          if (!worklog.id) continue

          try {
            await client.issueWorklogs.deleteWorklog({
              issueIdOrKey: issueKey,
              id: worklog.id,
            })
            deletedCount++
            console.log('[Jira Sync][Background] Reset Step 3: deleted extension worklog', { issueKey, worklogId: worklog.id })
          } catch (e) {
            console.error(`[Jira Sync] Failed to delete worklog ${worklog.id} on ${issueKey}`, e)
          }
        }
      }

      console.log('[Jira Sync][Background] Reset Step 4: completed', {
        date,
        scannedIssues: issueKeys.length,
        matchedCount,
        deletedCount,
      })
      return {
        deletedCount,
        matchedCount,
        scannedIssues: issueKeys.length,
      }
    }

    case "SYNC_DATA":
      return syncData()

    case "GET_STORED_ISSUES": {
      const data = await chrome.storage.local.get(["synced_issues", "last_sync"])
      return { 
        issues: data.synced_issues || [],
        last_sync: data.last_sync
      }
    }

    default:
      throw new Error(`Unknown message type: ${type}`)
  }
}

/* ----------------------------- RUNTIME WIRE ----------------------------- */

chrome.runtime.onMessage.addListener((req, _, sendResponse) => {
  handleMessage(req)
    .then(sendResponse)
    .catch((e) => {
      console.error("Jira Sync Error:", e)
      sendResponse({ error: e.message || "Unknown error" })
    })

  return true
})

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return

  chrome.runtime.openOptionsPage().catch((e) => {
    console.error("[Jira Sync] Failed to open setup page on install", e)
  })
})
