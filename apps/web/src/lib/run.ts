// The Run detail view model: step names, the pipeline nodes, the Gantt rows and the replay clock,
// all derived from the steps and the timeline the API returns. Pure functions, tested on their own.
import { stepVisual, type Visual } from '../components/Status'
import type { EventRow, Plan, Role, RunDetail, StepRow, Timeline } from './types'

export const MAX_FIX_LOOPS = 2

export const ROLE_LABEL: Record<Role, string> = {
  po: 'PO',
  engineer: 'Engineer',
  reviewer: 'Reviewer',
  qa: 'QA',
}

/** Short names for the stacked cost bar, in pipeline order. */
export const PART_LABEL: [string, string][] = [
  ['po', 'PO'],
  ['engineer', 'Eng'],
  ['reviewer', 'Rev'],
  ['qa', 'QA'],
  ['retro', 'Retro'],
  ['solo', 'Agent'],
]

export function stepName(s: StepRow): string {
  switch (s.kind) {
    case 'plan':
      return 'PO · plan'
    case 'gate':
      return 'Human gate'
    case 'code':
      return 'Engineer · code'
    case 'review':
      return 'Reviewer · review'
    case 'test':
      return 'QA · test'
    case 'fix-loop':
      return s.loop_index ? `Fix loop ${s.loop_index}` : 'Fix loop'
    case 'fix':
      return 'Engineer · fix'
    case 'retro':
      return 'Retro · lessons'
    case 'solo':
      return 'Single agent'
  }
}

/** The playbook section a step reads, for the "§ Engineer" link. */
export const sectionOf = (s: StepRow) => (s.role ? ROLE_LABEL[s.role] : null)

export const tokensIn = (s: Pick<StepRow, 'input_tokens' | 'cache_read_tokens' | 'cache_write_tokens'>) =>
  s.input_tokens + s.cache_read_tokens + s.cache_write_tokens
export const tokensAll = (s: StepRow) => tokensIn(s) + s.output_tokens

export interface TreeStep {
  step: StepRow
  children: StepRow[]
}

/** Top-level steps in order, each fix loop with its fix and test steps. */
export function stepTree(steps: StepRow[]): TreeStep[] {
  const top = steps.filter((s) => s.parent_id === null)
  return top.map((step) => ({ step, children: steps.filter((s) => s.parent_id === step.id) }))
}

/** How long the run has lasted: its duration when finished, else the time since it started. */
export function runTotal(detail: RunDetail, now: number): number {
  if (detail.run.duration_ms !== null) return detail.run.duration_ms
  const started = new Date(detail.run.started_at).getTime()
  const fromSteps = Math.max(0, ...detail.steps.map((s) => (s.offset_ms ?? 0) + (s.duration_ms ?? 0)))
  return Math.max(fromSteps, now - started)
}

/** Start and length of each step: from the timeline when there is one, else from the step rows. */
export interface Span {
  start: number
  end: number
}

export function spans(steps: StepRow[], total: number, timeline?: Timeline): Map<number, Span> {
  const out = new Map<number, Span>()
  for (const s of steps) {
    if (s.offset_ms === null) continue
    const open = s.duration_ms === null && (s.status === 'running' || s.status === 'waiting')
    out.set(s.id, { start: s.offset_ms, end: open ? total : s.offset_ms + (s.duration_ms ?? 0) })
  }
  for (const e of timeline?.events ?? []) {
    if (e.step_id === null) continue
    const span = out.get(e.step_id)
    if (!span) continue
    if (e.kind === 'step.started') span.start = e.offset_ms
    if (e.kind === 'step.finished') span.end = e.offset_ms
  }
  return out
}

export type BarKind = 'p' | 'f' | 'g' | 'l' | 'r' | 'run'

export function barKind(s: StepRow, status = s.status): BarKind | null {
  if (s.kind === 'gate') return status === 'queued' || status === 'skipped' ? null : 'g'
  if (s.kind === 'fix-loop') return 'l'
  if (status === 'running') return 'run'
  if (s.kind === 'retro' && status === 'passed') return 'r'
  if (status === 'passed') return 'p'
  if (status === 'failed') return 'f'
  return null
}

/**
 * A step's status at replay time `t`: what it ended with once its span is over, running (or waiting,
 * for the gate) while inside it, and queued before it starts. Without `t`, the recorded status.
 */
export function statusAt(s: StepRow, span: Span | undefined, t?: number): StepRow['status'] {
  if (t === undefined || !span) return s.status
  if (t >= span.end && s.status !== 'running' && s.status !== 'waiting') return s.status
  if (t >= span.start) return s.kind === 'gate' ? 'waiting' : s.kind === 'fix-loop' ? 'fix-loop' : 'running'
  return 'queued'
}

export interface PipeNode {
  key: 'po' | 'gate' | 'engineer' | 'reviewer' | 'qa' | 'solo' | 'retro'
  label: string
  visual: Visual
  durationMs: number | null
  costMicros: number
  steps: StepRow[]
}

const NODE_KINDS: { key: PipeNode['key']; label: string; match: (s: StepRow) => boolean }[] = [
  { key: 'po', label: 'PO', match: (s) => s.kind === 'plan' },
  { key: 'gate', label: 'Human gate', match: (s) => s.kind === 'gate' },
  { key: 'engineer', label: 'Engineer', match: (s) => s.kind === 'code' || s.kind === 'fix' },
  { key: 'reviewer', label: 'Reviewer', match: (s) => s.kind === 'review' },
  { key: 'qa', label: 'QA', match: (s) => s.kind === 'test' },
  { key: 'solo', label: 'Single agent', match: (s) => s.kind === 'solo' },
]

function nodeVisual(statuses: StepRow['status'][]): Visual {
  if (statuses.includes('running')) return 'running'
  if (statuses.includes('waiting')) return 'waiting'
  const last = statuses.filter((s) => s !== 'queued').at(-1)
  return last ? stepVisual(last) : 'queued'
}

/**
 * The pipeline as nodes (ref. GitHub Actions run graph): one per role, the Engineer and QA nodes
 * summing their attempts, and the Retro after the run. `statusOf` lets the replay show each step
 * as it was at a moment of the run.
 */
export function pipeline(
  steps: StepRow[],
  statusOf: (s: StepRow) => StepRow['status'] = (s) => s.status,
  lengthOf: (s: StepRow) => number | null = (s) => s.duration_ms,
): { nodes: PipeNode[]; retro: PipeNode | null; loops: number } {
  const leaf = steps.filter((s) => s.kind !== 'fix-loop')
  const make = (key: PipeNode['key'], label: string, mine: StepRow[]): PipeNode => {
    const statuses = mine.map(statusOf)
    const lengths = mine.map(lengthOf).filter((d): d is number => d !== null)
    const started = statuses.some((s) => s !== 'queued' && s !== 'skipped')
    return {
      key,
      label,
      visual: nodeVisual(statuses),
      durationMs: started && lengths.length ? lengths.reduce((a, b) => a + b, 0) : null,
      costMicros: mine
        .filter((s) => !['queued', 'running', 'waiting'].includes(statusOf(s)))
        .reduce((a, s) => a + s.cost_micros, 0),
      steps: mine,
    }
  }
  const nodes = NODE_KINDS.map((k) => ({ k, mine: leaf.filter(k.match) }))
    .filter(({ mine }) => mine.length > 0)
    .map(({ k, mine }) => make(k.key, k.label, mine))
  const retroSteps = leaf.filter((s) => s.kind === 'retro')
  return {
    nodes,
    retro: retroSteps.length ? make('retro', 'Retro', retroSteps) : null,
    loops: steps.filter((s) => s.kind === 'fix-loop' && statusOf(s) !== 'queued').length,
  }
}

/** The step a reader wants first: the newest one with a recorded model call, else the first. */
export function defaultStep(detail: RunDetail, timeline?: Timeline): number | undefined {
  const plan = detail.steps.find((s) => s.kind === 'plan')
  if (detail.run.status === 'waiting' && plan) return plan.id
  const recorded = new Set(
    (timeline?.events ?? []).filter((e) => e.kind === 'model.request').map((e) => e.step_id),
  )
  const withCall = [...detail.steps].reverse().find((s) => recorded.has(s.id))
  return (withCall ?? detail.steps[0])?.id
}

/** The PO plan: from the gate while it waits live, else from the PO step's recorded response. */
export function planFrom(detail: RunDetail, planEvents?: EventRow[]): Plan | null {
  if (detail.gate.plan) return detail.gate.plan
  const response = planEvents?.find((e) => e.kind === 'model.response')?.payload as
    { plan?: Plan } | undefined
  return response?.plan ?? null
}

export interface ToolCall {
  tool: string
  input: unknown
  ok?: boolean
  output?: unknown
  durationMs?: number
}

/** Tool calls of a step, each with the result that followed it. */
export function toolCalls(events: EventRow[]): ToolCall[] {
  const calls: ToolCall[] = []
  const open: { call: ToolCall; at: number }[] = []
  for (const e of events) {
    const p = e.payload as { tool?: string; input?: unknown; ok?: boolean; output?: unknown }
    if (e.kind === 'tool.call') {
      const call: ToolCall = { tool: p.tool ?? 'tool', input: p.input }
      calls.push(call)
      open.push({ call, at: e.offset_ms })
    } else if (e.kind === 'tool.result') {
      const i = open.findIndex((o) => o.call.tool === p.tool)
      if (i >= 0) {
        const [{ call, at }] = open.splice(i, 1) as [{ call: ToolCall; at: number }]
        Object.assign(call, { ok: p.ok, output: p.output, durationMs: e.offset_ms - at })
      } else calls.push({ tool: p.tool ?? 'tool', input: undefined, ok: p.ok, output: p.output })
    }
  }
  return calls
}

/** A tool call's main argument, shown next to its name (`read_file src/routes/orders.ts`). */
export function toolArg(call: ToolCall): string {
  const input = call.input as Record<string, unknown> | undefined
  if (!input) return ''
  const v = input.path ?? input.command ?? Object.values(input)[0]
  return typeof v === 'string' ? v : ''
}

export const json = (value: unknown) => JSON.stringify(value, null, 2)
