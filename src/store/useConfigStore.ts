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
  lastLoggedTime: string | null
  setConfig: (config: { jiraDomain: string; email: string; apiToken: string }) => void
  toggleProject: (projectKey: string) => void
  setProjects: (projects: Project[]) => void
  setLastLoggedTime: (time: string) => void
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
      lastLoggedTime: null,
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
      setLastLoggedTime: (time) => set({ lastLoggedTime: time }),
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
