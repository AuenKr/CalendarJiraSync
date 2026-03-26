import { describe, expect, test } from 'bun:test'
import { parseJiraConfig } from './jiraConfig'

describe('parseJiraConfig', () => {
  test('migrates a legacy single-domain config into a default domain', () => {
    const config = parseJiraConfig({
      jiraDomain: 'company.atlassian.net',
      selectedProjectKeys: ['ABC'],
      email: 'user@example.com',
      apiToken: 'token',
    })

    expect(config.defaultJiraDomain).toBe('company.atlassian.net')
    expect(config.jiraDomains).toEqual([
      {
        domain: 'company.atlassian.net',
        selectedProjectKeys: ['ABC'],
      },
    ])
  })

  test('preserves a valid stored default domain', () => {
    const config = parseJiraConfig({
      jiraDomains: [
        { domain: 'beta.atlassian.net' },
        { domain: 'alpha.atlassian.net' },
      ],
      defaultJiraDomain: 'beta.atlassian.net',
    })

    expect(config.defaultJiraDomain).toBe('beta.atlassian.net')
    expect(config.jiraDomains.map(each => each.domain)).toEqual([
      'alpha.atlassian.net',
      'beta.atlassian.net',
    ])
  })

  test('falls back to the first configured domain when the stored default is invalid', () => {
    const config = parseJiraConfig({
      jiraDomains: [
        { domain: 'beta.atlassian.net' },
        { domain: 'alpha.atlassian.net' },
      ],
      defaultJiraDomain: 'missing.atlassian.net',
    })

    expect(config.defaultJiraDomain).toBe('beta.atlassian.net')
  })
})
