// What the landing hero and the share images (social preview, OG, README cover) say, from the API:
// the scoreboard numbers and the trace of one run. scripts/share-images.mjs writes these values
// next to the images, and tests/share-values.test.ts fails when they fall behind the sources.
import { clock, usd } from './format'
import { leadSet, setNumbers, type ScoreSet } from './scoreboards'
import { parseDiff } from './diff'
import { stepName, stepTree } from './run'
import type { RunDetail, StepRow } from './types'

/** The one sentence: the site's H1 = the README cover = the social preview = the OG image. */
export const PHRASE = 'A crew of AI agents takes a feature request to a tested diff. You approve the plan.'
export const SUB =
  'PO, Engineer, Reviewer and QA run as a DAG with one human gate, a cost trace for every step, and a playbook of rules you approve.'

/** The run the images and the hero show: the one with the gate, a fix loop and a retro. */
export const SHOWCASE_RUN = 142

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
export const shareValues = (sets: ScoreSet[], detail: RunDetail) => ({
  phrase: PHRASE,
  scoreboard: leadSet(sets) ? setNumbers(leadSet(sets)!) : null,
  run: shareRun(detail),
})
