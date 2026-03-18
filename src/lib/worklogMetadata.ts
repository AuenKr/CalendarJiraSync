import { normalizeJiraDomain } from '@/lib/jiraConfig'
import type { StoredExtensionWorklogMetadata } from '@/types/jira'

const WORKLOG_MARKER_PREFIX = '[[CJS_META_V1]]'
const WORKLOG_SOURCE = 'calendar-jira-sync'
const EXTENSION_WORKLOGS_STORAGE_KEY = 'extension_worklogs'

export interface ExtensionWorklogMetadata {
  source: typeof WORKLOG_SOURCE
  date: string
  eventId?: string
}

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function getLocalDateString(date: Date): string {
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - (offset * 60 * 1000))
  return local.toISOString().split('T')[0]
}

export function createExtensionWorklogMetadata(date: string, eventId?: string): ExtensionWorklogMetadata {
  return {
    source: WORKLOG_SOURCE,
    date,
    eventId,
  }
}

function adfNodeToText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''

  const typedNode = node as {
    type?: string
    text?: string
    content?: unknown[]
  }

  if (typedNode.type === 'text') {
    return typedNode.text || ''
  }

  if (typedNode.type === 'hardBreak') {
    return '\n'
  }

  if (!Array.isArray(typedNode.content)) {
    return ''
  }

  const text = typedNode.content.map(adfNodeToText).join('')
  if (typedNode.type === 'paragraph') {
    return `${text}\n`
  }
  return text
}

export function adfCommentToPlainText(comment: unknown): string {
  if (!comment || typeof comment !== 'object') return ''

  const typedComment = comment as { content?: unknown[] }
  if (!Array.isArray(typedComment.content)) return ''

  return typedComment.content.map(adfNodeToText).join('').trim()
}

export function parseExtensionMetadataFromCommentText(commentText: string): ExtensionWorklogMetadata | null {
  if (!commentText) return null

  const lines = commentText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.startsWith(WORKLOG_MARKER_PREFIX)) continue

    const jsonPart = line.slice(WORKLOG_MARKER_PREFIX.length).trim()
    if (!jsonPart) return null

    try {
      const parsed = JSON.parse(jsonPart) as Partial<ExtensionWorklogMetadata>
      if (
        parsed.source !== WORKLOG_SOURCE ||
        typeof parsed.date !== 'string' ||
        !isValidDateString(parsed.date)
      ) {
        return null
      }

      if (parsed.eventId && typeof parsed.eventId !== 'string') {
        return null
      }

      return {
        source: WORKLOG_SOURCE,
        date: parsed.date,
        eventId: parsed.eventId,
      }
    } catch {
      return null
    }
  }

  return null
}

export function parseExtensionMetadataFromComment(comment: unknown): ExtensionWorklogMetadata | null {
  const text = adfCommentToPlainText(comment)
  return parseExtensionMetadataFromCommentText(text)
}

function isValidStoredExtensionWorklogMetadata(value: unknown): value is StoredExtensionWorklogMetadata {
  if (!value || typeof value !== 'object') {
    return false
  }

  const typed = value as Record<string, unknown>
  return typeof typed.domain === 'string' &&
    !!normalizeJiraDomain(typed.domain) &&
    typeof typed.issueKey === 'string' &&
    typed.issueKey.trim().length > 0 &&
    typeof typed.worklogId === 'string' &&
    typed.worklogId.trim().length > 0 &&
    typeof typed.date === 'string' &&
    isValidDateString(typed.date) &&
    (typed.eventId === undefined || typeof typed.eventId === 'string')
}

function normalizeStoredExtensionWorklogMetadata(
  value: StoredExtensionWorklogMetadata,
): StoredExtensionWorklogMetadata | null {
  const domain = normalizeJiraDomain(value.domain)
  if (!domain) return null

  return {
    domain,
    issueKey: value.issueKey.trim(),
    worklogId: value.worklogId.trim(),
    date: value.date,
    eventId: value.eventId?.trim() || undefined,
  }
}

function getLocalStorageValue(key: string): unknown {
  if (typeof localStorage === 'undefined') return null

  const raw = localStorage.getItem(key)
  if (!raw) return null

  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function getStorageValue(key: string): Promise<unknown> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const result = await chrome.storage.local.get(key)
    return result[key]
  }

  return getLocalStorageValue(key)
}

async function setStorageValue(key: string, value: unknown): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [key]: value })
    return
  }

  if (typeof localStorage === 'undefined') return
  localStorage.setItem(key, JSON.stringify(value))
}

export function getStoredExtensionWorklogKey({
  domain,
  issueKey,
  worklogId,
}: Pick<StoredExtensionWorklogMetadata, 'domain' | 'issueKey' | 'worklogId'>): string {
  return `${normalizeJiraDomain(domain) || domain}|${issueKey.trim()}|${worklogId.trim()}`
}

export function normalizeStoredExtensionWorklogs(raw: unknown): StoredExtensionWorklogMetadata[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const deduped = new Map<string, StoredExtensionWorklogMetadata>()

  for (const item of raw) {
    if (!isValidStoredExtensionWorklogMetadata(item)) continue

    const normalized = normalizeStoredExtensionWorklogMetadata(item)
    if (!normalized) continue

    deduped.set(getStoredExtensionWorklogKey(normalized), normalized)
  }

  return Array.from(deduped.values())
}

export async function getStoredExtensionWorklogs(): Promise<StoredExtensionWorklogMetadata[]> {
  const raw = await getStorageValue(EXTENSION_WORKLOGS_STORAGE_KEY)
  return normalizeStoredExtensionWorklogs(raw)
}

export async function setStoredExtensionWorklogs(worklogs: StoredExtensionWorklogMetadata[]): Promise<void> {
  const normalized = normalizeStoredExtensionWorklogs(worklogs)
  await setStorageValue(EXTENSION_WORKLOGS_STORAGE_KEY, normalized)
}

export async function saveStoredExtensionWorklog(worklog: StoredExtensionWorklogMetadata): Promise<void> {
  const normalized = normalizeStoredExtensionWorklogMetadata(worklog)
  if (!normalized) {
    throw new Error('Invalid extension worklog metadata')
  }

  const existing = await getStoredExtensionWorklogs()
  const deduped = new Map(existing.map(item => [getStoredExtensionWorklogKey(item), item]))
  deduped.set(getStoredExtensionWorklogKey(normalized), normalized)
  await setStoredExtensionWorklogs(Array.from(deduped.values()))
}
