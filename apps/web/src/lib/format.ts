// Number formats used on every screen. Numbers are always shown in IBM Plex Mono, tabular.

const MICROS = 1_000_000

/** $0.051 (3 decimals by default); totals and limits pass 2. */
export function usd(micros: number, digits = 3): string {
  return `$${(micros / MICROS).toFixed(digits)}`
}

/** "3m 52s", "0m 48s": the run clock, always minutes and seconds. */
export function clock(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}

/** "9.8 s", "12 s" under a minute; "1m 03s" from a minute up. */
export function duration(ms: number): string {
  if (ms >= 60_000) return clock(ms)
  const s = ms / 1000
  return `${Number.isInteger(s) ? s : s.toFixed(1)} s`
}

/** "22.0 s" or "1m 03s": the step panel, always with one decimal under a minute. */
export function durationFixed(ms: number): string {
  return ms >= 60_000 ? clock(ms) : `${(ms / 1000).toFixed(1)} s`
}

/** "+2m 43s", "+0.0 s": when a step started, counted from the start of the run. */
export function offset(ms: number): string {
  return `+${durationFixed(ms)}`
}

/** "31.2k", "152k", "788". */
export function tokensShort(n: number): string {
  if (n < 1000) return String(n)
  const k = n / 1000
  return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`
}

/** "4,612". */
export function tokensLong(n: number): string {
  return n.toLocaleString('en-US')
}

/** "2 min ago", "1 h ago", "Yesterday", "3 days ago". */
export function ago(iso: string, now: Date = new Date()): string {
  const diff = Math.max(0, now.getTime() - new Date(iso).getTime())
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'Yesterday' : `${d} days ago`
}

/** 0.7667 → "77%". */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`
}

/** One standard deviation of a share, in points: 0.0577 → "± 6". */
export function sdPoints(sd: number): string {
  return `± ${Math.round(sd * 100)}`
}

/** The PO's cost estimate, "$0.04". */
export function estimate(value: number): string {
  return `$${value.toFixed(2)}`
}
