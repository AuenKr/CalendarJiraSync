import type { JiraDomainConfig } from '@/types/jira'

interface LegacyConfigShape {
  jiraDomain?: string
  defaultJiraDomain?: string
  selectedProjectKeys?: string[]
  jiraDomains?: Array<{
    domain?: string
    selectedProjectKeys?: string[]
  }>
  email?: string
  apiToken?: string
}

export interface JiraConfigSnapshot {
  email: string
  apiToken: string
  jiraDomains: JiraDomainConfig[]
  defaultJiraDomain: string
}

export function normalizeJiraDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .replace(/\/$/, '')
}

function uniqueStringList(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

export function normalizeJiraDomains(values: string[]): string[] {
  const normalized = values
    .map(normalizeJiraDomain)
    .filter(Boolean)

  return uniqueStringList(normalized)
}

export function resolveDefaultJiraDomain(domains: string[], candidate?: string): string {
  const normalizedDomains = normalizeJiraDomains(domains)
  const normalizedCandidate = normalizeJiraDomain(candidate || '')

  if (normalizedCandidate && normalizedDomains.includes(normalizedCandidate)) {
    return normalizedCandidate
  }

  return normalizedDomains[0] || ''
}

export function normalizeDomainConfigs(values: Array<{ domain?: string; selectedProjectKeys?: string[] }>): JiraDomainConfig[] {
  const merged = new Map<string, Set<string>>()

  for (const value of values) {
    const domain = normalizeJiraDomain(value.domain || '')
    if (!domain) continue

    if (!merged.has(domain)) {
      merged.set(domain, new Set<string>())
    }

    const selected = value.selectedProjectKeys || []
    for (const key of selected) {
      if (!key?.trim()) continue
      merged.get(domain)?.add(key.trim())
    }
  }

  return Array.from(merged.entries())
    .map(([domain, selectedProjectKeys]) => ({
      domain,
      selectedProjectKeys: Array.from(selectedProjectKeys).sort(),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain))
}

function toLegacyShape(rawConfig: unknown): LegacyConfigShape {
  if (!rawConfig || typeof rawConfig !== 'object') {
    return {}
  }

  const typed = rawConfig as Record<string, unknown>
  const candidate = typed.state && typeof typed.state === 'object'
    ? (typed.state as Record<string, unknown>)
    : typed

  return {
    jiraDomain: typeof candidate.jiraDomain === 'string' ? candidate.jiraDomain : undefined,
    defaultJiraDomain: typeof candidate.defaultJiraDomain === 'string' ? candidate.defaultJiraDomain : undefined,
    selectedProjectKeys: Array.isArray(candidate.selectedProjectKeys)
      ? candidate.selectedProjectKeys.filter((item): item is string => typeof item === 'string')
      : undefined,
    jiraDomains: Array.isArray(candidate.jiraDomains)
      ? candidate.jiraDomains
        .filter((item): item is { domain?: string; selectedProjectKeys?: string[] } => !!item && typeof item === 'object')
      : undefined,
    email: typeof candidate.email === 'string' ? candidate.email : undefined,
    apiToken: typeof candidate.apiToken === 'string' ? candidate.apiToken : undefined,
  }
}

export function parseJiraConfig(rawConfig: unknown): JiraConfigSnapshot {
  const parsed = toLegacyShape(rawConfig)
  const email = parsed.email || ''
  const apiToken = parsed.apiToken || ''

  const orderedDomains = normalizeJiraDomains((parsed.jiraDomains || []).map(each => each.domain || ''))
  const normalizedDomainConfigs = normalizeDomainConfigs(parsed.jiraDomains || [])
  if (normalizedDomainConfigs.length > 0) {
    return {
      email,
      apiToken,
      jiraDomains: normalizedDomainConfigs,
      defaultJiraDomain: resolveDefaultJiraDomain(
        orderedDomains.length > 0 ? orderedDomains : normalizedDomainConfigs.map(each => each.domain),
        parsed.defaultJiraDomain,
      ),
    }
  }

  const legacyDomain = normalizeJiraDomain(parsed.jiraDomain || '')
  if (!legacyDomain) {
    return {
      email,
      apiToken,
      jiraDomains: [],
      defaultJiraDomain: '',
    }
  }

  return {
    email,
    apiToken,
    jiraDomains: [{
      domain: legacyDomain,
      selectedProjectKeys: uniqueStringList(parsed.selectedProjectKeys || []),
    }],
    defaultJiraDomain: resolveDefaultJiraDomain([legacyDomain], parsed.defaultJiraDomain || legacyDomain),
  }
}

export async function getStoredJiraConfig(): Promise<JiraConfigSnapshot> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return { email: '', apiToken: '', jiraDomains: [], defaultJiraDomain: '' }
  }

  const storage = await chrome.storage.local.get('jira-sync-config')
  const raw = storage['jira-sync-config']
  if (!raw) {
    return { email: '', apiToken: '', jiraDomains: [], defaultJiraDomain: '' }
  }

  try {
    if (typeof raw === 'string') {
      return parseJiraConfig(JSON.parse(raw))
    }
    return parseJiraConfig(raw)
  } catch {
    return { email: '', apiToken: '', jiraDomains: [], defaultJiraDomain: '' }
  }
}

export function hasConfiguredJiraDomains(config: JiraConfigSnapshot): boolean {
  return !!(config.email && config.apiToken && config.jiraDomains.length > 0)
}

export function getConfiguredDomains(config: JiraConfigSnapshot): string[] {
  return config.jiraDomains.map(each => each.domain)
}
