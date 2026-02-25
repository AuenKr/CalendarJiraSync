const WORKLOG_MARKER_PREFIX = '[[CJS_META_V1]]'
const WORKLOG_SOURCE = 'calendar-jira-sync'

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

export function buildMetadataLine(metadata: ExtensionWorklogMetadata): string {
  return `${WORKLOG_MARKER_PREFIX}${JSON.stringify(metadata)}`
}

export function buildWorklogComment({
  startTime,
  endTime,
  description,
  metadata,
}: {
  startTime: Date
  endTime: Date
  description?: string
  metadata: ExtensionWorklogMetadata
}): string {
  const formatDate = (value: Date) => {
    const day = String(value.getDate()).padStart(2, '0')
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const year = value.getFullYear()
    return `${day}-${month}-${year}`
  }
  const formatDateTime = (value: Date) => `${formatDate(value)} ${value.toLocaleTimeString()}`

  let comment = `Start: ${formatDateTime(startTime)}\nEnd: ${formatDateTime(endTime)}`

  if (description?.trim()) {
    comment += `\n\n${description.trim()}`
  }

  comment += `\n\n${buildMetadataLine(metadata)}`
  return comment
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
