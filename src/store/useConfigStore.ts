import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { chromeStorage } from './storage'
import type { Project } from 'jira.js/out/version3/models'

interface ConfigState {
  jiraDomain: string
  email: string
  apiToken: string
  selectedProjectKeys: string[]
  projects: Project[]
  lastLoggedTimes: Record<string, string> // Date (YYYY-MM-DD) -> ISO Timestamp
  setConfig: (config: { jiraDomain: string; email: string; apiToken: string }) => void
  toggleProject: (projectKey: string) => void
  setProjects: (projects: Project[]) => void
  setLastLoggedTime: (date: string, time: string) => void
  isConfigured: () => boolean
}

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      jiraDomain: '',
      email: '',
      apiToken: '',
      selectedProjectKeys: [],
      projects: [],
      lastLoggedTimes: {},
      setConfig: (config) => set(config),
      toggleProject: (projectKey) => set((state) => {
        const current = state.selectedProjectKeys || []
        if (current.includes(projectKey)) {
          return { selectedProjectKeys: current.filter(key => key !== projectKey) }
        } else {
          return { selectedProjectKeys: [...current, projectKey] }
        }
      }),
      setProjects: (projects) => set({ projects }),
      setLastLoggedTime: (date, time) => set((state) => ({
        lastLoggedTimes: {
          ...state.lastLoggedTimes,
          [date]: time
        }
      })),
      isConfigured: () => {
        const { jiraDomain, email, apiToken } = get()
        return !!(jiraDomain && email && apiToken)
      },
    }),
    {
      name: 'jira-sync-config',
      storage: createJSONStorage(() => chromeStorage),
    }
  )
)
