// Runs one feature request through the crew and records it in the trace.
//
//   crew:          plan (PO) → gate → code (Engineer) → review (Reviewer) → test (QA)
//                  → up to 2 fix loops [fix (Engineer) → test (QA)] when the tests fail → retro
//   single-agent:  solo (one agent with every tool) → test
//
// The pipeline order comes from the DAG in @crew/core. The tests that decide a step are run by the
// engine in the sandbox, never taken from what a model says. Before every model call the engine
// checks that the worst case still fits the budget; a call that would pass it stops the run.

import {
  MAX_FIX_LOOPS,
  topologicalOrder,
  type GateDecision,
  type Role,
  type StepStatus,
  type Variant,
} from '@crew/core'
import { runVitest, type TestReport } from '@crew/sandbox'
import {
  MICROS_PER_USD,
  type EvalSuite,
  type FailureReason,
  type RunOrigin,
  type RunStatus,
  type TraceDb,
} from '@crew/trace'

import { checkGateResult, type GateDecider } from './gate.js'
import type {
  ContentBlock,
  Message,
  ModelProvider,
  PriceFn,
  TokenUsage,
  ToolResultBlock,
} from './provider.js'
import { TraceRecorder } from './recorder.js'
import type { Plan, Review, RoleInput, RoleSpec, RoleSpecs } from './roles.js'
import { AGENT_TOOLS, runTool, TOOL_SPECS, type ToolOutcome } from './tools.js'
import { createWorkspace, repoRefOf, workspaceDiff, type Workspace } from './workspace.js'

/** The crew pipeline as a DAG; the engine walks it in dependency order. */
export const CREW_PIPELINE = [
  { id: 'plan', after: [] },
  { id: 'gate', after: ['plan'] },
  { id: 'code', after: ['gate'] },
  { id: 'review', after: ['code'] },
  { id: 'test', after: ['review'] },
] as const

export const DEFAULT_BUDGET_MICROS = 250_000
/** Plans the PO may write: the first and up to two revisions after "request changes". */
export const MAX_PLAN_REVISIONS = 2

export interface CrewRequest {
  title: string
  request: string
  /** The evaluation request id, when there is one. */
  id?: string
}

export interface RunCrewOptions {
  trace: TraceDb
  provider: ModelProvider
  price: PriceFn
  roles: RoleSpecs
  gate: GateDecider
  request: CrewRequest
  variant: Variant
  /** Required for `crew-playbook`. */
  playbook?: { version: number; content: string }
  origin: RunOrigin
  evalSuite?: EvalSuite
  evalRound?: number
  /** The example repository (its src/ and tests/ are copied). */
  exampleDir: string
  /** Where run copies go, e.g. `<repo>/.crew/runs`. */
  workRoot: string
  budgetMicros?: number
  clock?: () => number
  testTimeoutMs?: number
  /** Runs after the pipeline, in its own step; it blocks nothing (the AI story plugs in the retro). */
  retro?: (context: RetroContext) => Promise<RetroResult>
}

export interface RetroContext {
  runId: number
  status: RunStatus
  diff: string
  failures: TestReport['failures']
}

export interface RetroResult {
  /** Lessons proposed, in the trace as `lesson.proposed` events; the AI story writes the lessons table. */
  lessons: { error: string; cause: string; rule: string; section: string }[]
}

export interface RunResult {
  runId: number
  status: Exclude<RunStatus, 'running' | 'waiting'>
  failureReason?: FailureReason
  workspace: Workspace
  tests?: TestReport
  diff: string
  costMicros: number
}

class BudgetExceeded extends Error {}
class StepFailed extends Error {}

interface AgentOutcome {
  text: string
  plan?: Plan
  review?: Review
  model: string
  fallbackUsed: boolean
  attempt: number
}

const usd = (micros: number) => Math.round((micros / MICROS_PER_USD) * 10_000) / 10_000
const estimateTokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / 4)
const testSummary = (t: TestReport) => (t.error ? 'tests did not run' : `${t.passed} / ${t.total}`)
const testsPass = (t: TestReport) => t.error === undefined && t.failed === 0 && t.total > 0

export async function runCrew(options: RunCrewOptions): Promise<RunResult> {
  const { trace, provider, price, roles, request, variant } = options
  if (variant === 'crew-playbook' && !options.playbook)
    throw new Error('The crew-playbook variant needs a playbook.')
  const budget = options.budgetMicros ?? DEFAULT_BUDGET_MICROS
  const rec = new TraceRecorder(trace, options.clock)
  const lead = variant === 'single-agent' ? roles.solo : roles.engineer

  rec.startRun({
    title: request.title,
    request: request.request,
    requestId: request.id,
    variant,
    playbookVersion: variant === 'crew-playbook' ? options.playbook?.version : undefined,
    origin: options.origin,
    evalSuite: options.evalSuite,
    evalRound: options.evalRound,
    repoRef: repoRefOf(options.exampleDir),
    model: lead.models.primary,
    budgetMicros: budget,
  })
  const workspace = createWorkspace(options.exampleDir, options.workRoot, rec.runId)
  const playbook = variant === 'crew-playbook' ? options.playbook : undefined

  /** One step of model work: calls the model until it stops calling tools (or submits). */
  const runAgent = async (stepId: number, spec: RoleSpec, input: RoleInput): Promise<AgentOutcome> => {
    const full = { ...input, playbook }
    const system = spec.system(full)
    const user = spec.user(full)
    const tools = AGENT_TOOLS[spec.agent].map((t) => TOOL_SPECS[t])
    const messages: Message[] = [{ role: 'user', content: user }]
    let model = spec.models.primary
    let fallbackUsed = false
    let attempt = 1

    for (let turn = 0; turn < spec.maxTurns; turn++) {
      const estimate = price(model, {
        inputTokens: estimateTokens([system, messages, tools]),
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: spec.maxTokens,
      })
      if (rec.spent + estimate > budget) {
        rec.event(stepId, 'budget.exceeded', {
          budgetUsd: usd(budget),
          spentUsd: usd(rec.spent),
          nextCallUsd: usd(estimate),
        })
        throw new BudgetExceeded(
          `the next call would pass the $${usd(budget)} budget ($${usd(rec.spent)} spent, up to $${usd(estimate)} more)`,
        )
      }
      const request = { agent: spec.agent, model, system, messages, tools, maxTokens: spec.maxTokens }
      rec.event(stepId, 'model.request', {
        prompt: spec.promptFile,
        playbook:
          playbook && spec.playbookSection
            ? { version: playbook.version, section: spec.playbookSection }
            : null,
        system,
        rules: spec.rules?.(full) ?? [],
        user: turn === 0 ? user : null,
        turn,
        raw: {
          model,
          max_tokens: spec.maxTokens,
          messages: messages.length,
          tools: tools.map((t) => t.name),
        },
      })
      let response
      try {
        response = await provider.complete(request)
      } catch (error) {
        const reason = (error as Error).message
        if (!fallbackUsed && spec.models.fallback) {
          rec.event(stepId, 'log', {
            level: 'warn',
            message: `${model} failed (${reason}); retrying with ${spec.models.fallback}.`,
          })
          model = spec.models.fallback
          fallbackUsed = true
          attempt = 2
          turn--
          continue
        }
        throw new StepFailed(`the model call failed: ${reason}`)
      }
      const usage: TokenUsage = response.usage
      rec.cost(stepId, response.model, usage, price(response.model, usage))
      const text = response.content
        .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      rec.event(stepId, 'model.response', {
        text,
        stopReason: response.stopReason,
        raw: response.raw ?? null,
      })
      messages.push({ role: 'assistant', content: response.content })

      const calls = response.content.filter(
        (b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
      )
      if (calls.length === 0) return { text, model: response.model, fallbackUsed, attempt }

      const results: ToolResultBlock[] = []
      let done: ToolOutcome | undefined
      for (const call of calls) {
        rec.event(stepId, 'tool.call', { tool: call.name, input: call.input })
        const outcome = await runTool(call.name, call.input, {
          agent: spec.agent,
          repoDir: workspace.dir,
          testTimeoutMs: options.testTimeoutMs,
        })
        rec.event(stepId, 'tool.result', { tool: call.name, ok: outcome.ok, output: outcome.output })
        results.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: JSON.stringify(outcome.output),
          isError: !outcome.ok,
        })
        if (outcome.plan || outcome.review) done = outcome
      }
      if (done)
        return { text, plan: done.plan, review: done.review, model: response.model, fallbackUsed, attempt }
      messages.push({ role: 'user', content: results })
    }
    throw new StepFailed(`the ${spec.agent} used all ${spec.maxTurns} turns without finishing`)
  }

  const maxAttempts = (spec: RoleSpec) => (spec.models.fallback ? 2 : 1)

  /** A model step with its trace row; a failure ends the step as failed and rethrows. */
  const modelStep = async (
    kind: 'plan' | 'code' | 'review' | 'test' | 'fix' | 'solo',
    spec: RoleSpec,
    input: RoleInput,
    parentId?: number,
  ) => {
    const role: Role | undefined = kind === 'solo' ? undefined : (spec.agent as Role)
    const stepId = rec.startStep({ kind, role, parentId, maxAttempts: maxAttempts(spec) })
    try {
      const outcome = await runAgent(stepId, spec, input)
      return { stepId, outcome }
    } catch (error) {
      rec.event(stepId, 'log', { level: 'error', message: (error as Error).message })
      rec.finishStep(stepId, {
        status: 'failed',
        summary: error instanceof BudgetExceeded ? 'over budget' : 'failed',
      })
      throw error
    }
  }

  /** The engine's own test run at the end of a QA (or solo) step: the result that counts. */
  const authoritativeTests = async (stepId: number) => {
    const tests = await runVitest(workspace.dir, { timeoutMs: options.testTimeoutMs })
    rec.event(stepId, 'tool.result', { tool: 'run_tests', ok: testsPass(tests), output: tests, by: 'engine' })
    return tests
  }

  const finish = async (
    status: RunResult['status'],
    failureReason?: FailureReason,
    tests?: TestReport,
  ): Promise<RunResult> => {
    const diff = workspaceDiff(workspace)
    if (options.retro && status !== 'rejected') {
      const stepId = rec.startStep({ kind: 'retro' })
      try {
        const retro = await options.retro({ runId: rec.runId, status, diff, failures: tests?.failures ?? [] })
        for (const lesson of retro.lessons) rec.event(stepId, 'lesson.proposed', lesson)
        rec.finishStep(stepId, { status: 'passed', summary: `${retro.lessons.length} lessons` })
      } catch (error) {
        rec.event(stepId, 'log', { level: 'error', message: (error as Error).message })
        rec.finishStep(stepId, { status: 'failed', summary: 'retro failed' })
      }
    }
    rec.finishRun({
      status,
      failureReason,
      tests: tests && !tests.error ? { passed: tests.passed, total: tests.total } : undefined,
      diff,
    })
    return { runId: rec.runId, status, failureReason, workspace, tests, diff, costMicros: rec.spent }
  }

  const reasonOf = (error: unknown): FailureReason =>
    error instanceof BudgetExceeded ? 'over-budget' : 'error'

  try {
    if (variant === 'single-agent') {
      const solo = await modelStep('solo', roles.solo, { title: request.title, request: request.request })
      rec.finishStep(solo.stepId, {
        status: 'passed',
        model: solo.outcome.model,
        fallbackUsed: solo.outcome.fallbackUsed,
        attempt: solo.outcome.attempt,
      })
      const testStep = rec.startStep({ kind: 'test' })
      const tests = await authoritativeTests(testStep)
      rec.finishStep(testStep, {
        status: testsPass(tests) ? 'passed' : 'failed',
        summary: testSummary(tests),
      })
      // The single agent has no fix loop: tests still failing when it stops count as loops exhausted.
      return await finish(
        testsPass(tests) ? 'passed' : 'failed',
        testsPass(tests) ? undefined : 'fix-loops-exhausted',
        tests,
      )
    }

    // Walk the DAG; the order is checked once, so a broken pipeline fails before any model call.
    const order = topologicalOrder(CREW_PIPELINE.map((n) => ({ id: n.id, after: [...n.after] })))
    let plan: Plan | undefined
    let review: Review | undefined
    let tests: TestReport | undefined

    for (const node of order) {
      if (node === 'plan') continue // planned together with the gate below
      if (node === 'gate') {
        let comment: string | undefined
        for (let revision = 1; ; revision++) {
          const po = await modelStep('plan', roles.po, {
            title: request.title,
            request: request.request,
            plan,
            gateComment: comment,
          })
          if (!po.outcome.plan) {
            rec.finishStep(po.stepId, { status: 'failed', summary: 'no plan submitted' })
            throw new StepFailed('the PO finished without submitting a plan')
          }
          plan = po.outcome.plan
          rec.event(po.stepId, 'model.response', { plan })
          rec.finishStep(po.stepId, {
            status: 'passed',
            summary: revision > 1 ? `plan v${revision}` : `${plan.steps.length} steps`,
            model: po.outcome.model,
            fallbackUsed: po.outcome.fallbackUsed,
            attempt: po.outcome.attempt,
          })
          const gateStep = rec.startStep({ kind: 'gate' }, 'waiting')
          rec.setStatus('waiting')
          rec.event(gateStep, 'gate.waiting', { plan, revision })
          const decided = checkGateResult(
            await options.gate.decide({
              runId: rec.runId,
              title: request.title,
              plan,
              revision,
              budgetLeftMicros: budget - rec.spent,
            }),
          )
          rec.setStatus('running')
          const status: Record<GateDecision, StepStatus> = {
            approve: 'approved',
            reject: 'rejected',
            'request-changes': 'changes-requested',
          }
          const by = decided.by === 'person' ? 'you' : 'policy'
          rec.finishStep(gateStep, {
            status: status[decided.decision],
            summary: `${{ approve: 'approved', reject: 'rejected', 'request-changes': 'changes requested' }[decided.decision]} by ${by}`,
            decision: decided.decision,
            decidedBy: decided.by,
            comment: decided.comment,
          })
          rec.event(gateStep, 'gate.decided', {
            decision: decided.decision,
            by: decided.by,
            comment: decided.comment ?? null,
          })
          if (decided.decision === 'approve') break
          if (decided.decision === 'reject') return await finish('rejected')
          if (revision > MAX_PLAN_REVISIONS) {
            rec.event(gateStep, 'log', {
              level: 'info',
              message: `No more plan revisions after ${revision} plans; the run ends.`,
            })
            return await finish('rejected')
          }
          comment = decided.comment
        }
      }
      const base = { title: request.title, request: request.request, plan }
      if (node === 'code') {
        const eng = await modelStep('code', roles.engineer, base)
        rec.finishStep(eng.stepId, {
          status: 'passed',
          model: eng.outcome.model,
          fallbackUsed: eng.outcome.fallbackUsed,
          attempt: eng.outcome.attempt,
        })
      }
      if (node === 'review') {
        const rev = await modelStep('review', roles.reviewer, { ...base, diff: workspaceDiff(workspace) })
        review = rev.outcome.review ?? { verdict: 'approve', comments: [] }
        const n = review.comments.length
        rec.finishStep(rev.stepId, {
          status: 'passed',
          summary: n === 0 ? 'approved' : `${n} comment${n === 1 ? '' : 's'}`,
          model: rev.outcome.model,
          fallbackUsed: rev.outcome.fallbackUsed,
          attempt: rev.outcome.attempt,
        })
      }
      if (node === 'test') {
        const qa = await modelStep('test', roles.qa, { ...base, diff: workspaceDiff(workspace) })
        tests = await authoritativeTests(qa.stepId)
        rec.finishStep(qa.stepId, {
          status: testsPass(tests) ? 'passed' : 'failed',
          summary: testSummary(tests),
          model: qa.outcome.model,
          fallbackUsed: qa.outcome.fallbackUsed,
          attempt: qa.outcome.attempt,
        })
      }
    }

    for (let loop = 1; tests && !testsPass(tests) && loop <= MAX_FIX_LOOPS; loop++) {
      const loopStep = rec.startStep({ kind: 'fix-loop', loopIndex: loop })
      const reason = tests.error
        ? `the tests did not run: ${tests.error}`
        : `QA failed ${tests.failed} of ${tests.total} tests`
      rec.event(loopStep, 'loop.started', { loop, of: MAX_FIX_LOOPS, reason })
      const failures = tests.failures
      try {
        const base = { title: request.title, request: request.request, plan, loop }
        const fix = await modelStep(
          'fix',
          roles.engineer,
          { ...base, failures, reviewComments: review?.comments, diff: workspaceDiff(workspace) },
          loopStep,
        )
        rec.finishStep(fix.stepId, {
          status: 'passed',
          summary: `attempt ${loop + 1}`,
          model: fix.outcome.model,
          fallbackUsed: fix.outcome.fallbackUsed,
          attempt: fix.outcome.attempt,
        })
        const qa = await modelStep('test', roles.qa, { ...base, diff: workspaceDiff(workspace) }, loopStep)
        tests = await authoritativeTests(qa.stepId)
        rec.finishStep(qa.stepId, {
          status: testsPass(tests) ? 'passed' : 'failed',
          summary: testSummary(tests),
          model: qa.outcome.model,
          fallbackUsed: qa.outcome.fallbackUsed,
          attempt: qa.outcome.attempt,
        })
      } catch (error) {
        rec.finishStep(loopStep, { status: 'failed', summary: `of ${MAX_FIX_LOOPS}` })
        throw error
      }
      const last = loop === MAX_FIX_LOOPS
      rec.finishStep(loopStep, {
        status: testsPass(tests) || !last ? 'fix-loop' : 'failed',
        summary: `of ${MAX_FIX_LOOPS}`,
      })
    }
    if (tests && testsPass(tests)) return await finish('passed', undefined, tests)
    return await finish('failed', 'fix-loops-exhausted', tests)
  } catch (error) {
    if (!(error instanceof BudgetExceeded || error instanceof StepFailed)) {
      rec.event(null, 'log', { level: 'error', message: (error as Error).message })
    }
    return await finish('failed', reasonOf(error))
  }
}
