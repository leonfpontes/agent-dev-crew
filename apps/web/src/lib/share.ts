// What the landing hero and the share images (social preview, OG, README cover) say, from the API:
// the scoreboard numbers and the trace of one run. scripts/share-images.mjs writes these values
// next to the images, and tests/share-values.test.ts fails when they fall behind the sources.
import { clock, usd } from './format'
import { bestCrew, byVariant, times } from './evaluation'
import { parseDiff } from './diff'
import { stepName, stepTree } from './run'
import type { EvaluationResponse, RunDetail, StepRow } from './types'

/** The one sentence: the site's H1 = the README cover = the social preview = the OG image. */
export const PHRASE = 'A crew of AI agents takes a feature request to a tested diff. You approve the plan.'
export const SUB =
  'PO, Engineer, Reviewer and QA run as a DAG with one human gate, a cost trace for every step, and a playbook that learns from each run.'

/** The run the images and the hero show: the one with the gate, a fix loop and a retro. */
export const SHOWCASE_RUN = 142

export interface ShareNumbers {
  requests: number
  rounds: number
  oneAgent: number
  crew: number
  crewLabel: string
  costRatio: string
  exampleData: boolean
}

/** One agent against the best crew variant, as whole percents of requests passing all hidden tests. */
export function shareNumbers(data: EvaluationResponse): ShareNumbers | null {
  const one = byVariant(data.main, 'single-agent')
  const crew = bestCrew(data.main)
  if (!one || !crew) return null
  return {
    requests: data.matrix.length,
    rounds: Math.max(0, ...data.main.map((m) => m.rounds)),
    oneAgent: Math.round(one.passRate.mean * 100),
    crew: Math.round(crew.passRate.mean * 100),
    crewLabel: crew.variant === 'crew-playbook' ? 'the crew with the playbook' : 'the crew',
    costRatio: one.costMicrosPerRequest.mean
      ? times(crew.costMicrosPerRequest.mean / one.costMicrosPerRequest.mean)
      : '—',
    exampleData: data.exampleData,
  }
}

export interface CardRow {
  id: number
  name: string
  sub: string | null
  status: StepRow['status']
  kind: StepRow['kind']
  inner: boolean
  /** Bar start and width, in percent of the run. */
  left: number
  width: number
  cost: string
}

export interface ShareRun {
  id: number
  title: string
  status: string
  rows: CardRow[]
  files: number
  additions: number
  deletions: number
  tests: string | null
  cost: string
  duration: string
}

/** The run card: each step (the fix loop's steps indented, the loop itself left out) on one time axis. */
export function shareRun(detail: RunDetail): ShareRun {
  const total =
    detail.run.duration_ms ?? Math.max(...detail.steps.map((s) => (s.offset_ms ?? 0) + (s.duration_ms ?? 0)))
  const pct = (ms: number) => Math.round((ms / (total || 1)) * 1000) / 10
  const rows: CardRow[] = []
  const add = (s: StepRow, inner: boolean) => {
    if (s.offset_ms === null || s.status === 'queued' || s.status === 'skipped') return
    rows.push({
      id: s.id,
      name: stepName(s),
      sub:
        s.kind === 'gate'
          ? null
          : inner && s.kind === 'fix'
            ? `loop ${detailLoop(detail, s)} of 2`
            : s.kind === 'test'
              ? s.summary
              : null,
      status: s.status,
      kind: s.kind,
      inner,
      left: pct(s.offset_ms),
      width: Math.max(1, pct(s.duration_ms ?? 0)),
      cost: s.cost_micros ? usd(s.cost_micros) : '—',
    })
  }
  for (const { step, children } of stepTree(detail.steps)) {
    if (step.kind === 'fix-loop') children.forEach((c) => add(c, true))
    else add(step, false)
  }
  const files = parseDiff(detail.run.diff)
  return {
    id: detail.run.id,
    title: detail.run.title,
    status: detail.run.status,
    rows,
    files: files.length,
    additions: files.reduce((a, f) => a + f.additions, 0),
    deletions: files.reduce((a, f) => a + f.deletions, 0),
    tests: detail.run.tests_total === null ? null : `${detail.run.tests_passed} / ${detail.run.tests_total}`,
    cost: usd(detail.steps.reduce((a, s) => a + s.cost_micros, 0)),
    duration: clock(total),
  }
}

function detailLoop(detail: RunDetail, s: StepRow): number {
  return detail.steps.find((p) => p.id === s.parent_id)?.loop_index ?? 1
}

/** Everything an image says, for the values file and its test. */
export const shareValues = (data: EvaluationResponse, detail: RunDetail) => ({
  phrase: PHRASE,
  scoreboard: shareNumbers(data),
  run: shareRun(detail),
})
