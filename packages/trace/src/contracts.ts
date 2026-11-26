// Names the trace stores that the engine (writes), the API and the app (read) share. The step
// statuses, roles, gate decisions and variants come from @crew/core; these are the trace's own.

/** Where a run comes from: a live run on this machine, the evaluation, or the recorded example. */
export const RUN_ORIGINS = ['live', 'eval', 'example'] as const
export type RunOrigin = (typeof RUN_ORIGINS)[number]

/** The state of a whole run. `waiting` = stopped at the human gate. */
export const RUN_STATUSES = ['running', 'waiting', 'passed', 'failed', 'rejected'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** Why a run failed; set exactly when the status is `failed`. */
export const FAILURE_REASONS = ['fix-loops-exhausted', 'over-budget', 'error'] as const
export type FailureReason = (typeof FAILURE_REASONS)[number]

/** The two sets of evaluation runs: the 3-variant ablation, and the playbook learning curve. */
export const EVAL_SUITES = ['main', 'learning-curve'] as const
export type EvalSuite = (typeof EVAL_SUITES)[number]

/**
 * What a step does. `fix-loop` groups one Engineer fix and the QA run after it; `solo` is the one
 * step of the single-agent variant; `retro` runs after the pipeline and blocks nothing.
 */
export const STEP_KINDS = [
  'plan',
  'gate',
  'code',
  'review',
  'test',
  'fix-loop',
  'fix',
  'retro',
  'solo',
] as const
export type StepKind = (typeof STEP_KINDS)[number]

/** Who decided at the gate: a person (demo, live) or the logged policy (evaluation). */
export const DECIDERS = ['person', 'policy'] as const
export type Decider = (typeof DECIDERS)[number]

/** Event kinds. The payload is JSON; its shape per kind is in docs/ARCHITECTURE.md. */
export const EVENT_KINDS = [
  'run.started',
  'run.finished',
  'step.started',
  'step.finished',
  'model.request',
  'model.response',
  'tool.call',
  'tool.result',
  'gate.waiting',
  'gate.decided',
  'loop.started',
  'budget.exceeded',
  'lesson.proposed',
  'log',
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const LESSON_STATUSES = ['proposed', 'accepted', 'rejected', 'duplicate'] as const
export type LessonStatus = (typeof LESSON_STATUSES)[number]

/** Playbook sections: one per role, in the order of playbook.md. */
export const PLAYBOOK_SECTIONS = ['PO', 'Engineer', 'Reviewer', 'QA'] as const
export type PlaybookSection = (typeof PLAYBOOK_SECTIONS)[number]

export const PLAYBOOK_STATUSES = ['proposed', 'approved', 'rejected'] as const
export type PlaybookStatus = (typeof PLAYBOOK_STATUSES)[number]

export const PLAYBOOK_SOURCES = ['initial', 'retro', 'manual'] as const
export type PlaybookSource = (typeof PLAYBOOK_SOURCES)[number]

/** Money is stored in millionths of a US dollar (micros), so sums never drift. */
export const MICROS_PER_USD = 1_000_000
