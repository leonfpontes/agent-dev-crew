// Names the engine, the trace, the API and the app share. Changing one is a contract change:
// update docs/ARCHITECTURE.md in the same pull request.

/** The four roles of the crew, in pipeline order. */
export const ROLES = ['po', 'engineer', 'reviewer', 'qa'] as const
export type Role = (typeof ROLES)[number]

/** Every status a step can show (each has its own icon shape in the app). */
export const STEP_STATUSES = [
  'queued',
  'running',
  'passed',
  'failed',
  'waiting', // the human gate is waiting for a decision
  'approved',
  'rejected',
  'changes-requested',
  'fix-loop', // QA sent the work back to the Engineer
  'skipped',
] as const
export type StepStatus = (typeof STEP_STATUSES)[number]

/** The gate's three decisions, as in a pull request review. */
export const GATE_DECISIONS = ['approve', 'request-changes', 'reject'] as const
export type GateDecision = (typeof GATE_DECISIONS)[number]

/** The three variants the evaluation compares. */
export const VARIANTS = ['single-agent', 'crew', 'crew-playbook'] as const
export type Variant = (typeof VARIANTS)[number]

/** How many times QA may send the work back before the run fails. */
export const MAX_FIX_LOOPS = 2
