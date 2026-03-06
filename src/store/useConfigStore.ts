import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Project } from 'jira.js/out/version3/models'
import type { JiraDomainConfig } from '@/types/jira'
import { chromeStorage } from './storage'
import { normalizeDomainConfigs, normalizeJiraDomains, parseJiraConfig, normalizeJiraDomain } from '@/lib/jiraConfig'

interface ConfigState {
  jiraDomains: JiraDomainConfig[]
  email: string
  apiToken: string
  projectsByDomain: Record<string, Project[]>
  lastLoggedTimes: Record<string, string>
  setCredentials: (credentials: { email: string; apiToken: string }) => void
  setJiraDomains: (domains: string[]) => void
  setConfig: (config: { jiraDomains: string[]; email: string; apiToken: string }) => void
  toggleProject: (domain: string, projectKey: string) => void
  setProjectsForDomain: (domain: string, projects: Project[]) => void
  setSelectedProjectsForDomain: (domain: string, selectedProjectKeys: string[]) => void
  setLastLoggedTime: (date: string, time: string) => void
  clearLastLoggedTime: (date: string) => void
  isConfigured: () => boolean
}

interface LegacyStateShape {
  jiraDomain?: string
  selectedProjectKeys?: string[]
  jiraDomains?: Array<{ domain?: string; selectedProjectKeys?: string[] }>
  email?: string
  apiToken?: string
  projects?: Project[]
  projectsByDomain?: Record<string, Project[]>
  lastLoggedTimes?: Record<string, string>
}

function buildConfigState(partial: LegacyStateShape): Pick<ConfigState, 'jiraDomains' | 'email' | 'apiToken' | 'projectsByDomain' | 'lastLoggedTimes'> {
  const parsed = parseJiraConfig(partial)
  const projectsByDomain = partial.projectsByDomain && typeof partial.projectsByDomain === 'object'
    ? partial.projectsByDomain
    : {}

  const normalizedProjectsByDomain: Record<string, Project[]> = {}
  for (const [domain, projects] of Object.entries(projectsByDomain)) {
    const normalizedDomain = normalizeJiraDomain(domain)
    if (!normalizedDomain) continue
    normalizedProjectsByDomain[normalizedDomain] = Array.isArray(projects) ? projects : []
  }

  if (Object.keys(normalizedProjectsByDomain).length === 0 && partial.projects?.length && parsed.jiraDomains.length === 1) {
    normalizedProjectsByDomain[parsed.jiraDomains[0].domain] = partial.projects
  }

  return {
    jiraDomains: normalizeDomainConfigs(parsed.jiraDomains),
    email: parsed.email,
    apiToken: parsed.apiToken,
    projectsByDomain: normalizedProjectsByDomain,
    lastLoggedTimes: partial.lastLoggedTimes && typeof partial.lastLoggedTimes === 'object'
      ? partial.lastLoggedTimes
      : {},
  }
}

function withDomain(
  jiraDomains: JiraDomainConfig[],
  domain: string,
  updater: (existing: JiraDomainConfig | null) => JiraDomainConfig,
): JiraDomainConfig[] {
  const normalizedDomain = normalizeJiraDomain(domain)
  if (!normalizedDomain) return jiraDomains

  const existing = jiraDomains.find(each => each.domain === normalizedDomain) || null
  const next = updater(existing)
  const rest = jiraDomains.filter(each => each.domain !== normalizedDomain)
  return normalizeDomainConfigs([...rest, next])
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      jiraDomains: [],
      email: '',
      apiToken: '',
      projectsByDomain: {},
      lastLoggedTimes: {},

      setCredentials: ({ email, apiToken }) => set({ email, apiToken }),

      setJiraDomains: (domains) => set((state) => {
        const normalizedDomains = normalizeJiraDomains(domains)
        const domainSet = new Set(normalizedDomains)

        const nextJiraDomains = normalizedDomains.map(domain => {
          const existing = state.jiraDomains.find(each => each.domain === domain)
          return {
            domain,
            selectedProjectKeys: existing?.selectedProjectKeys || [],
          }
        })

        const nextProjectsByDomain = Object.fromEntries(
          Object.entries(state.projectsByDomain).filter(([domain]) => domainSet.has(domain)),
        )

        return {
          jiraDomains: normalizeDomainConfigs(nextJiraDomains),
          projectsByDomain: nextProjectsByDomain,
        }
      }),

      setConfig: ({ jiraDomains, email, apiToken }) => set((state) => {
        const normalizedDomains = normalizeJiraDomains(jiraDomains)
        const domainSet = new Set(normalizedDomains)

        const nextJiraDomains = normalizedDomains.map(domain => {
          const existing = state.jiraDomains.find(each => each.domain === domain)
          return {
            domain,
            selectedProjectKeys: existing?.selectedProjectKeys || [],
          }
        })

        const nextProjectsByDomain = Object.fromEntries(
          Object.entries(state.projectsByDomain).filter(([domain]) => domainSet.has(domain)),
        )

        return {
          email,
          apiToken,
          jiraDomains: normalizeDomainConfigs(nextJiraDomains),
          projectsByDomain: nextProjectsByDomain,
        }
      }),

      toggleProject: (domain, projectKey) => set((state) => ({
        jiraDomains: withDomain(state.jiraDomains, domain, (existing) => {
          const current = existing?.selectedProjectKeys || []
          const nextSelected = current.includes(projectKey)
            ? current.filter(key => key !== projectKey)
            : [...current, projectKey]

          return {
            domain: normalizeJiraDomain(domain),
            selectedProjectKeys: nextSelected,
          }
        }),
      })),

      setProjectsForDomain: (domain, projects) => set((state) => {
        const normalizedDomain = normalizeJiraDomain(domain)
        if (!normalizedDomain) return state
        return {
          projectsByDomain: {
            ...state.projectsByDomain,
            [normalizedDomain]: projects,
          },
        }
      }),

      setSelectedProjectsForDomain: (domain, selectedProjectKeys) => set((state) => ({
        jiraDomains: withDomain(state.jiraDomains, domain, () => ({
          domain: normalizeJiraDomain(domain),
          selectedProjectKeys: Array.from(new Set(selectedProjectKeys.map(key => key.trim()).filter(Boolean))),
        })),
      })),

      setLastLoggedTime: (date, time) => set((state) => {
        const newTimes = { ...state.lastLoggedTimes, [date]: time }
        const sortedDates = Object.keys(newTimes).sort()
        if (sortedDates.length > 30) {
          const datesToRemove = sortedDates.slice(0, sortedDates.length - 30)
          datesToRemove.forEach(d => delete newTimes[d])
        }
        return { lastLoggedTimes: newTimes }
      }),

      clearLastLoggedTime: (date) => set((state) => {
        if (!state.lastLoggedTimes[date]) return state
        const newTimes = { ...state.lastLoggedTimes }
        delete newTimes[date]
        return { lastLoggedTimes: newTimes }
      }),

      isConfigured: () => {
        const { jiraDomains, email, apiToken } = get()
        return !!(jiraDomains.length > 0 && email && apiToken)
      },
    }),
    {
      name: 'jira-sync-config',
      version: 2,
      migrate: (persistedState) => {
        const typedState = (persistedState || {}) as LegacyStateShape
        return buildConfigState(typedState)
      },
      merge: (persistedState, currentState) => {
        const typedState = (persistedState || {}) as LegacyStateShape
        return {
          ...currentState,
          ...buildConfigState(typedState),
        }
      },
      storage: createJSONStorage(() => chromeStorage),
    }
  )
)
