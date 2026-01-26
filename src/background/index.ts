
import { Version3Client } from "jira.js"
import type {
  MessageRequest,
  SearchIssuesPayload,
  AddWorklogPayload,
  UpdateWorklogPayload,
  DeleteWorklogPayload,
  CreateIssuePayload,
  GetIssuePayload,
  UpdateIssueDescriptionPayload,
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

async function syncData() {
  const client = await getClient()
  const config = await getConfig()

  const myself = await client.myself.getCurrentUser()
  const selectedProjectKeys: string[] = config.selectedProjectKeys || []

  let issues: any[] = []

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
      }) as any

      if (res.issues) {
        issues = [...issues, ...res.issues]
      }

      nextPageToken = res.nextPageToken
      isLast = res.isLast ?? (res.issues?.length < 100)
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
      const jql = `(summary ~ "${query}" OR key = "${query}") ORDER BY updated DESC`

      const res =
        await client.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
          jql,
          fields: ["summary", "parent"],
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
      let allProjects: any[] = []
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
        fields: ["summary", "parent"],
      })
    }

    case "GET_ISSUE": {
      const client = await getClient()
      const { issueKey } = payload as GetIssuePayload
      const issue = await client.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ["description"]
      })
      return { issue }
    }

    case "UPDATE_ISSUE_DESCRIPTION": {
      const client = await getClient()
      const { issueKey, description } = payload as UpdateIssueDescriptionPayload
      
      // Jira API expects description in Atlassian Document Format (ADF) if using v3
      // But the client might handle string conversion if it's simple text?
      // Actually, for v3, description is a structured object.
      // However, if we want to append text, we need to be careful.
      // Let's assume we are appending simple text for now.
      // If the existing description is ADF, appending string might fail or need conversion.
      // For simplicity, let's try to update it as a string if the client supports it, 
      // or construct a simple ADF paragraph.
      
      // Wait, jira.js v3 client expects ADF for description.
      // We need to construct a valid ADF object.
      
      // const adfDescription = {
      //   type: "doc",
      //   version: 1,
      //   content: [
      //     {
      //       type: "paragraph",
      //       content: [
      //         {
      //           type: "text",
      //           text: description
      //         }
      //       ]
      //     }
      //   ]
      // }

      // Note: This REPLACES the description. 
      // To APPEND, we should have fetched the existing one, parsed it, and added to content.
      // But the requirement says "get and append".
      // So the caller (popup) should have fetched the existing description, 
      // concatenated the text (if it was string) or we handle ADF merging here.
      
      // Since we are in background, let's handle the update.
      // But wait, the popup logic I planned was: Get Issue -> Append Text -> Update Issue.
      // If I do it in popup, I need to handle ADF parsing there? That's complex.
      // Maybe I should just expose "UPDATE_ISSUE" and let popup send the full new description?
      // But popup doesn't know ADF.
      
      // Let's try to handle it here.
      // If we receive a string description, we wrap it in ADF.
      // But if we want to APPEND, we need to know the previous content.
      
      // Actually, the user requirement: "When this things will be done. Then a single api call will be made to get and append jira task description with all relevant events details"
      // This implies the logic should be:
      // 1. Fetch current issue
      // 2. Extract current description (which might be ADF)
      // 3. Append new text
      // 4. Send update
      
      // If the current description is ADF, we need to append a new paragraph to its content array.
      
      // Let's implement a smart update here.
      
      const currentIssue = await client.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ["description"]
      })
      
      let newContent: any[] = []
      
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
      
      // Append our new description as a new paragraph
      // We can split by newlines to make multiple paragraphs if needed, 
      // but one big text node with newlines is also valid in a paragraph? 
      // Actually, ADF text nodes can contain newlines.
      
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
