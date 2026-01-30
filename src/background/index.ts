
import { Version3Client } from "jira.js"
import type { Issue, Project, SearchResults } from "jira.js/out/version3/models"
import type {
  MessageRequest,
  SearchIssuesPayload,
  AddWorklogPayload,
  UpdateWorklogPayload,
  DeleteWorklogPayload,
  CreateIssuePayload,
  GetIssuePayload,
  UpdateIssueDescriptionPayload,
  GetTransitionsPayload,
  TransitionIssuePayload,
} from "../types/messages"

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

async function syncData() {
  const client = await getClient()
  const config = await getConfig()

  const myself = await client.myself.getCurrentUser()
  const selectedProjectKeys: string[] = config.selectedProjectKeys || []

  let issues: Issue[] = []

  if (selectedProjectKeys.length) {
    // JQL: (project in (KEY1, KEY2) OR assignee = currentUser()) AND updated >= -30d ORDER BY updated DESC
    const jql = `(project in (${selectedProjectKeys.join(',')}) OR assignee = "${myself.accountId}") AND updated >= -30d ORDER BY updated DESC`
    
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
        jql: `assignee = "${myself.accountId}" ORDER BY updated DESC`,
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

    case "CREATE_ISSUE": {
      const client = await getClient()
      const { projectKey, summary, parentKey } =
        payload as CreateIssuePayload

      const issue = await client.issues.createIssue({
        fields: {
          project: { key: projectKey },
          summary,
          issuetype: { name: parentKey ? "Sub-task" : "Task" },
          parent: parentKey ? { key: parentKey } : undefined,
        },
      })

      return client.issues.getIssue({
        issueIdOrKey: issue.key,
        fields: ["summary", "parent", "status"],
      })
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
      return { success: true }
    }

    case "UPDATE_ISSUE_DESCRIPTION": {
      const client = await getClient()
      const { issueKey, description } = payload as UpdateIssueDescriptionPayload
      
      const currentIssue = await client.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ["description"]
      })
      
      let newContent: Record<string, unknown>[] = []
      
      if (currentIssue.fields.description) {
         // If it's ADF (object)
         if (typeof currentIssue.fields.description === 'object' && currentIssue.fields.description.content) {
            newContent = [...currentIssue.fields.description.content]
         } 
         // If it's string (v2 or legacy)
         else if (typeof currentIssue.fields.description === 'string') {
            newContent.push({
              type: "paragraph",
              content: [{ type: "text", text: currentIssue.fields.description }]
            })
         }
      }
      
      newContent.push({
        type: "paragraph",
        content: [{ type: "text", text: description }]
      })
      
      await client.issues.editIssue({
        issueIdOrKey: issueKey,
        fields: {
          description: {
            type: "doc",
            version: 1,
            content: newContent
          }
        }
      })
      
      return { success: true }
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
