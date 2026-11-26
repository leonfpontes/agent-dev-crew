// Writes one run into the trace as it happens: the run row, each step (parents before children),
// every event in order and one cost row per model call. Offsets count from the start of the run.

import type { GateDecision, Role, StepStatus, Variant } from '@crew/core'
import type {
  Decider,
  EvalSuite,
  EventKind,
  FailureReason,
  RunOrigin,
  RunStatus,
  StepKind,
  TraceDb,
} from '@crew/trace'

import type { TokenUsage } from './provider.js'

export interface RunStart {
  title: string
  request: string
  requestId?: string
  variant: Variant
  playbookVersion?: number
  origin: RunOrigin
  evalSuite?: EvalSuite
  evalRound?: number
  repoRef: string
  model: string
  budgetMicros: number
}

export interface StepStart {
  kind: StepKind
  role?: Role
  parentId?: number
  loopIndex?: number
  maxAttempts?: number
}

export interface StepEnd {
  status: StepStatus
  summary?: string
  model?: string
  fallbackUsed?: boolean
  attempt?: number
  decision?: GateDecision
  decidedBy?: Decider
  comment?: string
}

export class TraceRecorder {
  runId = 0
  private startedAt = 0
  private seq = 0
  private stepSeq = 0
  private stepStarts = new Map<number, number>()
  private spentMicros = 0

  constructor(
    private readonly db: TraceDb,
    private readonly clock: () => number = Date.now,
  ) {}

  private offset() {
    return Math.max(0, this.clock() - this.startedAt)
  }

  /** Micros spent on model calls so far in this run. */
  get spent() {
    return this.spentMicros
  }

  startRun(run: RunStart): number {
    this.startedAt = this.clock()
    const result = this.db
      .prepare(
        /* sql */ `INSERT INTO runs (title, request, request_id, variant, playbook_version, origin, eval_suite,
          eval_round, status, repo_ref, model, budget_micros, started_at)
        VALUES (:title, :request, :request_id, :variant, :playbook_version, :origin, :eval_suite, :eval_round,
          'running', :repo_ref, :model, :budget_micros, :started_at)`,
      )
      .run({
        title: run.title,
        request: run.request,
        request_id: run.requestId ?? null,
        variant: run.variant,
        playbook_version: run.playbookVersion ?? null,
        origin: run.origin,
        eval_suite: run.evalSuite ?? null,
        eval_round: run.evalRound ?? null,
        repo_ref: run.repoRef,
        model: run.model,
        budget_micros: run.budgetMicros,
        started_at: new Date(this.startedAt).toISOString(),
      })
    this.runId = Number(result.lastInsertRowid)
    this.event(null, 'run.started', { variant: run.variant, playbook: run.playbookVersion ?? null })
    return this.runId
  }

  setStatus(status: Extract<RunStatus, 'running' | 'waiting'>) {
    this.db.prepare('UPDATE runs SET status = ? WHERE id = ?').run(status, this.runId)
  }

  event(stepId: number | null, kind: EventKind, payload: unknown = {}) {
    this.db
      .prepare(
        'INSERT INTO events (run_id, step_id, seq, offset_ms, kind, payload) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(this.runId, stepId, ++this.seq, this.offset(), kind, JSON.stringify(payload))
  }

  startStep(step: StepStart, status: StepStatus = 'running'): number {
    const offset = this.offset()
    const result = this.db
      .prepare(
        /* sql */ `INSERT INTO steps (run_id, parent_id, seq, kind, role, status, max_attempts, loop_index, offset_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.runId,
        step.parentId ?? null,
        ++this.stepSeq,
        step.kind,
        step.role ?? null,
        status,
        step.maxAttempts ?? 1,
        step.loopIndex ?? null,
        offset,
      )
    const id = Number(result.lastInsertRowid)
    this.stepStarts.set(id, offset)
    this.event(id, 'step.started', { kind: step.kind, role: step.role ?? null })
    return id
  }

  finishStep(id: number, end: StepEnd) {
    const duration = this.offset() - (this.stepStarts.get(id) ?? 0)
    this.db
      .prepare(
        /* sql */ `UPDATE steps SET status = :status, summary = :summary, model = :model,
          fallback_used = :fallback, attempt = :attempt, max_attempts = MAX(max_attempts, :attempt),
          duration_ms = :duration, decision = :decision, decided_by = :decided_by, comment = :comment
        WHERE id = :id`,
      )
      .run({
        id,
        status: end.status,
        summary: end.summary ?? null,
        model: end.model ?? null,
        fallback: end.fallbackUsed ? 1 : 0,
        attempt: end.attempt ?? 1,
        duration,
        decision: end.decision ?? null,
        decided_by: end.decidedBy ?? null,
        comment: end.comment ?? null,
      })
    this.event(id, 'step.finished', { status: end.status })
  }

  cost(stepId: number, model: string, usage: TokenUsage, micros: number) {
    this.spentMicros += micros
    this.db
      .prepare(
        /* sql */ `INSERT INTO costs (run_id, step_id, model, input_tokens, cache_read_tokens, cache_write_tokens,
          output_tokens, cost_micros, offset_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.runId,
        stepId,
        model,
        usage.inputTokens,
        usage.cacheReadTokens,
        usage.cacheWriteTokens,
        usage.outputTokens,
        micros,
        this.offset(),
      )
  }

  finishRun(end: {
    status: Exclude<RunStatus, 'running' | 'waiting'>
    failureReason?: FailureReason
    tests?: { passed: number; total: number }
    diff?: string
  }) {
    this.db
      .prepare(
        /* sql */ `UPDATE runs SET status = :status, failure_reason = :reason, duration_ms = :duration,
          tests_passed = :passed, tests_total = :total, diff = :diff WHERE id = :id`,
      )
      .run({
        id: this.runId,
        status: end.status,
        reason: end.failureReason ?? null,
        duration: this.offset(),
        passed: end.tests?.passed ?? null,
        total: end.tests?.total ?? null,
        diff: end.diff || null,
      })
    this.event(null, 'run.finished', { status: end.status, failureReason: end.failureReason ?? null })
  }
}

/** Records the hidden tests of a finished run (the evaluation scores them after the crew stops). */
export function recordHiddenTests(db: TraceDb, runId: number, passed: number, total: number) {
  db.prepare('UPDATE runs SET hidden_passed = ?, hidden_total = ? WHERE id = ?').run(passed, total, runId)
}
