// The human gate over HTTP, for live runs: the engine asks, the run waits, and a person answers from
// the app (POST /api/runs/:id/gate). One pending decision per run.

import type { GateDecider, GateRequest, GateResult } from '@crew/engine'

interface Pending {
  request: GateRequest
  resolve: (result: GateResult) => void
}

export class WebGate implements GateDecider {
  private pending = new Map<number, Pending>()

  decide(request: GateRequest): Promise<GateResult> {
    return new Promise((resolve) => this.pending.set(request.runId, { request, resolve }))
  }

  /** The plan waiting at the gate of a run, if any. */
  waiting(runId: number): GateRequest | undefined {
    return this.pending.get(runId)?.request
  }

  waitingRuns(): number[] {
    return [...this.pending.keys()]
  }

  /** Answers the gate of a run; false when nothing is waiting there. */
  answer(runId: number, result: Omit<GateResult, 'by'>): boolean {
    const pending = this.pending.get(runId)
    if (!pending) return false
    this.pending.delete(runId)
    pending.resolve({ ...result, by: 'person' })
    return true
  }
}
