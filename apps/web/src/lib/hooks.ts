import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'crew-theme'

/** The theme in the address (?dark, ?theme=dark|light) wins, then the saved choice, then the system. */
export function initialTheme(): Theme {
  const q = new URLSearchParams(window.location.search)
  if (q.has('dark') || q.get('theme') === 'dark') return 'dark'
  if (q.has('light') || q.get('theme') === 'light') return 'light'
  const saved = window.localStorage.getItem(KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = initialTheme()
    applyTheme(t)
    return t
  })
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      window.localStorage.setItem(KEY, next)
      return next
    })
  }, [])
  return { theme, toggle }
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia?.(query)
      m?.addEventListener('change', cb)
      return () => m?.removeEventListener('change', cb)
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  )
}

/** Phones: the layout breakpoint of the design (760 px). */
export const PHONE = '(max-width: 760px)'
export const useIsPhone = () => useMediaQuery(PHONE)
export const useReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')

/** Sets the document title for a screen. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}
