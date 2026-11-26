import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'

import { approveByPolicy, ScriptedProvider, toolUse } from '@crew/engine'
import { migrate, openTrace } from '@crew/trace'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createApi,
  createLiveRunner,
  HOW_TO_RUN_LIVE,
  liveAvailability,
  openReplay,
  WebGate,
} from './index.js'

const ROOT = (() => {
  let dir = path.dirname(new URL(import.meta.url).pathname)
  while (!existsSync(path.join(dir, 'pnpm-workspace.yaml'))) dir = path.dirname(dir)
  return dir
})()

// API answers are read field by field in the assertions; their shapes are checked by value.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

const get = async (api: (r: Request) => Promise<Response>, url: string) => {
  const res = await api(new Request(`http://127.0.0.1:8787${url}`))
  return { status: res.status, body: (await res.json()) as Json }
}
const post = async (
  api: (r: Request) => Promise<Response>,
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) => {
  const res = await api(
    new Request(`http://127.0.0.1:8787${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json()) as Json }
}

describe('replay mode', () => {
  const api = createApi({ trace: openReplay(), mode: 'replay' })
  // No request of the demo reaches a model, or the network at all: fetch is replaced by a stub that
  // fails loudly and counts its calls.
  const realFetch = globalThis.fetch
  const fetchStub = vi.fn(() => Promise.reject(new Error('The replay API must not call the network.')))
  beforeEach(() => {
    fetchStub.mockClear()
    globalThis.fetch = fetchStub as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('says it replays example data, at 1× and 4×, and how to run live', async () => {
    expect((await get(api, '/api/meta')).body).toEqual({
      mode: 'replay',
      exampleData: true,
      replaySpeeds: [1, 4],
      live: { available: false, how: HOW_TO_RUN_LIVE },
    })
  })

  it('lists the recorded runs (not the evaluation) with the numbers above the table', async () => {
    const { status, body } = await get(api, '/api/runs')
    expect(status).toBe(200)
    expect(body.runs.map((r: { id: number }) => r.id).slice(0, 2)).toEqual([143, 142])
    expect(body.runs.every((r: { origin: string }) => r.origin === 'example')).toBe(true)
    expect(body.summary).toMatchObject({ runs: body.runs.length })
    expect(body.waiting).toEqual([])
  })

  it('filters runs, and explains a bad filter', async () => {
    const waiting = await get(api, '/api/runs?status=waiting')
    expect(waiting.body.runs.map((r: { id: number }) => r.id)).toEqual([143])
    expect(
      (await get(api, '/api/runs?q=cancel')).body.runs.every((r: { title: string }) =>
        /cancel/i.test(r.title),
      ),
    ).toBe(true)
    expect(await get(api, '/api/runs?status=done')).toMatchObject({
      status: 400,
      body: { error: expect.stringContaining('Unknown status "done"') },
    })
    expect((await get(api, '/api/runs?limit=0')).status).toBe(400)
    expect((await get(api, '/api/runs?variant=solo')).status).toBe(400)
  })

  it('gives a run with its steps, cost per part, lessons and the recorded gate', async () => {
    const { body } = await get(api, '/api/runs/142')
    expect(body.run).toMatchObject({ id: 142, status: 'passed' })
    expect(body.steps.map((s: { kind: string }) => s.kind)).toContain('fix-loop')
    expect(body.steps.find((s: { kind: string }) => s.kind === 'gate')).toMatchObject({
      decision: 'approve',
      decided_by: 'person',
    })
    expect(Object.keys(body.costByPart).length).toBeGreaterThan(0)
    expect(body.gate).toEqual({ waiting: false, plan: null, decidable: false })
  })

  it('gives the timeline to play a run at any speed, without the heavy payloads', async () => {
    const { body } = await get(api, '/api/runs/142/timeline')
    expect(body).toMatchObject({ runId: 142, replaySpeeds: [1, 4] })
    expect(body.durationMs).toBeGreaterThan(0)
    const offsets = body.events.map((e: { offset_ms: number }) => e.offset_ms)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
    expect(body.events[0]).toMatchObject({ kind: 'run.started', payload: { variant: expect.any(String) } })
    expect(
      body.events
        .filter((e: { kind: string }) => e.kind.startsWith('model.'))
        .every((e: { payload: unknown }) => e.payload === null),
    ).toBe(true)
  })

  it('gives the full events of one step, and refuses a step of another run', async () => {
    const run = (await get(api, '/api/runs/142')).body
    const plan = run.steps.find((s: { kind: string }) => s.kind === 'plan')
    const { body } = await get(api, `/api/runs/142/steps/${plan.id}/events`)
    expect(body.events.some((e: { kind: string }) => e.kind === 'model.response')).toBe(true)
    const other = (await get(api, '/api/runs/141')).body.steps[0].id
    expect((await get(api, `/api/runs/142/steps/${other}/events`)).status).toBe(404)
  })

  it('answers 404 and 400 for runs that do not exist or are not ids', async () => {
    expect(await get(api, '/api/runs/9999')).toMatchObject({
      status: 404,
      body: { error: 'There is no run #9999.' },
    })
    expect((await get(api, '/api/runs/abc')).status).toBe(400)
    expect((await get(api, '/api/nothing')).status).toBe(404)
    expect((await get(api, '/elsewhere')).status).toBe(404)
  })

  it('gives the playbook versions and the evaluation, marked as example data', async () => {
    const playbook = (await get(api, '/api/playbook')).body
    expect(playbook.versions.length).toBeGreaterThanOrEqual(8)
    const evaluation = (await get(api, '/api/evaluation')).body
    expect(evaluation.exampleData).toBe(true)
    expect(evaluation.main.map((v: { variant: string }) => v.variant).sort()).toEqual([
      'crew',
      'crew-playbook',
      'single-agent',
    ])
    expect(evaluation.learningCurve.points.length).toBeGreaterThan(0)
    expect(evaluation.matrix).toHaveLength(10)
  })

  it('changes nothing: every write answers 405 with how to run live', async () => {
    expect(
      await post(api, '/api/runs', { request: 'Add an order cancellation endpoint please' }),
    ).toMatchObject({
      status: 405,
      body: { error: 'The demo replays recorded runs and changes nothing.', how: HOW_TO_RUN_LIVE },
    })
    expect((await post(api, '/api/runs/143/gate', { decision: 'approve' })).status).toBe(405)
  })
})

describe('live mode', () => {
  const runs = path.join(ROOT, '.crew', 'runs')
  afterAll(() => rmSync(runs, { recursive: true, force: true }))

  const setup = (provider: ScriptedProvider) => {
    const trace = openTrace(':memory:')
    migrate(trace)
    const gate = new WebGate()
    const runner = createLiveRunner({ trace, root: ROOT, gate, apiKey: 'test', provider })
    return { trace, gate, api: createApi({ trace, mode: 'live', live: { available: true }, gate, runner }) }
  }
  const PLAN = {
    steps: ['Add the route'],
    acceptance: ['A pending order can be cancelled'],
    files: ['src/routes/orders.ts'],
    estimateUsd: 0.02,
  }

  it("starts a run, waits at the gate, and takes the person's decision with its reason", async () => {
    const { api } = setup(new ScriptedProvider({ po: () => [toolUse('submit_plan', PLAN)] }))
    const started = await post(api, '/api/runs', {
      request: 'Add POST /orders/:id/cancel for pending orders.',
    })
    expect(started.status).toBe(202)
    const id = started.body.runId as number
    await vi.waitFor(async () => expect((await get(api, `/api/runs/${id}`)).body.gate.waiting).toBe(true))
    const waiting = await get(api, `/api/runs/${id}`)
    expect(waiting.body.run.status).toBe('waiting')
    expect(waiting.body.gate).toEqual({ waiting: true, plan: PLAN, decidable: true })
    expect((await get(api, '/api/runs')).body.waiting).toEqual([id])

    expect(await post(api, `/api/runs/${id}/gate`, { decision: 'reject' })).toMatchObject({
      status: 400,
      body: { error: 'Request changes and Reject need a comment: it is the only record of why.' },
    })
    expect(
      (await post(api, `/api/runs/${id}/gate`, { decision: 'reject', comment: 'Not this week.' })).status,
    ).toBe(200)
    await vi.waitFor(async () => expect((await get(api, `/api/runs/${id}`)).body.run.status).toBe('rejected'))
    const gateStep = (await get(api, `/api/runs/${id}`)).body.steps.find(
      (s: { kind: string }) => s.kind === 'gate',
    )
    expect(gateStep).toMatchObject({ decision: 'reject', decided_by: 'person', comment: 'Not this week.' })
    expect((await post(api, `/api/runs/${id}/gate`, { decision: 'approve' })).status).toBe(409)
  })

  it('refuses a second run while one is in progress, a short request and another site', async () => {
    const { api, gate } = setup(new ScriptedProvider({ po: () => [toolUse('submit_plan', PLAN)] }))
    const first = await post(api, '/api/runs', { request: 'Add POST /orders/:id/cancel for pending orders.' })
    expect(
      (await post(api, '/api/runs', { request: 'Add POST /orders/:id/cancel for paid orders too.' })).status,
    ).toBe(409)
    expect((await post(api, '/api/runs', { request: 'too short' })).status).toBe(400)
    expect(
      (await post(api, '/api/runs', { request: 'x'.repeat(30) }, { origin: 'http://evil.example' })).status,
    ).toBe(403)
    await vi.waitFor(() => expect(gate.waiting(first.body.runId)).toBeDefined())
    gate.answer(first.body.runId, { decision: 'reject', comment: 'Cleanup.' })
  })

  it('without a key, explains how to run live and starts nothing', async () => {
    expect(liveAvailability({})).toEqual({ available: false, how: HOW_TO_RUN_LIVE })
    expect(liveAvailability({ ANTHROPIC_API_KEY: 'k' })).toEqual({ available: true })
    const trace = openTrace(':memory:')
    migrate(trace)
    const api = createApi({ trace, mode: 'live', live: liveAvailability({}) })
    expect((await get(api, '/api/meta')).body).toMatchObject({
      mode: 'live',
      exampleData: false,
      live: { available: false },
    })
    expect(
      await post(api, '/api/runs', { request: 'Add POST /orders/:id/cancel for pending orders.' }),
    ).toMatchObject({
      status: 409,
      body: { how: HOW_TO_RUN_LIVE },
    })
  })

  it('runs with the policy gate too (the evaluation path), straight through to the end', async () => {
    const trace = openTrace(':memory:')
    migrate(trace)
    const runner = createLiveRunner({
      trace,
      root: ROOT,
      gate: approveByPolicy,
      apiKey: 'test',
      provider: new ScriptedProvider({ po: () => [] }),
    })
    const finished = new Promise<string>((resolve) => {
      const r = createLiveRunner({
        trace,
        root: ROOT,
        gate: approveByPolicy,
        apiKey: 'test',
        provider: new ScriptedProvider({ po: () => [] }),
        onFinished: (res) => resolve(res.status),
      })
      void r.start({ title: 'No plan', request: 'A request with no plan submitted at all.', variant: 'crew' })
    })
    expect(await finished).toBe('failed')
    expect(runner.current()).toBeUndefined()
  })
})
