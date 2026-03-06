import type { ResetExtensionWorklogsByDateResponse, CalendarEvent } from '@/types/messages'
import { addWorklog, resetExtensionWorklogsByDate } from '@/lib/jira'
import { buildWorklogComment, createExtensionWorklogMetadata } from '@/lib/worklogMetadata'
import { getStoredJiraConfig, hasConfiguredJiraDomains } from '@/lib/jiraConfig'
import { parseLinkedIssueFromText } from '@/lib/jiraLink'
import type { JiraIssueRef } from '@/types/jira'

export interface LogTimeRunInput {
  date: string
  lastLoggedTime?: string | null
  fetchEvents: () => Promise<CalendarEvent[]>
  fetchDescription?: (eventId: string) => Promise<string | undefined>
  addWorklogFn?: (issueRef: JiraIssueRef, timeSpentSeconds: number, started: string, comment?: string) => Promise<unknown>
  now?: Date
}

export interface LogTimeRunResult {
  loggedCount: number
  errors: number
  eligibleCount: number
  ambiguousCount: number
  message: string
  isError: boolean
  newLastLoggedTime?: string
}

export interface ResetRunResult extends ResetExtensionWorklogsByDateResponse {
  message: string
  isError: boolean
}

export function isValidLogDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false

  const [yearPart, monthPart, dayPart] = date.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false

  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
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

async function getConfiguredDomains(): Promise<string[]> {
  const config = await getStoredJiraConfig()
  return config.jiraDomains.map(each => each.domain)
}

async function isJiraConfigured(): Promise<boolean> {
  const config = await getStoredJiraConfig()
  return hasConfiguredJiraDomains(config)
}

interface EligibleEvent {
  event: CalendarEvent
  issueRef: JiraIssueRef
}

interface EventDebugInfo {
  id: string
  title: string
  startTime: string
  endTime: string
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

  if (!isValidLogDate(date)) {
    return {
      loggedCount: 0,
      errors: 0,
      eligibleCount: 0,
      ambiguousCount: 0,
      message: 'Please select a valid date',
      isError: true,
    }
  }

  const events = await fetchEvents()

  if (!events || events.length === 0) {
    return {
      loggedCount: 0,
      errors: 0,
      eligibleCount: 0,
      ambiguousCount: 0,
      message: 'No events found',
      isError: false,
    }
  }

  const configuredDomains = await getConfiguredDomains()
  const lastLoggedDate = lastLoggedTime ? new Date(lastLoggedTime) : null
  const uniqueEvents = new Map<string, CalendarEvent>()
  const ambiguousEvents: EventDebugInfo[] = []
  const domainNotConfiguredEvents: Array<EventDebugInfo & { requestedDomain?: string }> = []

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
  const eligibleEvents: EligibleEvent[] = []
  let ambiguousCount = 0

  for (const event of processedEvents) {
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

    const parsedLink = parseLinkedIssueFromText(event.title, configuredDomains)
    if (!parsedLink.ref) {
      if (parsedLink.reason === 'ambiguous-key') {
        ambiguousCount++
        const eventInfo = {
          id: event.id || `${event.title}::${event.startTime}::${event.endTime}`,
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime,
        }
        ambiguousEvents.push(eventInfo)
        console.warn('[Jira Sync][LogTime] Skipping ambiguous linked event; relink required', eventInfo)
      } else if (parsedLink.reason === 'domain-not-configured') {
        const eventInfo = {
          id: event.id || `${event.title}::${event.startTime}::${event.endTime}`,
          title: event.title,
          startTime: event.startTime,
          endTime: event.endTime,
          requestedDomain: parsedLink.requestedDomain,
        }
        domainNotConfiguredEvents.push(eventInfo)
        console.warn('[Jira Sync][LogTime] Skipping event linked to unconfigured domain', eventInfo)
      }
      continue
    }

    eligibleEvents.push({
      event,
      issueRef: parsedLink.ref,
    })
  }

  let loggedCount = 0
  let errors = 0

  for (const eligible of eligibleEvents) {
    const { event, issueRef } = eligible
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
      await addWorklogFn(issueRef, durationSeconds, jiraStarted, comment)
      loggedCount++
    } catch (e) {
      console.error(`[Jira Sync] Failed to log worklog for ${issueRef.domain}|${issueRef.issueKey}`, e)
      errors++
    }
  }

  if (loggedCount === 0 && errors === 0) {
    const ambiguitySuffix = ambiguousCount > 0
      ? ` (${ambiguousCount} ambiguous event${ambiguousCount === 1 ? '' : 's'} require relink)`
      : ''

    return {
      loggedCount,
      errors,
      eligibleCount: eligibleEvents.length,
      ambiguousCount,
      message: `No new completed tasks found to log${ambiguitySuffix}`,
      isError: false,
    }
  }

  let message = `Logged ${loggedCount} event${loggedCount !== 1 ? 's' : ''}${errors > 0 ? `, ${errors} failed` : ''}`
  if (ambiguousCount > 0) {
    message += `, skipped ${ambiguousCount} ambiguous event${ambiguousCount === 1 ? '' : 's'}`
  }
  message += '!'

  return {
    loggedCount,
    errors,
    eligibleCount: eligibleEvents.length,
    ambiguousCount,
    message,
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
      ambiguousCount: 0,
      message: 'Please configure Jira in extension settings',
      isError: true,
    }
  }

  return runLogTimeForDate(input)
}

export async function resetWorklogsForDate(date: string): Promise<ResetRunResult> {
  if (!isValidLogDate(date)) {
    return {
      deletedCount: 0,
      matchedCount: 0,
      scannedIssues: 0,
      message: 'Please select a valid date',
      isError: true,
    }
  }

  try {
    const result = await resetExtensionWorklogsByDate(date)
    const failedDomains = result.failedDomains || []

    if (failedDomains.length > 0) {
      const failedSummary = failedDomains.map(each => each.domain).join(', ')
      console.error('[Jira Sync][ResetWorklogs] Partial reset failure', {
        date,
        failedDomains,
        deletedCount: result.deletedCount,
        matchedCount: result.matchedCount,
        scannedIssues: result.scannedIssues,
      })

      if (result.matchedCount === 0) {
        return {
          ...result,
          message: `Failed to reset worklogs for: ${failedSummary}`,
          isError: true,
        }
      }

      return {
        ...result,
        message: `Deleted ${result.deletedCount}/${result.matchedCount} extension worklog${result.matchedCount !== 1 ? 's' : ''}. Failed domains: ${failedSummary}`,
        isError: true,
      }
    }

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
