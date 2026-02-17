import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const THEME_STORAGE_KEY = 'task-factory:theme-preference'
const LEGACY_THEME_STORAGE_KEY = 'task-factory:theme'
const SETTINGS_ENDPOINT = '/api/settings'

export type ThemeMode = 'light' | 'dark'
export type ThemePreference = ThemeMode | 'system'

interface ThemeContextValue {
  theme: ThemeMode
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

interface PiFactorySettings {
  theme?: unknown
  [key: string]: unknown
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function getStoredPreference(): ThemePreference | null {
  try {
    const storedPreference = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemePreference(storedPreference)) {
      return storedPreference
    }

    const legacyTheme = localStorage.getItem(LEGACY_THEME_STORAGE_KEY)
    if (isThemeMode(legacyTheme)) {
      return legacyTheme
    }

    return null
  } catch {
    return null
  }
}

function getSystemTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(preference: ThemePreference, systemTheme: ThemeMode): ThemeMode {
  return preference === 'system' ? systemTheme : preference
}

function resolveInitialPreference(): ThemePreference {
  return getStoredPreference() ?? 'system'
}

function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = theme
}

export function initializeTheme(): void {
  if (typeof document === 'undefined') {
    return
  }

  const preference = resolveInitialPreference()
  const theme = resolveTheme(preference, getSystemTheme())
  applyTheme(theme)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => resolveInitialPreference())
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() => getSystemTheme())
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const lastSyncedPreferenceRef = useRef<ThemePreference | null>(null)

  const theme = useMemo(() => resolveTheme(preference, systemTheme), [preference, systemTheme])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    const handleChange = () => {
      setSystemTheme(mediaQuery.matches ? 'dark' : 'light')
    }

    handleChange()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    mediaQuery.addListener(handleChange)
    return () => mediaQuery.removeListener(handleChange)
  }, [])

  useEffect(() => {
    applyTheme(theme)

    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      // Ignore localStorage failures (private mode/quota/etc)
    }
  }, [theme, preference])

  useEffect(() => {
    let cancelled = false

    const loadRemotePreference = async () => {
      try {
        const response = await fetch(SETTINGS_ENDPOINT)
        if (!response.ok) {
          return
        }

        const settings = await response.json() as PiFactorySettings
        const remotePreference = settings.theme
        if (!isThemePreference(remotePreference)) {
          return
        }

        lastSyncedPreferenceRef.current = remotePreference
        if (!cancelled) {
          setPreferenceState(remotePreference)
        }
      } catch {
        // Ignore settings load failures and keep local preference.
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true)
        }
      }
    }

    loadRemotePreference().catch(() => {
      // No-op; handled above.
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!settingsLoaded) {
      return
    }

    if (lastSyncedPreferenceRef.current === preference) {
      return
    }

    let cancelled = false

    const saveRemotePreference = async () => {
      try {
        const loadResponse = await fetch(SETTINGS_ENDPOINT)
        const currentSettings = loadResponse.ok
          ? await loadResponse.json() as PiFactorySettings
          : {}

        const nextSettings: PiFactorySettings = {
          ...currentSettings,
          theme: preference,
        }

        const saveResponse = await fetch(SETTINGS_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextSettings),
        })

        if (!saveResponse.ok) {
          throw new Error(`Failed to persist theme preference (${saveResponse.status})`)
        }

        if (!cancelled) {
          lastSyncedPreferenceRef.current = preference
        }
      } catch (error) {
        console.error('Failed to persist theme preference:', error)
      }
    }

    saveRemotePreference().catch(() => {
      // No-op; handled above.
    })

    return () => {
      cancelled = true
    }
  }, [preference, settingsLoaded])

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    setPreferenceState(nextPreference)
  }, [])

  const setTheme = useCallback((nextTheme: ThemeMode) => {
    setPreferenceState(nextTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setPreferenceState((currentPreference) => {
      const resolvedTheme = resolveTheme(currentPreference, systemTheme)
      return resolvedTheme === 'light' ? 'dark' : 'light'
    })
  }, [systemTheme])

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    preference,
    setPreference,
    setTheme,
    toggleTheme,
  }), [theme, preference, setPreference, setTheme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }

  return context
}
