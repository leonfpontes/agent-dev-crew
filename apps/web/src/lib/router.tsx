// A small history router: four screens don't need a library. The local server and Vercel answer
// every app route with index.html, so /runs/142 opens directly.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

if (typeof window !== 'undefined') window.addEventListener('popstate', emit)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const snapshot = () => window.location.pathname + window.location.search

export function navigate(to: string, { replace = false }: { replace?: boolean } = {}) {
  if (to === snapshot()) return
  if (replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  emit()
  if (!replace && !to.includes('#')) window.scrollTo(0, 0)
}

export type Route =
  | { name: 'runs' }
  | { name: 'run'; id: number }
  | { name: 'playbook' }
  | { name: 'evaluation' }
  | { name: 'not-found' }

export function matchRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/' || path === '/runs') return { name: 'runs' }
  const run = /^\/runs\/(\d+)$/.exec(path)
  if (run) return { name: 'run', id: Number(run[1]) }
  if (path === '/playbook') return { name: 'playbook' }
  if (path === '/evaluation') return { name: 'evaluation' }
  return { name: 'not-found' }
}

/** The current route and query; re-renders on navigation. */
export function useLocation() {
  const current = useSyncExternalStore(subscribe, snapshot, () => '/')
  const url = new URL(current, 'http://app.local')
  return { route: matchRoute(url.pathname), pathname: url.pathname, query: url.searchParams }
}

/** Replaces one query parameter without a new history entry (null removes it). */
export function setQuery(key: string, value: string | null) {
  const url = new URL(window.location.href)
  if (value === null) url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  navigate(url.pathname + url.search, { replace: true })
}

export function Link({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    if (!href.startsWith('/')) return
    e.preventDefault()
    navigate(href)
  }
  return <a href={href} onClick={handle} {...props} />
}
