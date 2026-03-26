import { describe, expect, test } from 'bun:test'
import { formatLinkedIssueTitle, parseLinkedIssueFromText } from './jiraLink'

describe('parseLinkedIssueFromText', () => {
  test('keeps explicit domain links even when a default domain exists', () => {
    const result = parseLinkedIssueFromText(
      '[ABC-123] Example task [other.atlassian.net]',
      ['default.atlassian.net', 'other.atlassian.net'],
      'default.atlassian.net',
    )

    expect(result).toEqual({
      ref: {
        domain: 'other.atlassian.net',
        issueKey: 'ABC-123',
      },
      linkMode: 'explicit',
    })
  })

  test('uses the default domain for legacy key-only links', () => {
    const result = parseLinkedIssueFromText(
      '[ABC-123] Example task',
      ['alpha.atlassian.net', 'beta.atlassian.net'],
      'beta.atlassian.net',
    )

    expect(result).toEqual({
      ref: {
        domain: 'beta.atlassian.net',
        issueKey: 'ABC-123',
      },
      linkMode: 'default-fallback',
    })
  })

  test('remains ambiguous when multiple domains exist and no valid default is available', () => {
    const result = parseLinkedIssueFromText(
      '[ABC-123] Example task',
      ['alpha.atlassian.net', 'beta.atlassian.net'],
      'missing.atlassian.net',
    )

    expect(result).toEqual({
      ref: null,
      issueKey: 'ABC-123',
      reason: 'ambiguous-key',
    })
  })
})

describe('formatLinkedIssueTitle', () => {
  test('always persists the domain-qualified title format for new links', () => {
    expect(formatLinkedIssueTitle(
      { domain: 'company.atlassian.net', issueKey: 'ABC-123' },
      'Example task',
    )).toBe('[ABC-123] Example task [company.atlassian.net]')
  })
})
