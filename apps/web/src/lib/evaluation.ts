// The Evaluation view model. Every number comes from /api/evaluation; nothing here is typed by hand.
import type { EvaluationResponse, MatrixRow, Variant, VariantStats } from './types'
import { VARIANTS } from './types'

export const byVariant = (stats: VariantStats[], v: Variant) => stats.find((s) => s.variant === v)

/** "2×", "1.5×": how many times the cost of one agent. */
export function times(ratio: number): string {
  const r = Math.round(ratio * 10) / 10
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}×`
}

/**
 * The headline sentence, written from the numbers whichever way they fall: the crew ahead, a tie,
 * or one agent ahead. Null when the scoreboard lacks one of the two variants it compares.
 */
export function headline(data: EvaluationResponse): string | null {
  const one = byVariant(data.main, 'single-agent')
  const crew = byVariant(data.main, 'crew-playbook') ?? byVariant(data.main, 'crew')
  if (!one || !crew) return null
  const who = crew.variant === 'crew-playbook' ? 'the crew with the playbook' : 'the crew'
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const a = Math.round(one.passRate.mean * 100)
  const b = Math.round(crew.passRate.mean * 100)
  const ratio = one.costMicrosPerRequest.mean
    ? crew.costMicrosPerRequest.mean / one.costMicrosPerRequest.mean
    : 0
  const Who = who.charAt(0).toUpperCase() + who.slice(1)
  const as = ratio ? `${times(ratio)} as much` : ''
  // passRate is the share of requests whose hidden tests all passed.
  if (b > a)
    return `${Who} passes the hidden tests on ${pct(crew.passRate.mean)} of the requests vs ${pct(one.passRate.mean)} for one agent${ratio ? `, at ${times(ratio)} the cost` : ''}.`
  if (b === a)
    return `One agent and ${who} both pass the hidden tests on ${pct(one.passRate.mean)} of the requests${as ? `; the crew costs ${as}` : ''}.`
  return `One agent passes the hidden tests on ${pct(one.passRate.mean)} of the requests vs ${pct(crew.passRate.mean)} for ${who}${as ? `, which costs ${as}` : ''}.`
}

/** Digits for a set of costs per request: 4 when one is under a cent, so $0.0054 doesn't read $0.005. */
export const costDigits = (micros: number[]) => (micros.some((m) => m > 0 && m < 10_000) ? 4 : 3)

export function scope(data: EvaluationResponse) {
  const rounds = Math.max(0, ...data.main.map((m) => m.rounds))
  const hidden = data.matrix.map((m) => m.hiddenTests)
  return {
    requests: data.matrix.length,
    variants: data.main.length,
    rounds,
    minHidden: hidden.length ? Math.min(...hidden) : 0,
    maxHidden: hidden.length ? Math.max(...hidden) : 0,
    mainMicros: data.main.reduce((a, m) => a + m.costMicros, 0),
    curveMicros: data.learningCurve.variants.reduce((a, m) => a + m.costMicros, 0),
    costMicros:
      data.main.reduce((a, m) => a + m.costMicros, 0) +
      data.learningCurve.variants.reduce((a, m) => a + m.costMicros, 0),
  }
}

export type SortKey = 'order' | 'disagree' | 'weak' | 'hidden'
export const SORTS: { id: SortKey; label: string }[] = [
  { id: 'order', label: 'Request order' },
  { id: 'disagree', label: 'Most disagreement first' },
  { id: 'weak', label: 'Crew + playbook: weakest first' },
  { id: 'hidden', label: 'Most hidden tests first' },
]

export const passes = (row: MatrixRow, v: Variant) => (row.results[v] ?? []).filter(Boolean).length

/** Spread between the variants on one request, in rounds passed. */
export function spread(row: MatrixRow): number {
  const n = VARIANTS.filter((v) => row.results[v]).map((v) => passes(row, v))
  return n.length ? Math.max(...n) - Math.min(...n) : 0
}

export function sortRows(rows: MatrixRow[], key: SortKey): MatrixRow[] {
  const indexed = rows.map((row, i) => ({ row, i }))
  const score: Record<SortKey, (x: { row: MatrixRow; i: number }) => number> = {
    order: (x) => x.i,
    disagree: (x) => -spread(x.row) * 1000 + x.i,
    weak: (x) => passes(x.row, 'crew-playbook') * 1000 + x.i,
    hidden: (x) => -x.row.hiddenTests * 1000 + x.i,
  }
  return indexed.sort((a, b) => score[key](a) - score[key](b)).map((x) => x.row)
}

/** Which variant has the best value of a metric: the highest share passing, the lowest of the rest. */
export function bestOf(
  stats: VariantStats[],
  pick: (s: VariantStats) => number | null,
  higher = false,
): Variant | null {
  const values = stats
    .map((s) => ({ v: s.variant, x: pick(s) }))
    .filter((e): e is { v: Variant; x: number } => e.x !== null)
  if (values.length < 2) return null
  const best = values.reduce((a, b) => ((higher ? b.x > a.x : b.x < a.x) ? b : a))
  return values.filter((e) => e.x === best.x).length > 1 ? null : best.v
}

/** A round step for an axis that covers `max`: 0.06 for 0.046, 0.3 for 0.21. */
export function niceMax(max: number): number {
  if (max <= 0) return 1
  const exp = 10 ** Math.floor(Math.log10(max))
  const m = max / exp
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 3 ? 3 : m <= 5 ? 5 : m <= 6 ? 6 : 10
  return nice * exp
}

export interface LabelIn {
  x: number
  y: number
  text: string
}
export interface LabelOut {
  x: number
  y: number
  anchor: 'start' | 'middle' | 'end'
}

/** Rough width of a 12 px IBM Plex Sans label in SVG units. */
export const labelWidth = (text: string) => text.length * 6.4

/**
 * Places one label per mark so labels never cover each other or another mark: above, below, right
 * or left of its mark, the first that fits inside the plot; then further below, step by step.
 */
export function placeLabels(
  marks: LabelIn[],
  plot = { left: 60, right: 580, top: 12, bottom: 232 },
): LabelOut[] {
  type Box = { l: number; r: number; t: number; b: number }
  const taken: Box[] = marks.map((m) => ({ l: m.x - 9, r: m.x + 9, t: m.y - 9, b: m.y + 9 }))
  const hit = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
  const box = (x: number, y: number, w: number, anchor: LabelOut['anchor']): Box => {
    const l = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2
    return { l, r: l + w, t: y - 11, b: y + 3 }
  }
  return marks.map((m) => {
    const w = labelWidth(m.text)
    const clampX = (x: number) => Math.min(Math.max(x, plot.left + w / 2), plot.right - w / 2)
    const tries: LabelOut[] = [
      { x: clampX(m.x), y: m.y - 16, anchor: 'middle' },
      { x: clampX(m.x), y: m.y + 26, anchor: 'middle' },
      { x: m.x + 16, y: m.y + 4, anchor: 'start' },
      { x: m.x - 16, y: m.y + 4, anchor: 'end' },
      ...[1, 2, 3, 4].map((k): LabelOut => ({ x: clampX(m.x), y: m.y + 26 + k * 16, anchor: 'middle' })),
      ...[1, 2, 3].map((k): LabelOut => ({ x: clampX(m.x), y: m.y - 16 - k * 16, anchor: 'middle' })),
    ]
    const fits = (o: LabelOut) => {
      const b = box(o.x, o.y, w, o.anchor)
      return (
        b.l >= plot.left - 40 &&
        b.r <= plot.right + 10 &&
        b.t >= plot.top &&
        b.b <= plot.bottom &&
        !taken.some((t) => hit(t, b))
      )
    }
    const pick = tries.find(fits) ?? tries[1]!
    taken.push(box(pick.x, pick.y, w, pick.anchor))
    return pick
  })
}

/** An axis value with as many decimals as it needs, at least 2: 0.03 → "0.03", 0.015 → "0.015". */
export function tick(v: number): string {
  let d = 2
  while (d < 5 && Math.abs(Number(v.toFixed(d)) - v) > 1e-9) d++
  return v.toFixed(d)
}
