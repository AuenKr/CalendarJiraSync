import type { ResetExtensionWorklogsByDateResponse, CalendarEvent } from '@/types/messages'
import { addWorklog, resetExtensionWorklogsByDate } from '@/lib/jira'
import { buildWorklogComment, createExtensionWorklogMetadata } from '@/lib/worklogMetadata'

export interface LogTimeRunInput {
  date: string
  lastLoggedTime?: string | null
  fetchEvents: () => Promise<CalendarEvent[]>
  fetchDescription?: (eventId: string) => Promise<string | undefined>
  addWorklogFn?: (issueKey: string, timeSpentSeconds: number, started: string, comment?: string) => Promise<unknown>
  now?: Date
}

export interface LogTimeRunResult {
  loggedCount: number
  errors: number
  eligibleCount: number
  message: string
  isError: boolean
  newLastLoggedTime?: string
}

export interface ResetRunResult extends ResetExtensionWorklogsByDateResponse {
  message: string
  isError: boolean
}

interface JiraConfig {
  jiraDomain?: string
  email?: string
  apiToken?: string
}

function getDayBounds(date: string) {
  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59.999`)
  return { dayStart, dayEnd }
}

function getOverlapWindow(startTime: Date, endTime: Date, date: string) {
  const { dayStart, dayEnd } = getDayBounds(date)
  const overlapStart = new Date(Math.max(startTime.getTime(), dayStart.getTime()))
  const overlapEnd = new Date(Math.min(endTime.getTime(), dayEnd.getTime()))
  if (overlapEnd.getTime() <= overlapStart.getTime()) return null
  return { overlapStart, overlapEnd }
}

async function getStoredConfig(): Promise<JiraConfig> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return {}
  }

  const storage = await chrome.storage.local.get('jira-sync-config')
  const raw = storage['jira-sync-config']
  if (!raw) return {}

  try {
    const parsed = JSON.parse(raw as string)
    return (parsed.state || parsed) as JiraConfig
  } catch {
    return {}
  }
}

async function isJiraConfigured(): Promise<boolean> {
  const config = await getStoredConfig()
  return !!(config.jiraDomain && config.email && config.apiToken)
}

export async function runLogTimeForDate(input: LogTimeRunInput): Promise<LogTimeRunResult> {
  const {
    date,
    lastLoggedTime,
    fetchEvents,
    fetchDescription,
    addWorklogFn = addWorklog,
    now = new Date(),
  } = input

  const events = await fetchEvents()

  if (!events || events.length === 0) {
    return {
      loggedCount: 0,
      errors: 0,
      eligibleCount: 0,
      message: 'No events found',
      isError: false,
    }
  }

  const lastLoggedDate = lastLoggedTime ? new Date(lastLoggedTime) : null
  const uniqueEvents = new Map<string, CalendarEvent>()

  for (const event of events) {
    if (event.id) {
      if (!uniqueEvents.has(event.id)) {
        uniqueEvents.set(event.id, event)
      }
      continue
    }

    const fallbackId = `${event.title}::${event.startTime}::${event.endTime}`
    if (!uniqueEvents.has(fallbackId)) {
      uniqueEvents.set(fallbackId, event)
    }
  }

  const processedEvents = Array.from(uniqueEvents.values())
  const eligibleEvents: CalendarEvent[] = []

  for (const event of processedEvents) {
    const match = event.title.match(/\[([A-Z][A-Z0-9]+-\d+)\]/)
    if (!match?.[1]) continue

    const startTime = new Date(event.startTime)
    const endTime = new Date(event.endTime)
    const overlap = getOverlapWindow(startTime, endTime, date)
    if (!overlap) continue

    if (endTime.getTime() > now.getTime()) continue

    if (lastLoggedDate && overlap.overlapEnd.getTime() <= lastLoggedDate.getTime()) {
      continue
    }

    const durationSeconds = (overlap.overlapEnd.getTime() - overlap.overlapStart.getTime()) / 1000
    if (durationSeconds <= 0) continue

    eligibleEvents.push(event)
  }

  let loggedCount = 0
  let errors = 0

  for (const event of eligibleEvents) {
    const match = event.title.match(/\[([A-Z][A-Z0-9]+-\d+)\]/)
    if (!match?.[1]) continue

    const issueKey = match[1]
    const startTime = new Date(event.startTime)
    const endTime = new Date(event.endTime)
    const overlap = getOverlapWindow(startTime, endTime, date)
    if (!overlap) continue

    const durationSeconds = (overlap.overlapEnd.getTime() - overlap.overlapStart.getTime()) / 1000

    try {
      let description = event.description
      if (!description && event.id && fetchDescription) {
        description = await fetchDescription(event.id)
      }

      const comment = buildWorklogComment({
        startTime: overlap.overlapStart,
        endTime: overlap.overlapEnd,
        description,
        metadata: createExtensionWorklogMetadata(date, event.id),
      })

      const jiraStarted = overlap.overlapStart.toISOString().replace('Z', '+0000')
      await addWorklogFn(issueKey, durationSeconds, jiraStarted, comment)
      loggedCount++
    } catch (e) {
      console.error(`[Jira Sync] Failed to log worklog for ${issueKey}`, e)
      errors++
    }
  }

  if (loggedCount === 0 && errors === 0) {
    return {
      loggedCount,
      errors,
      eligibleCount: eligibleEvents.length,
      message: 'No new completed tasks found to log',
      isError: false,
    }
  }

  return {
    loggedCount,
    errors,
    eligibleCount: eligibleEvents.length,
    message: `Logged ${loggedCount} Event${loggedCount !== 1 ? 's' : ''}${errors > 0 ? `, ${errors} failed` : ''}!`,
    isError: errors > 0,
    newLastLoggedTime: loggedCount > 0 ? now.toISOString() : undefined,
  }
}

export async function logTimeForDateInPage(input: LogTimeRunInput): Promise<LogTimeRunResult> {
  const configured = await isJiraConfigured()
  if (!configured) {
    return {
      loggedCount: 0,
      errors: 0,
      eligibleCount: 0,
      message: 'Please configure Jira in extension settings',
      isError: true,
    }
  }

  return runLogTimeForDate(input)
}

export async function resetWorklogsForDate(date: string): Promise<ResetRunResult> {
  try {
    const result = await resetExtensionWorklogsByDate(date)
    if (result.matchedCount === 0) {
      return {
        ...result,
        message: 'No extension worklogs found for selected date',
        isError: false,
      }
    }

    return {
      ...result,
      message: `Deleted ${result.deletedCount}/${result.matchedCount} extension worklog${result.matchedCount !== 1 ? 's' : ''}`,
      isError: false,
    }
  } catch (e) {
    console.error('[Jira Sync] Failed to reset worklogs', e)
    return {
      deletedCount: 0,
      matchedCount: 0,
      scannedIssues: 0,
      message: 'Failed to reset worklogs',
      isError: true,
    }
  }
}
