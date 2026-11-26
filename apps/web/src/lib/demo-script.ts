// The README GIF (about 20 s) and the 1-minute video: the scenes on one clock and the captions
// (English, one line, at most 70 characters, at least 2.5 s on screen). Numbers in captions come
// from the scoreboard and the replay run; scripts/record-demo.mjs writes the captions it used to
// docs/media/crew-demo.numbers.json, and a test fails when they fall behind.
import { leadSet, SET_LABEL, setNumbers, type ScoreSet } from './scoreboards'
import type { RunDetail } from './types'

export type SceneId = 'problem' | 'runs' | 'terminal' | 'gate' | 'trace' | 'diff' | 'retro' | 'number'

export interface Scene {
  id: SceneId
  from: number
  to: number
}

export interface Caption {
  from: number
  to: number
  text: string
}

export const VIDEO_MS = 60_000
export const GIF_MS = 20_000

export const VIDEO_SCENES: Scene[] = [
  { id: 'problem', from: 0, to: 5_000 },
  { id: 'runs', from: 5_000, to: 10_000 },
  { id: 'terminal', from: 10_000, to: 18_000 },
  { id: 'trace', from: 18_000, to: 30_000 },
  { id: 'diff', from: 30_000, to: 40_000 },
  { id: 'retro', from: 40_000, to: 50_000 },
  { id: 'number', from: 50_000, to: 60_000 },
]

export const GIF_SCENES: Scene[] = [
  { id: 'terminal', from: 0, to: 3_000 },
  { id: 'gate', from: 3_000, to: 6_000 },
  { id: 'trace', from: 6_000, to: 11_000 },
  { id: 'diff', from: 11_000, to: 15_000 },
  { id: 'retro', from: 15_000, to: 20_000 },
]

/** The caption of the last video scene: the scoreboard in one line. */
export function numberCaption(sets: ScoreSet[]): string {
  const lead = leadSet(sets)
  const n = lead ? setNumbers(lead) : null
  if (!n) return 'Run pnpm eval to measure the crew against one agent.'
  const label = SET_LABEL[n.set].charAt(0).toUpperCase() + SET_LABEL[n.set].slice(1)
  return n.verdict === 'one'
    ? `${label}: one agent ${n.oneAgent}%, crew ${n.crew}%, at ${n.oneCost} the cost.`
    : `${label}: one agent ${n.oneAgent}%, crew ${n.crew}%. The crew costs ${n.costRatio} as much.`
}

export function hiddenCaption(run: RunDetail): string {
  const { hidden_passed: p, hidden_total: t } = run.run
  return t === null
    ? 'A tested diff, with the tests QA wrote.'
    : `A tested diff: ${p} of ${t} hidden tests pass.`
}

export function videoCaptions(sets: ScoreSet[]): Caption[] {
  return [
    { from: 0, to: 5_000, text: 'Coding agents write code. Who checks the plan, the cost and the tests?' },
    {
      from: 5_000,
      to: 10_000,
      text: 'Agent Dev Crew runs a team of agents and keeps a trace of every step.',
    },
    { from: 10_000, to: 18_000, text: 'You approve the plan, or ask for changes, before any code.' },
    { from: 18_000, to: 30_000, text: 'Every step shows its prompt, tools, tokens, cost and time.' },
    { from: 30_000, to: 40_000, text: 'Hidden tests, never shown to the agents, decide if it passed.' },
    {
      from: 40_000,
      to: 50_000,
      text: 'A run can propose a rule. It joins the playbook only if you approve.',
    },
    { from: 50_000, to: 60_000, text: numberCaption(sets) },
  ]
}

export function gifCaptions(run: RunDetail): Caption[] {
  return [
    { from: 0, to: 3_000, text: 'One feature request in.' },
    { from: 3_000, to: 6_000, text: 'You approve the plan. Nothing runs before that.' },
    { from: 6_000, to: 11_000, text: 'Engineer, Reviewer and QA. QA sends it back once.' },
    { from: 11_000, to: 15_000, text: hiddenCaption(run) },
    {
      from: 15_000,
      to: 20_000,
      text: 'A run can propose a rule. It joins the playbook only if you approve.',
    },
  ]
}

export const sceneAt = (scenes: Scene[], t: number) =>
  scenes.find((s) => t >= s.from && t < s.to) ?? scenes[scenes.length - 1]!

/** 0 at the start of the scene, 1 at its end. */
export const progress = (scene: Scene, t: number) =>
  Math.min(1, Math.max(0, (t - scene.from) / (scene.to - scene.from)))
