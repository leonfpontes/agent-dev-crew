// The scoreboards in evals/results/ (one per request set), read when the app is built. The public
// page, the share images and the video quote them; the hard set leads, because it is the stronger
// test. Only the fields the pages use are imported, so the run rows stay out of the bundle.
import { compareSentence, costShare, times, verdict, type Verdict } from './evaluation'
import type { Variant } from './types'

export type RequestSet = 'easy' | 'hard'

interface Stat {
  mean: number
  sd: number
}

export interface SetVariant {
  variant: Variant
  playbookVersion: number | null
  passRate: Stat
  costUsdPerRequest: Stat
  secondsPerRequest: Stat
  fixLoopsPerRequest: Stat
}

export interface ScoreSet {
  set: RequestSet
  file: string
  requests: number
  rounds: number
  model: string
  runAt: string
  main: SetVariant[]
  notes: string[]
}

// Vite needs each glob's options written out: one per field.
const FIELDS: Record<string, Record<string, unknown>> = {
  set: import.meta.glob('@repo/evals/results/*.json', { eager: true, import: 'set' }),
  requests: import.meta.glob('@repo/evals/results/*.json', { eager: true, import: 'requests' }),
  rounds: import.meta.glob('@repo/evals/results/*.json', { eager: true, import: 'rounds' }),
  model: import.meta.glob('@repo/evals/results/*.json', { eager: true, import: 'model' }),
  runAt: import.meta.glob('@repo/evals/results/*.json', { eager: true, import: 'runAt' }),
  main: import.meta.glob('@repo/evals/results/*.json', { eager: true, import: 'main' }),
  notes: import.meta.glob('@repo/evals/results/*.json', { eager: true, import: 'notes' }),
}

/** Every scoreboard, hard first. `files` lets tests pass their own. */
export function scoreSets(files: Record<string, Partial<Omit<ScoreSet, 'file'>>> = collect()): ScoreSet[] {
  return Object.entries(files)
    .map(([file, r]) => ({
      set: r.set === 'hard' ? ('hard' as const) : ('easy' as const),
      file: file.slice(file.indexOf('evals/results/')),
      requests: r.requests ?? 0,
      rounds: r.rounds ?? 0,
      model: r.model ?? '',
      runAt: r.runAt ?? '',
      main: r.main ?? [],
      notes: r.notes ?? [],
    }))
    .sort((a, b) => (a.set === b.set ? 0 : a.set === 'hard' ? -1 : 1))
}

function collect(): Record<string, Partial<Omit<ScoreSet, 'file'>>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [field, files] of Object.entries(FIELDS))
    for (const [file, value] of Object.entries(files)) (out[file] ??= {})[field] = value
  return out as Record<string, Partial<Omit<ScoreSet, 'file'>>>
}

export const SET_LABEL: Record<RequestSet, string> = { hard: 'hard set', easy: 'easy set' }

const by = (s: ScoreSet, v: Variant) => s.main.find((m) => m.variant === v)

/** The crew variant with the most requests passing (the cheaper one on a tie). */
export const bestCrewOf = (s: ScoreSet) =>
  s.main
    .filter((m) => m.variant !== 'single-agent')
    .sort(
      (a, b) => b.passRate.mean - a.passRate.mean || a.costUsdPerRequest.mean - b.costUsdPerRequest.mean,
    )[0]

export interface SetNumbers {
  set: RequestSet
  requests: number
  rounds: number
  oneAgent: number
  crew: number
  crewLabel: string
  costRatio: string
  /** Who did better, by the ± rule; with "one", oneCost says "half" (at half the cost). */
  verdict: Verdict
  oneCost: string
}

/** One agent against the best crew variant of a set, in whole percents of requests passing. */
export function setNumbers(s: ScoreSet): SetNumbers | null {
  const one = by(s, 'single-agent')
  const crew = bestCrewOf(s)
  if (!one || !crew) return null
  return {
    set: s.set,
    requests: s.requests,
    rounds: s.rounds,
    oneAgent: Math.round(one.passRate.mean * 100),
    crew: Math.round(crew.passRate.mean * 100),
    crewLabel: crew.variant === 'crew-playbook' ? 'the crew with the playbook' : 'the crew',
    costRatio: one.costUsdPerRequest.mean
      ? times(crew.costUsdPerRequest.mean / one.costUsdPerRequest.mean)
      : '—',
    verdict: verdict(one.passRate, crew.passRate),
    oneCost: crew.costUsdPerRequest.mean
      ? costShare(one.costUsdPerRequest.mean / crew.costUsdPerRequest.mean)
      : '—',
  }
}

/** The set's sentence: one agent against the best crew variant (see compareSentence). */
export function setHeadline(s: ScoreSet): string | null {
  const one = by(s, 'single-agent')
  const crew = bestCrewOf(s)
  if (!one || !crew) return null
  return compareSentence(
    { pass: one.passRate, cost: one.costUsdPerRequest.mean },
    {
      pass: crew.passRate,
      cost: crew.costUsdPerRequest.mean,
      who: crew.variant === 'crew-playbook' ? 'the crew with the playbook' : 'the crew',
    },
    s.set,
  )
}

/** The set the share images and the video quote: the hard set when there is one. */
export const leadSet = (sets: ScoreSet[] = scoreSets()) => sets[0]
