import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { getRun, stepEvents } from '@crew/trace'
import { afterAll, describe, expect, it } from 'vitest'

import {
  approveByPolicy,
  CUT_ANSWER_NOTE,
  flatPrice,
  runCrew,
  scoreHiddenTests,
  scriptedGate,
  ScriptedProvider,
  text,
  toolUse,
  type RunCrewOptions,
  type Script,
} from './index.js'
import {
  CANCEL_ORDER,
  EXAMPLE,
  freshTrace,
  PLAN,
  REQUEST,
  solutionWrites,
  testRoles,
  workRoot,
} from './test/fixtures.js'

const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

const price = flatPrice(1, 5) // $1 / $5 per million tokens

/** One answer per turn, then plain text. */
const turns =
  (...answers: ReturnType<Script>[]): Script =>
  (_req, turn) =>
    answers[turn] ?? [text('Done.')]

const BROKEN = { path: 'src/money.ts', content: 'export const broken = (: number) => 1\n' }
const originalMoney = readFileSync(path.join(EXAMPLE, 'src', 'money.ts'), 'utf8')

function options(provider: ScriptedProvider, extra: Partial<RunCrewOptions> = {}): RunCrewOptions {
  const root = workRoot()
  roots.push(root)
  return {
    trace: freshTrace(),
    provider,
    price,
    roles: testRoles(),
    gate: approveByPolicy,
    request: REQUEST,
    variant: 'crew',
    origin: 'eval',
    evalSuite: 'main',
    evalRound: 1,
    exampleDir: EXAMPLE,
    workRoot: root,
    ...extra,
  }
}

const kinds = (opts: RunCrewOptions, runId: number) =>
  getRun(opts.trace, runId)!.steps.map((s) => `${s.kind}${s.role ? `:${s.role}` : ''}=${s.status}`)

describe('runCrew · crew variant', () => {
  it('takes a request through plan, gate, code, review and test, then scores the hidden tests', async () => {
    const provider = new ScriptedProvider({
      po: turns([toolUse('read_file', { path: 'src/routes/orders.ts' })], [toolUse('submit_plan', PLAN)]),
      engineer: turns(solutionWrites().map((w) => toolUse('write_file', w))),
      reviewer: turns([
        toolUse('submit_review', { verdict: 'approve', comments: ['Covers the 409 cases.'] }),
      ]),
      qa: turns([toolUse('run_tests', {})]),
    })
    const opts = options(provider)
    const result = await runCrew(opts)
    expect(result.status).toBe('passed')
    expect(result.tests).toMatchObject({ failed: 0 })
    expect(kinds(opts, result.runId)).toEqual([
      'plan:po=passed',
      'gate=approved',
      'code:engineer=passed',
      'review:reviewer=passed',
      'test:qa=passed',
    ])
    const detail = getRun(opts.trace, result.runId)!
    expect(detail.run).toMatchObject({
      status: 'passed',
      origin: 'eval',
      tests_total: result.tests!.total,
      request_id: 'cancel-order',
    })
    expect(String(detail.run.repo_ref)).toMatch(/^fernhill-orders@[0-9a-f]{7}$/)
    expect(String(detail.run.diff)).toContain('+++ b/src/routes/orders.ts')
    const gate = detail.steps.find((s) => s.kind === 'gate')!
    expect(gate).toMatchObject({ decision: 'approve', decided_by: 'policy', summary: 'approved by policy' })
    // One cost row per model call: PO 2, Engineer 2, Reviewer 1, QA 2.
    const costs = opts.trace
      .prepare('SELECT COUNT(*) AS n, SUM(cost_micros) AS s FROM costs WHERE run_id = ?')
      .get(result.runId) as { n: number; s: number }
    expect(costs.n).toBe(provider.calls.length)
    expect(costs.s).toBe(result.costMicros)
    // The step panel has the prompt record of the contract.
    const plan = detail.steps.find((s) => s.kind === 'plan')!
    const request = stepEvents(opts.trace, plan.id).find((e) => e.kind === 'model.request')!
    expect(request.payload).toMatchObject({ prompt: 'prompts/po.md', system: 'You are the po.', rules: [] })
    expect(
      stepEvents(opts.trace, plan.id).some(
        (e) => e.kind === 'model.response' && (e.payload as { plan?: unknown }).plan,
      ),
    ).toBe(true)

    const hidden = await scoreHiddenTests(opts.trace, result.runId, result.workspace.dir, [
      path.join(CANCEL_ORDER, 'cancel-order.test.ts'),
    ])
    expect(hidden).toMatchObject({ failed: 0, total: 6 })
    expect(getRun(opts.trace, result.runId)!.run).toMatchObject({ hidden_passed: 6, hidden_total: 6 })
  }, 120_000)

  it('sends failing tests back to the Engineer in a fix loop, and passes when the fix works', async () => {
    const provider = new ScriptedProvider({
      po: turns([toolUse('submit_plan', PLAN)]),
      engineer: (req, turn) => {
        if (turn > 0) return [text('Done.')]
        const fixing = String(req.messages[0]?.content).includes('Failing')
        return [toolUse('write_file', fixing ? { path: 'src/money.ts', content: originalMoney } : BROKEN)]
      },
      reviewer: turns([
        toolUse('submit_review', { verdict: 'changes', comments: ['money.ts no longer type-checks.'] }),
      ]),
      qa: turns(),
    })
    const opts = options(provider)
    const result = await runCrew(opts)
    expect(result.status).toBe('passed')
    expect(kinds(opts, result.runId)).toEqual([
      'plan:po=passed',
      'gate=approved',
      'code:engineer=passed',
      'review:reviewer=passed',
      'test:qa=failed',
      'fix-loop=fix-loop',
      'fix:engineer=passed',
      'test:qa=passed',
    ])
    const detail = getRun(opts.trace, result.runId)!
    const loop = detail.steps.find((s) => s.kind === 'fix-loop')!
    expect(loop).toMatchObject({ loop_index: 1, summary: 'of 2', parent_id: null })
    expect(detail.steps.filter((s) => s.parent_id === loop.id)).toHaveLength(2)
    expect(stepEvents(opts.trace, loop.id)[1]).toMatchObject({
      kind: 'loop.started',
      payload: { loop: 1, of: 2 },
    })
    // The fix gets the failures and the Reviewer's comments.
    const fixCall = provider.calls.find(
      (c) => c.agent === 'engineer' && String(c.messages[0]?.content).includes('Failing'),
    )
    expect(fixCall).toBeDefined()
    expect(detail.run.diff).toBeNull() // the fix put money.ts back exactly as it was
  }, 120_000)

  it('stops after two fix loops and fails with fix-loops-exhausted', async () => {
    const provider = new ScriptedProvider({
      po: turns([toolUse('submit_plan', PLAN)]),
      engineer: (_req, turn) => (turn === 0 ? [toolUse('write_file', BROKEN)] : [text('Done.')]),
      reviewer: turns([toolUse('submit_review', { verdict: 'approve', comments: [] })]),
      qa: turns(),
    })
    const opts = options(provider)
    const result = await runCrew(opts)
    expect(result).toMatchObject({ status: 'failed', failureReason: 'fix-loops-exhausted' })
    const loops = getRun(opts.trace, result.runId)!.steps.filter((s) => s.kind === 'fix-loop')
    expect(loops.map((l) => [l.loop_index, l.status])).toEqual([
      [1, 'fix-loop'],
      [2, 'failed'],
    ])
  }, 180_000)
})

describe('runCrew · the human gate', () => {
  it('ends the run without code when the gate rejects, keeping the reason', async () => {
    const provider = new ScriptedProvider({ po: turns([toolUse('submit_plan', PLAN)]) })
    const opts = options(provider, {
      gate: scriptedGate([{ decision: 'reject', by: 'person', comment: 'Out of scope this week.' }]),
      origin: 'live',
      evalSuite: undefined,
      evalRound: undefined,
    })
    const result = await runCrew(opts)
    expect(result.status).toBe('rejected')
    expect(kinds(opts, result.runId)).toEqual(['plan:po=passed', 'gate=rejected'])
    expect(getRun(opts.trace, result.runId)!.steps[1]).toMatchObject({
      decided_by: 'person',
      comment: 'Out of scope this week.',
      summary: 'rejected by you',
    })
    expect(provider.calls.every((c) => c.agent === 'po')).toBe(true)
  })

  it('sends "request changes" back to the PO with the comment, then continues after approval', async () => {
    const provider = new ScriptedProvider({
      po: turns([toolUse('submit_plan', PLAN)]),
      engineer: turns(),
      reviewer: turns([toolUse('submit_review', { verdict: 'approve', comments: [] })]),
      qa: turns(),
    })
    const gate = scriptedGate([
      { decision: 'request-changes', by: 'person', comment: 'Also block cancelling refunded orders.' },
      { decision: 'approve', by: 'person' },
    ])
    const opts = options(provider, { gate, origin: 'live', evalSuite: undefined, evalRound: undefined })
    const result = await runCrew(opts)
    expect(kinds(opts, result.runId).slice(0, 4)).toEqual([
      'plan:po=passed',
      'gate=changes-requested',
      'plan:po=passed',
      'gate=approved',
    ])
    const second = provider.calls.filter((c) => c.agent === 'po')[1]
    expect(String(second?.messages[0]?.content)).toContain('Changes: Also block cancelling refunded orders.')
    expect(getRun(opts.trace, result.runId)!.steps[2]?.summary).toBe('plan v2')
  }, 120_000)

  it('refuses a rejection without a reason', async () => {
    const provider = new ScriptedProvider({ po: turns([toolUse('submit_plan', PLAN)]) })
    const opts = options(provider, { gate: scriptedGate([{ decision: 'reject', by: 'person' }]) })
    const result = await runCrew(opts)
    expect(result).toMatchObject({ status: 'failed', failureReason: 'error' })
  })
})

describe('runCrew · budget, fallback and failures', () => {
  it('stops before a call that would pass the budget', async () => {
    const provider = new ScriptedProvider({ po: turns([toolUse('submit_plan', PLAN)]) })
    const opts = options(provider, { budgetMicros: 100 })
    const result = await runCrew(opts)
    expect(result).toMatchObject({ status: 'failed', failureReason: 'over-budget' })
    expect(provider.calls).toHaveLength(0)
    const plan = getRun(opts.trace, result.runId)!.steps[0]!
    expect(plan).toMatchObject({ status: 'failed', summary: 'over budget' })
    expect(stepEvents(opts.trace, plan.id).find((e) => e.kind === 'budget.exceeded')?.payload).toMatchObject({
      budgetUsd: 0.0001,
      spentUsd: 0,
    })
  })

  it('moves to the fallback model when the primary fails, and records it', async () => {
    const provider = new ScriptedProvider({
      po: (req) => (req.model === 'model-small' ? new Error('overloaded') : [toolUse('submit_plan', PLAN)]),
    })
    const roles = testRoles({ po: { models: { primary: 'model-small', fallback: 'model-backup' } } })
    const opts = options(provider, {
      roles,
      gate: scriptedGate([{ decision: 'reject', by: 'person', comment: 'Stop here.' }]),
    })
    const result = await runCrew(opts)
    const plan = getRun(opts.trace, result.runId)!.steps[0]!
    expect(plan).toMatchObject({
      status: 'passed',
      model: 'model-backup',
      fallback_used: 1,
      attempt: 2,
      max_attempts: 2,
    })
  })

  it('fails with "error" when the PO never submits a plan', async () => {
    const provider = new ScriptedProvider({ po: turns() })
    const opts = options(provider)
    const result = await runCrew(opts)
    expect(result).toMatchObject({ status: 'failed', failureReason: 'error' })
    expect(getRun(opts.trace, result.runId)!.steps[0]).toMatchObject({
      status: 'failed',
      summary: 'no plan submitted',
    })
  })

  it('does not end a step on an answer cut at max_tokens: drops it, nudges the agent and goes on', async () => {
    const cut = { content: [], stopReason: 'max_tokens' }
    const hasNote = (req: { messages: { content: unknown }[] }) =>
      JSON.stringify(req.messages.at(-1)!.content).includes(CUT_ANSWER_NOTE)
    const provider = new ScriptedProvider({
      po: (req) => (hasNote(req) ? [toolUse('submit_plan', PLAN)] : cut),
    })
    const opts = options(provider, {
      gate: scriptedGate([{ decision: 'reject', by: 'person', comment: 'Stop here.' }]),
    })
    const result = await runCrew(opts)
    const plan = getRun(opts.trace, result.runId)!.steps[0]!
    expect(plan).toMatchObject({ kind: 'plan', status: 'passed' })
    expect(provider.calls).toHaveLength(2)
    // The cut turn is not sent back; the note goes at the end of the first user message.
    const second = provider.calls[1]!.messages
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ role: 'user' })
    expect(second[0]!.content as string).toMatch(new RegExp(`\\n\\n${CUT_ANSWER_NOTE}$`))
    expect(provider.calls[0]!.messages[0]!.content as string).not.toContain(CUT_ANSWER_NOTE)
    const events = stepEvents(opts.trace, plan.id)
    expect(events.filter((e) => e.kind === 'model.request')).toHaveLength(2)
    expect(events.find((e) => e.kind === 'log')?.payload).toMatchObject({
      level: 'warn',
      message: expect.stringMatching(/ran out of output tokens/),
    })
    expect(plan.cost_micros).toBeGreaterThan(0) // the cut answer is still paid for
  })

  it('puts the note after the tool results, once, and counts cut turns in maxTurns', async () => {
    const cut = { content: [], stopReason: 'max_tokens' }
    const provider = new ScriptedProvider({
      po: (_req, turn) => (turn === 0 ? [toolUse('list_files', {})] : cut),
    })
    const opts = options(provider, { roles: testRoles({ po: { maxTurns: 4 } }) })
    const result = await runCrew(opts)
    expect(result.failureReason).toBe('error')
    const step = getRun(opts.trace, result.runId)!.steps[0]!
    const logs = stepEvents(opts.trace, step.id).filter((e) => e.kind === 'log')
    expect(logs.map((e) => (e.payload as { level: string }).level)).toEqual(['warn', 'warn', 'warn', 'error'])
    expect((logs.at(-1)!.payload as { message: string }).message).toMatch(/used all 4 turns/)
    expect(provider.calls).toHaveLength(4)
    const last = provider.calls[3]!.messages
    expect(last.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    const blocks = last[2]!.content as { type: string }[]
    expect(blocks.map((b) => b.type)).toEqual(['tool_result', 'text'])
  })

  it('fails a step that runs out of turns', async () => {
    const provider = new ScriptedProvider({ po: () => [toolUse('list_files', {})] })
    const opts = options(provider, { roles: testRoles({ po: { maxTurns: 2 } }) })
    const result = await runCrew(opts)
    expect(result.failureReason).toBe('error')
    expect(provider.calls).toHaveLength(2)
  })
})

describe('runCrew · hooks', () => {
  it('reports the run id before any model call, and records the retro model call on its own step', async () => {
    const provider = new ScriptedProvider({
      po: turns([toolUse('submit_plan', PLAN)]),
      retro: turns([text('No lessons.')]),
    })
    let started = 0
    const opts = options(provider, {
      gate: scriptedGate([{ decision: 'reject', by: 'person', comment: 'Stop.' }]),
      onStart: (id) => {
        started = id
        expect(provider.calls).toHaveLength(0)
      },
      retro: async (ctx) => {
        await ctx.complete(
          {
            agent: 'retro',
            model: 'model-small',
            system: 'retro',
            messages: [{ role: 'user', content: 'go' }],
            tools: [],
            maxTokens: 100,
          },
          'prompts/retro.md',
        )
        return { lessons: [] }
      },
    })
    const result = await runCrew(opts)
    expect(started).toBe(result.runId)
    // A rejected run has no retro; a failed one does.
    expect(getRun(opts.trace, result.runId)!.steps.some((s) => s.kind === 'retro')).toBe(false)
    const failing = await runCrew({
      ...opts,
      onStart: undefined,
      gate: approveByPolicy,
      provider: new ScriptedProvider({ po: turns(), retro: turns([text('No lessons.')]) }),
    })
    const retro = getRun(opts.trace, failing.runId)!.steps.find((s) => s.kind === 'retro')!
    expect(retro).toMatchObject({ status: 'passed', model: 'model-small', summary: '0 lessons' })
    expect(retro.cost_micros).toBeGreaterThan(0)
  })
})

describe('runCrew · single agent and playbook', () => {
  it('runs one solo step, then the tests, with no gate', async () => {
    const provider = new ScriptedProvider({
      solo: turns(solutionWrites().map((w) => toolUse('write_file', w))),
    })
    const opts = options(provider, { variant: 'single-agent' })
    const result = await runCrew(opts)
    expect(result.status).toBe('passed')
    expect(kinds(opts, result.runId)).toEqual(['solo=passed', 'test=passed'])
  }, 120_000)

  it('gives every role the playbook in the crew-playbook variant, and needs one', async () => {
    const provider = new ScriptedProvider({ po: turns([toolUse('submit_plan', PLAN)]) })
    const playbook = { version: 1, content: '# Playbook v1' }
    const opts = options(provider, {
      variant: 'crew-playbook',
      playbook,
      gate: scriptedGate([{ decision: 'reject', by: 'person', comment: 'Only checking the prompt.' }]),
    })
    // The version has to exist in the trace: the playbook story writes it.
    opts.trace
      .prepare(
        `INSERT INTO playbook_versions (version, title, content, status, source, created_at, decided_at, decided_by)
        VALUES (1, 'Initial playbook', ?, 'approved', 'initial', '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z', 'person')`,
      )
      .run(playbook.content)
    const result = await runCrew(opts)
    expect(provider.calls[0]?.system).toBe('You are the po. Playbook v1.')
    expect(getRun(opts.trace, result.runId)!.run).toMatchObject({
      variant: 'crew-playbook',
      playbook_version: 1,
    })
    const plan = getRun(opts.trace, result.runId)!.steps[0]!
    expect(stepEvents(opts.trace, plan.id).find((e) => e.kind === 'model.request')?.payload).toMatchObject({
      playbook: { version: 1, section: 'PO' },
    })
    await expect(runCrew(options(provider, { variant: 'crew-playbook' }))).rejects.toThrow('needs a playbook')
  })
})
