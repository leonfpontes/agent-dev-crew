// The Run detail view model, on the runs of the replay seed through the real API handler.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { getJson } from './api'
import {
  barKind,
  defaultStep,
  pipeline,
  planFrom,
  spans,
  statusAt,
  stepName,
  stepTree,
  toolArg,
  toolCalls,
} from './run'
import type { EventRow, RunDetail, Timeline } from './types'
import { installApi } from '../test/api'

let run142: RunDetail
let run143: RunDetail
let timeline142: Timeline

beforeAll(async () => {
  installApi()
  run142 = await getJson<RunDetail>('/api/runs/142')
  run143 = await getJson<RunDetail>('/api/runs/143')
  timeline142 = await getJson<Timeline>('/api/runs/142/timeline')
})
beforeEach(() => {
  installApi()
})

describe('the pipeline of a run', () => {
  it('has one node per role, the Engineer and QA summing their attempts, and the Retro after', () => {
    const { nodes, retro, loops } = pipeline(run142.steps)
    expect(nodes.map((n) => n.label)).toEqual(['PO', 'Human gate', 'Engineer', 'Reviewer', 'QA'])
    const eng = nodes.find((n) => n.key === 'engineer')!
    const code = run142.steps.filter((s) => s.kind === 'code' || s.kind === 'fix')
    expect(eng.durationMs).toBe(code.reduce((a, s) => a + (s.duration_ms ?? 0), 0))
    expect(eng.costMicros).toBe(code.reduce((a, s) => a + s.cost_micros, 0))
    expect(eng.visual).toBe('passed')
    expect(nodes.find((n) => n.key === 'gate')!.visual).toBe('approved')
    expect(retro?.label).toBe('Retro')
    expect(loops).toBe(run142.steps.filter((s) => s.kind === 'fix-loop').length)
  })

  it('shows a waiting gate and the queued steps after it', () => {
    const { nodes } = pipeline(run143.steps)
    expect(nodes.find((n) => n.key === 'gate')!.visual).toBe('waiting')
    expect(nodes.find((n) => n.key === 'engineer')!.visual).toBe('queued')
    expect(nodes.find((n) => n.key === 'engineer')!.durationMs).toBeNull()
  })

  it('groups the fix loop with its steps, and names every step', () => {
    const tree = stepTree(run142.steps)
    const loop = tree.find((t) => t.step.kind === 'fix-loop')!
    expect(loop.children.map(({ kind }) => kind)).toEqual(['fix', 'test'])
    expect(tree.map((t) => stepName(t.step))).toContain('Retro · lessons')
    expect(stepName(loop.step)).toMatch(/^Fix loop \d$/)
  })
})

describe('the replay clock', () => {
  it('takes spans from the timeline and shows each step as it was at a moment', () => {
    const map = spans(run142.steps, run142.run.duration_ms!, timeline142)
    const code = run142.steps.find((s) => s.kind === 'code')!
    const span = map.get(code.id)!
    expect(statusAt(code, span, span.start - 1)).toBe('queued')
    expect(statusAt(code, span, span.start + 1)).toBe('running')
    expect(statusAt(code, span, span.end)).toBe('passed')
    expect(statusAt(code, span)).toBe('passed')
    const gate = run142.steps.find((s) => s.kind === 'gate')!
    expect(statusAt(gate, map.get(gate.id), map.get(gate.id)!.start + 1)).toBe('waiting')
  })

  it('draws each kind of step with its own bar', () => {
    const kinds = Object.fromEntries(run142.steps.map((s) => [s.kind, barKind(s)]))
    expect(kinds).toMatchObject({ plan: 'p', gate: 'g', 'fix-loop': 'l', retro: 'r' })
    const failed = run142.steps.find((s) => s.status === 'failed')!
    expect(barKind(failed)).toBe('f')
  })
})

describe('the step a reader sees first', () => {
  it('is the newest step with a recorded model call, or the plan while the gate waits', () => {
    const id = defaultStep(run142, timeline142)
    expect(run142.steps.find((s) => s.id === id)?.kind).toBe('fix')
    const plan = run143.steps.find((s) => s.kind === 'plan')!
    expect(defaultStep(run143)).toBe(plan.id)
  })

  it('reads the plan from the PO step when the gate holds none (replay)', async () => {
    const plan = run143.steps.find((s) => s.kind === 'plan')!
    const { events } = await getJson<{ events: EventRow[] }>(`/api/runs/143/steps/${plan.id}/events`)
    expect(planFrom(run143, events)?.steps.length).toBeGreaterThan(0)
    expect(planFrom(run143, [])).toBeNull()
  })

  it('pairs each tool call with its result', async () => {
    const fix = run142.steps.find((s) => s.kind === 'fix')!
    const { events } = await getJson<{ events: EventRow[] }>(`/api/runs/142/steps/${fix.id}/events`)
    const calls = toolCalls(events)
    expect(calls.map((c) => c.tool)).toEqual(['read_file', 'read_file', 'write_file', 'run_tests'])
    expect(calls.every((c) => c.ok)).toBe(true)
    expect(toolArg(calls[0]!)).toBe('src/routes/orders.ts')
    expect(toolArg(calls[3]!)).toBe('vitest run')
  })
})
