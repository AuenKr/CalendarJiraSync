import { useEffect } from 'react'
import { DEFAULT_THEME_PREFERENCE, normalizeThemePreference, type ThemePreference } from '@/types/theme'

const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)'
const CONFIG_STORAGE_KEY = 'jira-sync-config'

function getThemeMediaQuery() {
  return window.matchMedia(THEME_MEDIA_QUERY)
}

export function resolveThemePreference(themePreference: ThemePreference, mediaQuery = getThemeMediaQuery()): 'light' | 'dark' {
  if (themePreference === 'system') {
    return mediaQuery.matches ? 'dark' : 'light'
  }

  return themePreference
}

export function applyThemePreference(themePreference: ThemePreference, mediaQuery = getThemeMediaQuery()) {
  const resolvedTheme = resolveThemePreference(themePreference, mediaQuery)
  const isDark = resolvedTheme === 'dark'

  document.documentElement.classList.toggle('dark', isDark)
  document.documentElement.style.colorScheme = resolvedTheme
}

function readThemePreferenceFromPersistedConfig(value: string | null | undefined): ThemePreference {
  if (!value) return DEFAULT_THEME_PREFERENCE

  try {
    const parsed = JSON.parse(value) as { state?: { themePreference?: unknown } }
    return normalizeThemePreference(parsed.state?.themePreference)
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

export async function getStoredThemePreference(): Promise<ThemePreference> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const result = await chrome.storage.local.get(CONFIG_STORAGE_KEY)
      return readThemePreferenceFromPersistedConfig(result[CONFIG_STORAGE_KEY] as string | null | undefined)
    }

    if (typeof localStorage !== 'undefined') {
      return readThemePreferenceFromPersistedConfig(localStorage.getItem(CONFIG_STORAGE_KEY))
    }
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }

  return DEFAULT_THEME_PREFERENCE
}

export async function initializeTheme() {
  const themePreference = await getStoredThemePreference()
  applyThemePreference(themePreference)
  return themePreference
}

export function useThemePreference(themePreference: ThemePreference | null) {
  useEffect(() => {
    if (!themePreference) return

    const mediaQuery = getThemeMediaQuery()
    const applyTheme = () => applyThemePreference(themePreference, mediaQuery)

    applyTheme()

    if (themePreference !== 'system') return

    const onSchemeChange = () => {
      applyTheme()
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onSchemeChange)
      return () => mediaQuery.removeEventListener('change', onSchemeChange)
    }

    mediaQuery.addListener(onSchemeChange)
    return () => mediaQuery.removeListener(onSchemeChange)
  }, [themePreference])
}
