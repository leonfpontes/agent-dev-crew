// The automatic retro through the engine, with a scripted model: lessons in the trace with their
// run and step, a proposed playbook version, duplicates dropped, and a retro that never fails a run.
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { getRun, stepEvents } from '@crew/trace'
import { afterAll, describe, expect, it } from 'vitest'

import {
  approveByPolicy,
  createRetro,
  createRoleSpecs,
  currentPlaybook,
  describeRun,
  ensurePlaybook,
  flatPrice,
  runCrew,
  ScriptedProvider,
  text,
  toolUse,
  type RunCrewOptions,
  type Script,
} from './index.js'
import { EXAMPLE, freshTrace, PLAN, REQUEST, solutionWrites, testRoles, workRoot } from './test/fixtures.js'

const roots: string[] = []
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })))

const turns =
  (...answers: ReturnType<Script>[]): Script =>
  (_req, turn) =>
    answers[turn] ?? [text('Done.')]

const NOW = new Date('2026-11-26T12:00:00Z')
const originalMoney = readFileSync(path.join(EXAMPLE, 'src', 'money.ts'), 'utf8')
const BROKEN = { path: 'src/money.ts', content: 'export const broken = (: number) => 1\n' }

function options(provider: ScriptedProvider, extra: Partial<RunCrewOptions> = {}): RunCrewOptions {
  const root = workRoot()
  roots.push(root)
  const trace = freshTrace()
  ensurePlaybook(trace, NOW)
  return {
    trace,
    provider,
    price: flatPrice(1, 5),
    roles: testRoles(),
    gate: approveByPolicy,
    request: REQUEST,
    variant: 'crew',
    origin: 'live',
    exampleDir: EXAMPLE,
    workRoot: root,
    retro: createRetro({
      trace,
      models: { primary: 'model-small', fallback: 'model-backup' },
      now: () => NOW,
    }),
    ...extra,
  }
}

/** A PO that never submits a plan: the run fails at once, with no tests to run. */
const noPlan = { po: turns([text('I think the plan is obvious.')]) }

const retroStep = (opts: RunCrewOptions, runId: number) =>
  getRun(opts.trace, runId)!.steps.find((s) => s.kind === 'retro')!

describe('createRetro', () => {
  it('records lessons with their run and step, and proposes a playbook version', async () => {
    const provider = new ScriptedProvider({
      ...noPlan,
      retro: (req) => {
        const step = Number(/\[(\d+)\] PO · plan/.exec(String(req.messages[0]?.content))![1])
        return [
          toolUse('submit_lessons', {
            lessons: [
              {
                error: 'The PO finished without a plan.',
                cause: 'It answered in text instead of calling submit_plan.',
                rule: 'Always finish by calling submit_plan, even for a small request.',
                section: 'PO',
                step,
              },
              {
                error: 'Same as the playbook.',
                cause: 'Repeated.',
                rule: 'write each acceptance criterion as a check a test can make: the input and the expected result',
                section: 'PO',
                step: 9999,
              },
            ],
          }),
        ]
      },
    })
    const opts = options(provider)
    const result = await runCrew(opts)
    expect(result).toMatchObject({ status: 'failed', failureReason: 'error' })

    const retro = retroStep(opts, result.runId)
    expect(retro).toMatchObject({ status: 'passed', summary: '2 lessons' })
    const planStep = getRun(opts.trace, result.runId)!.steps[0]!
    const lessons = opts.trace
      .prepare(
        'SELECT run_id, step_id, position, section, status, playbook_version, duplicate_of FROM lessons',
      )
      .all()
    expect(lessons).toEqual([
      {
        run_id: result.runId,
        step_id: planStep.id,
        position: 1,
        section: 'PO',
        status: 'proposed',
        playbook_version: 2,
        duplicate_of: null,
      },
      // The duplicate is kept as one, and a step the run doesn't have is dropped.
      {
        run_id: result.runId,
        step_id: null,
        position: 2,
        section: 'PO',
        status: 'duplicate',
        playbook_version: null,
        duplicate_of: 1,
      },
    ])
    const v2 = opts.trace
      .prepare('SELECT status, source, source_run_id, diff FROM playbook_versions WHERE version = 2')
      .get()
    expect(v2).toMatchObject({ status: 'proposed', source: 'retro', source_run_id: result.runId })
    expect(String((v2 as { diff: string }).diff)).toContain('+- Always finish by calling submit_plan')
    expect(currentPlaybook(opts.trace).version).toBe(1)

    // The trace shows the retro like any step: the prompt, the cost and the lessons it proposed.
    const events = stepEvents(opts.trace, retro.id)
    expect(events.find((e) => e.kind === 'model.request')?.payload).toMatchObject({
      prompt: 'prompts/retro.md',
    })
    expect(events.filter((e) => e.kind === 'lesson.proposed').map((e) => e.payload)).toMatchObject([
      { section: 'PO', status: 'proposed', playbookVersion: 2, stepId: planStep.id },
      { status: 'duplicate', duplicateOf: 1 },
    ])
    const cost = opts.trace.prepare('SELECT COUNT(*) AS n FROM costs WHERE step_id = ?').get(retro.id)
    expect(cost).toEqual({ n: 1 })
    // What the model read: the outcome, the steps with ids, the error and the playbook.
    const input = String(provider.calls.find((c) => c.agent === 'retro')!.messages[0]!.content)
    expect(input).toContain('status: failed, reason: error')
    expect(input).toContain(`[${planStep.id}] PO · plan, attempt 1: failed (no plan submitted)`)
    expect(input).toContain('<playbook>\n# Playbook')
  })

  it('reminds a model that answers in text, then takes its lessons', async () => {
    const provider = new ScriptedProvider({
      ...noPlan,
      retro: (_req, turn) =>
        turn === 0 ? [text('No lessons, I think.')] : [toolUse('submit_lessons', { lessons: [] })],
    })
    const opts = options(provider)
    const result = await runCrew(opts)
    expect(retroStep(opts, result.runId)).toMatchObject({ status: 'passed', summary: '0 lessons' })
    expect(provider.calls.filter((c) => c.agent === 'retro')).toHaveLength(2)
    expect(opts.trace.prepare('SELECT COUNT(*) AS n FROM playbook_versions').get()).toEqual({ n: 1 })
  })

  it('sends an invalid input back as an error, and fails only its own step when the model never fixes it', async () => {
    const provider = new ScriptedProvider({
      ...noPlan,
      retro: () => [toolUse('submit_lessons', { lessons: [{ error: 'x', section: 'Designer' }] })],
    })
    const opts = options(provider)
    const result = await runCrew(opts)
    expect(result.failureReason).toBe('error') // the run's own outcome, unchanged
    expect(retroStep(opts, result.runId)).toMatchObject({ status: 'failed', summary: 'retro failed' })
    const second = provider.calls.filter((c) => c.agent === 'retro')[1]!
    expect(JSON.stringify(second.messages.at(-1))).toContain('Invalid input')
    expect(opts.trace.prepare('SELECT COUNT(*) AS n FROM lessons').get()).toEqual({ n: 0 })
  })

  it('moves to the fallback model when the primary fails', async () => {
    const provider = new ScriptedProvider({
      ...noPlan,
      retro: (req) =>
        req.model === 'model-small' ? new Error('overloaded') : [toolUse('submit_lessons', { lessons: [] })],
    })
    const opts = options(provider)
    const result = await runCrew(opts)
    expect(retroStep(opts, result.runId).status).toBe('passed')
    expect(provider.calls.filter((c) => c.agent === 'retro').map((c) => c.model)).toEqual([
      'model-small',
      'model-backup',
    ])
  })

  it('stays inside the run budget: over it, the retro makes no call', async () => {
    const provider = new ScriptedProvider({
      ...noPlan,
      retro: () => [toolUse('submit_lessons', { lessons: [] })],
    })
    const opts = options(provider, { roles: testRoles({ po: { maxTokens: 10 } }), budgetMicros: 2_000 })
    const result = await runCrew(opts)
    expect(result.failureReason).toBe('error')
    expect(provider.calls.some((c) => c.agent === 'retro')).toBe(false)
    const retro = retroStep(opts, result.runId)
    expect(retro.status).toBe('failed')
    expect(stepEvents(opts.trace, retro.id).some((e) => e.kind === 'budget.exceeded')).toBe(true)
  })

  it('skips the model on a clean run and on the single agent', async () => {
    const clean = new ScriptedProvider({
      po: turns([toolUse('submit_plan', PLAN)]),
      engineer: turns(solutionWrites().map((w) => toolUse('write_file', w))),
      reviewer: turns([toolUse('submit_review', { verdict: 'approve', comments: [] })]),
      qa: turns(),
    })
    const opts = options(clean)
    const result = await runCrew(opts)
    expect(result.status).toBe('passed')
    expect(retroStep(opts, result.runId)).toMatchObject({ status: 'passed', summary: '0 lessons' })
    expect(clean.calls.some((c) => c.agent === 'retro')).toBe(false)

    const solo = new ScriptedProvider({ solo: turns() })
    const soloOpts = options(solo, { variant: 'single-agent' })
    await runCrew(soloOpts)
    expect(solo.calls.some((c) => c.agent === 'retro')).toBe(false)
  }, 120_000)

  it('reads the failures and the review comments of a fix loop', async () => {
    const provider = new ScriptedProvider({
      po: turns([toolUse('submit_plan', PLAN)]),
      engineer: (req, turn) => {
        if (turn > 0) return [text('Done.')]
        const fixing = String(req.messages[0]?.content).includes('<failures>')
        return [toolUse('write_file', fixing ? { path: 'src/money.ts', content: originalMoney } : BROKEN)]
      },
      reviewer: turns([
        toolUse('submit_review', { verdict: 'changes', comments: ['money.ts no longer parses.'] }),
      ]),
      qa: turns(),
      retro: () => [toolUse('submit_lessons', { lessons: [] })],
    })
    // The real role specs, so the fix gets its failures in the <failures> tag.
    const opts = options(provider, {
      roles: createRoleSpecs({ models: { primary: 'model-small' }, allowedModels: ['model-small'] }),
    })
    const result = await runCrew(opts)
    expect(result.status).toBe('passed')
    const input = describeRun(opts.trace, result.runId, { status: 'passed' }, '', 'PLAYBOOK')
    expect(input).toContain('Fix loop 1')
    expect(input).toContain('review: changes')
    expect(input).toContain('- money.ts no longer parses.')
    expect(input).toMatch(/failing: .+/)
    expect(input).toContain('<diff>\n(no change)\n</diff>')
    expect(provider.calls.some((c) => c.agent === 'retro')).toBe(true)
  }, 120_000)
})
