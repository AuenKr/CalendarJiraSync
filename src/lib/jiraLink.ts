import type { JiraIssueRef } from '@/types/jira'
import { normalizeJiraDomain } from '@/lib/jiraConfig'

const MULTI_DOMAIN_LINK_PATTERN = /\[([^[\]|]+)\|([A-Z][A-Z0-9]+-\d+)\]/
const KEY_WITH_TRAILING_DOMAIN_PATTERN = /^\[([A-Z][A-Z0-9]+-\d+)\]\s*:?\s*(.*?)\s*:?\s*\[([^[\]|]+\.[^[\]|]+)\]\s*$/
const ISSUE_KEY_PATTERN = /\[?([A-Z][A-Z0-9]+-\d+)\]?/

export type LinkedIssueParseReason =
  | 'no-link'
  | 'ambiguous-key'
  | 'domain-not-configured'

export type LinkedIssueLinkMode = 'explicit' | 'default-fallback'

export interface LinkedIssueParseResult {
  ref: JiraIssueRef | null
  reason?: LinkedIssueParseReason
  issueKey?: string
  requestedDomain?: string
  linkMode?: LinkedIssueLinkMode
}

export function parseLinkedIssueFromText(
  text: string,
  configuredDomains: string[],
  defaultJiraDomain = '',
): LinkedIssueParseResult {
  const normalizedText = text.trim()
  const normalizedDomains = configuredDomains.map(normalizeJiraDomain).filter(Boolean)
  const uniqueDomains = Array.from(new Set(normalizedDomains))
  const normalizedDefaultDomain = normalizeJiraDomain(defaultJiraDomain)
  const resolvedDefaultDomain = normalizedDefaultDomain && uniqueDomains.includes(normalizedDefaultDomain)
    ? normalizedDefaultDomain
    : uniqueDomains.length === 1
      ? uniqueDomains[0]
      : ''

  const explicit = normalizedText.match(MULTI_DOMAIN_LINK_PATTERN)
  if (explicit?.[1] && explicit?.[2]) {
    const domain = normalizeJiraDomain(explicit[1])
    const issueKey = explicit[2]
    if (!domain) {
      return { ref: null, reason: 'no-link' }
    }

    if (uniqueDomains.length > 0 && !uniqueDomains.includes(domain)) {
      return {
        ref: null,
        issueKey,
        requestedDomain: domain,
        reason: 'domain-not-configured',
      }
    }

    return {
      ref: { domain, issueKey },
      linkMode: 'explicit',
    }
  }

  const keyWithDomain = normalizedText.match(KEY_WITH_TRAILING_DOMAIN_PATTERN)
  if (keyWithDomain?.[1] && keyWithDomain?.[3]) {
    const issueKey = keyWithDomain[1]
    const domain = normalizeJiraDomain(keyWithDomain[3])

    if (!domain) {
      return { ref: null, reason: 'no-link' }
    }

    if (uniqueDomains.length > 0 && !uniqueDomains.includes(domain)) {
      return {
        ref: null,
        issueKey,
        requestedDomain: domain,
        reason: 'domain-not-configured',
      }
    }

    return {
      ref: { domain, issueKey },
      linkMode: 'explicit',
    }
  }

  const keyOnlyMatch = normalizedText.match(ISSUE_KEY_PATTERN)
  if (!keyOnlyMatch?.[1]) {
    return { ref: null, reason: 'no-link' }
  }

  const issueKey = keyOnlyMatch[1]
  if (resolvedDefaultDomain) {
    return {
      ref: {
        domain: resolvedDefaultDomain,
        issueKey,
      },
      linkMode: 'default-fallback',
    }
  }

  if (uniqueDomains.length > 1) {
    return {
      ref: null,
      issueKey,
      reason: 'ambiguous-key',
    }
  }

  return { ref: null, reason: 'no-link' }
}

export function stripLinkedIssuePrefix(value: string): string {
  const withoutPrefix = value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^\[[^[\]]+\]\s*:?\s*/, '')

  return withoutPrefix
    .replace(/\s*:?\s*\[[a-z0-9][a-z0-9.-]*\.[a-z0-9.-]+\]\s*$/i, '')
    .trim()
}

export function formatLinkedIssueTitle(issueRef: JiraIssueRef, summary: string): string {
  return `[${issueRef.issueKey}] ${summary} [${issueRef.domain}]`
}

export function formatIssueRefLabel(issueRef: JiraIssueRef, configuredDomainCount: number): string {
  if (configuredDomainCount > 1) {
    return `${issueRef.domain} | ${issueRef.issueKey}`
  }
  return issueRef.issueKey
}

export function issueRefEquals(a: JiraIssueRef | null, b: JiraIssueRef | null): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.issueKey === b.issueKey && normalizeJiraDomain(a.domain) === normalizeJiraDomain(b.domain)
}

export function issueRefKey(ref: JiraIssueRef): string {
  return `${normalizeJiraDomain(ref.domain)}|${ref.issueKey}`
}

export function formatDomainDisplayLabel(domain: string): string {
  const normalized = normalizeJiraDomain(domain)
  const parts = normalized.split('.').filter(Boolean)

  if (parts.length === 0) {
    return domain.trim()
  }

  if (normalized.endsWith('.atlassian.net')) {
    return parts[0]
  }

  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`
  }

  return parts[0]
}
