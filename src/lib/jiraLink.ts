import type { JiraIssueRef } from '@/types/jira'
import { normalizeJiraDomain } from '@/lib/jiraConfig'

const MULTI_DOMAIN_LINK_PATTERN = /\[([^[\]|]+)\|([A-Z][A-Z0-9]+-\d+)\]/
const ISSUE_KEY_PATTERN = /\[?([A-Z][A-Z0-9]+-\d+)\]?/

export type LinkedIssueParseReason =
  | 'no-link'
  | 'ambiguous-key'
  | 'domain-not-configured'

export interface LinkedIssueParseResult {
  ref: JiraIssueRef | null
  reason?: LinkedIssueParseReason
  issueKey?: string
  requestedDomain?: string
}

export function parseLinkedIssueFromText(text: string, configuredDomains: string[]): LinkedIssueParseResult {
  const normalizedText = text.trim()
  const normalizedDomains = configuredDomains.map(normalizeJiraDomain).filter(Boolean)
  const uniqueDomains = Array.from(new Set(normalizedDomains))

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
    }
  }

  const keyOnlyMatch = normalizedText.match(ISSUE_KEY_PATTERN)
  if (!keyOnlyMatch?.[1]) {
    return { ref: null, reason: 'no-link' }
  }

  const issueKey = keyOnlyMatch[1]
  if (uniqueDomains.length === 1) {
    return {
      ref: {
        domain: uniqueDomains[0],
        issueKey,
      },
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
  return value
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^\[[^[\]]+\]\s*/, '')
    .trim()
}

export function formatLinkedIssueTitle(issueRef: JiraIssueRef, summary: string, configuredDomainCount: number): string {
  if (configuredDomainCount > 1) {
    return `[${issueRef.domain}|${issueRef.issueKey}] ${summary}`
  }

  return `[${issueRef.issueKey}] ${summary}`
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
