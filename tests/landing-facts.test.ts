// The How it works page states facts about the engine (tools, models, budget, fix loops). The app
// can't import the engine, so it keeps them in apps/web/src/lib/landing.ts; this keeps them true.
import { MAX_FIX_LOOPS } from '@crew/core'
import { AGENT_TOOLS, DEFAULT_BUDGET_MICROS, MODELS } from '@crew/engine'
import { describe, expect, it } from 'vitest'

import * as landing from '../apps/web/src/lib/landing.js'

describe('the How it works page says what the engine does', () => {
  it('lists each role with its tools', () => {
    for (const r of landing.ROLES) expect(r.tools, r.role).toEqual(AGENT_TOOLS[r.agent])
  })
  it('names the models, the budget per run and the fix loop limit', () => {
    expect(landing.MODELS).toEqual(MODELS)
    expect(landing.BUDGET_MICROS).toBe(DEFAULT_BUDGET_MICROS)
    expect(landing.MAX_FIX_LOOPS).toBe(MAX_FIX_LOOPS)
  })
})
