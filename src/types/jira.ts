import type { Issue } from 'jira.js/out/version3/models'

export interface JiraIssueRef {
  domain: string
  issueKey: string
}

export interface SyncedIssueRecord {
  domain: string
  issue: Issue
}

export interface DomainSyncFailure {
  domain: string
  error: string
}

export interface JiraDomainConfig {
  domain: string
  selectedProjectKeys: string[]
}
