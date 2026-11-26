// The human gate between the plan and the code. A person decides in the demo and in live runs (the
// CLI and the app implement GateDecider); the evaluation uses the logged policy, so every run there
// is decided the same way and the trace says so.

import type { GateDecision } from '@crew/core'
import type { Decider } from '@crew/trace'

import type { Plan } from './roles.js'

export interface GateRequest {
  runId: number
  title: string
  plan: Plan
  /** 1 for the first plan, 2 after one "request changes", and so on. */
  revision: number
  /** Budget left for the run, in micros. */
  budgetLeftMicros: number
}

export interface GateResult {
  decision: GateDecision
  by: Decider
  /** Required for "request changes" (it goes back to the PO) and "reject" (the only record of why). */
  comment?: string
}

export interface GateDecider {
  decide(request: GateRequest): Promise<GateResult>
}

/** The evaluation's policy: approve every plan, and say in the trace that the policy did it. */
export const approveByPolicy: GateDecider = {
  decide: async () => ({
    decision: 'approve',
    by: 'policy',
    comment: 'Approved by the evaluation policy: every plan is approved.',
  }),
}

/** Decides from a list, in order: for tests and recorded demos. */
export function scriptedGate(decisions: GateResult[]): GateDecider {
  let next = 0
  return {
    decide: async () => {
      const result = decisions[next++]
      if (!result) throw new Error('The scripted gate has no decision left.')
      return result
    },
  }
}

/** Throws when a decision lacks the comment it needs. */
export function checkGateResult(result: GateResult): GateResult {
  if (result.decision !== 'approve' && !result.comment?.trim()) {
    throw new Error(`"${result.decision}" needs a comment: it is the only record of why.`)
  }
  return result
}
