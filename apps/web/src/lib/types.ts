// The shapes the app reads from the API (docs/ARCHITECTURE.md → API). Rows keep the trace's column
// names (snake_case); money is in micros (USD millionths), time in milliseconds.

export type RunStatus = 'running' | 'waiting' | 'passed' | 'failed' | 'rejected'
export type FailureReason = 'fix-loops-exhausted' | 'over-budget' | 'error'
export type StepStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'waiting'
  | 'approved'
  | 'rejected'
  | 'changes-requested'
  | 'fix-loop'
  | 'skipped'
export type Variant = 'single-agent' | 'crew' | 'crew-playbook'
export type Role = 'po' | 'engineer' | 'reviewer' | 'qa'
export type StepKind = 'plan' | 'gate' | 'code' | 'review' | 'test' | 'fix-loop' | 'fix' | 'retro' | 'solo'
export type GateDecision = 'approve' | 'request-changes' | 'reject'

export const VARIANTS: readonly Variant[] = ['single-agent', 'crew', 'crew-playbook']

export interface Meta {
  mode: 'replay' | 'live'
  exampleData: boolean
  replaySpeeds: number[]
  live: { available: boolean; how?: string }
  /** The request sets /api/evaluation has a scoreboard for. */
  evaluationSets?: ('easy' | 'hard')[]
}

export interface RunListRow {
  id: number
  title: string
  status: RunStatus
  failure_reason: FailureReason | null
  variant: Variant
  playbook_version: number | null
  origin: 'live' | 'eval' | 'example'
  started_at: string
  duration_ms: number | null
  cost_micros: number
  tokens: number
  fix_loops: number
}

export interface RunsSummary {
  runs: number
  finished: number
  passed: number
  costMicros: number
  medianDurationMs: number | null
  fixLoops: number
}

export interface RunsResponse {
  runs: RunListRow[]
  summary: RunsSummary
  waiting: number[]
}

export interface RunRow {
  id: number
  title: string
  request: string
  request_id: string | null
  variant: Variant
  playbook_version: number | null
  origin: string
  status: RunStatus
  failure_reason: FailureReason | null
  repo_ref: string | null
  model: string | null
  budget_micros: number
  started_at: string
  duration_ms: number | null
  tests_passed: number | null
  tests_total: number | null
  hidden_passed: number | null
  hidden_total: number | null
  diff: string | null
}

export interface StepRow {
  id: number
  run_id: number
  parent_id: number | null
  seq: number
  kind: StepKind
  role: Role | null
  status: StepStatus
  summary: string | null
  model: string | null
  fallback_used: number
  attempt: number
  max_attempts: number
  loop_index: number | null
  offset_ms: number | null
  duration_ms: number | null
  decision: GateDecision | null
  decided_by: 'person' | 'policy' | null
  comment: string | null
  input_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  output_tokens: number
  cost_micros: number
}

export interface Lesson {
  id: number
  run_id: number
  step_id: number | null
  position: number
  error: string
  cause: string
  rule: string
  section: string
  status: 'proposed' | 'accepted' | 'rejected' | 'duplicate'
  playbook_version: number | null
  duplicate_of: number | null
}

/** The PO plan, as submit_plan records it: one cost estimate in USD. */
export interface Plan {
  steps: string[]
  acceptance: string[]
  files: string[]
  estimateUsd: number
}

export interface RunDetail {
  run: RunRow
  steps: StepRow[]
  costByPart: Record<string, number>
  lessons: Lesson[]
  gate: { waiting: boolean; plan: Plan | null; decidable: boolean }
}

export interface TimelineEvent {
  seq: number
  step_id: number | null
  offset_ms: number
  kind: string
  payload: Record<string, unknown> | null
}

export interface Timeline {
  runId: number
  durationMs: number
  replaySpeeds: number[]
  events: TimelineEvent[]
}

export interface EventRow {
  id: number
  run_id: number
  step_id: number | null
  seq: number
  offset_ms: number
  kind: string
  payload: Record<string, unknown>
}

export interface PlaybookVersion {
  version: number
  title: string
  content: string
  diff: string | null
  status: 'proposed' | 'approved' | 'rejected'
  source: 'initial' | 'retro' | 'manual'
  source_run_id: number | null
  created_at: string
  decided_at: string | null
  decided_by: string | null
  lesson_run_id: number | null
  lesson_position: number | null
  lesson_step_kind: StepKind | null
  lesson_step_role: Role | null
  lesson_step_attempt: number | null
}

export interface Stat {
  mean: number
  sd: number
}

export interface VariantStats {
  variant: Variant
  playbookVersion: number | null
  rounds: number
  passRate: Stat
  costMicrosPerRequest: Stat
  tokensPerRequest: Stat
  durationMsPerRequest: Stat
  fixLoopsPerRequest: Stat
  gateInterventions: number
  gates: number
  costMicros: number
}

export interface CurvePoint {
  playbookVersion: number
  rounds: number
  passRate: Stat
}

export interface MatrixRow {
  requestId: string
  title: string
  hiddenTests: number
  results: Partial<Record<Variant, boolean[]>>
}

export interface EvaluationResponse {
  /** The request set of this scoreboard (GET /api/evaluation?set=easy|hard). */
  set?: 'easy' | 'hard'
  /** Notes the evaluation wrote about this scoreboard (what is missing, and why). */
  notes?: string[]
  exampleData: boolean
  main: VariantStats[]
  learningCurve: { points: CurvePoint[]; variants: VariantStats[] }
  matrix: MatrixRow[]
  /** Optional facts about the run that produced the scoreboard, shown when the API sends them. */
  model?: string
  limitUsd?: number
  finishedAt?: string
}

export interface ApiErrorBody {
  error: string
  how?: string
}
