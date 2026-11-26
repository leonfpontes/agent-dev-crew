// Example data: the eight recorded runs the replay demo ships, #136 to #143, on fernhill-orders.
// Times are seconds from the start of the run; costs are US dollars; nothing here is measured.
// #142 carries the full trace (prompt, response, tools, raw API record) for its Engineer fix step;
// #143 is stopped at the human gate.

import type { GateDecision, Role, StepStatus, Variant } from '@crew/core'

import type {
  Decider,
  EventKind,
  FailureReason,
  LessonStatus,
  PlaybookSection,
  RunStatus,
  StepKind,
} from './contracts.js'

export interface SeedTokens {
  /** All input tokens, cached ones included. */
  in: number
  cached: number
  out: number
}

export interface SeedStep {
  kind: StepKind
  role?: Role
  status: StepStatus
  summary?: string
  /** Start, in seconds from the start of the run; absent for a step that hasn't started. */
  at?: number
  dur?: number
  /** US dollars. */
  cost?: number
  /** Exact tokens, or a total split as 85% input (60% of it cached) and 15% output. */
  tokens?: SeedTokens | number
  attempt?: number
  maxAttempts?: number
  decision?: GateDecision
  decidedBy?: Decider
  comment?: string
  loop?: number
  children?: SeedStep[]
  events?: { kind: EventKind; at: number; payload: unknown }[]
}

export interface SeedLesson {
  /** Path to the step where the error showed: top-level index, then child index. */
  step: number[]
  error: string
  cause: string
  rule: string
  section: PlaybookSection
  status: LessonStatus
  playbookVersion?: number
  duplicateOf?: number
}

export interface SeedRun {
  id: number
  requestId: string
  variant: Variant
  playbookVersion: number | null
  status: RunStatus
  failureReason?: FailureReason
  /** Minutes before the seed's "now" when the run started. */
  startedMinutesAgo: number
  /** Seconds; absent while running or waiting. */
  duration?: number
  repoRef: string
  tests?: [passed: number, total: number]
  hidden?: [passed: number, total: number]
  diff?: string
  steps: SeedStep[]
  lessons?: SeedLesson[]
}

const MODEL = 'claude-haiku-5-5'
export const SEED_MODEL = MODEL

const PLAN_142 = {
  steps: [
    'POST /orders/:id/cancel sets the status to "cancelled".',
    'Unknown order → 404; shipped or already cancelled order → 409.',
    'Reports skip cancelled orders.',
  ],
  acceptance: [
    'Cancelling a pending or paid order answers 200 with status "cancelled".',
    'Cancelling a shipped order answers 409.',
    'The daily total leaves cancelled orders out.',
  ],
  files: ['src/types.ts', 'src/routes/orders.ts', 'src/reports/daily-total.ts'],
  estimateUsd: [0.03, 0.06],
}

const PLAN_143 = {
  steps: [
    'Look up the SKU in the catalog before the item enters the cart.',
    'Unknown SKU → 404 with { "error": "Unknown SKU" }; the cart stays the same.',
    'Not enough stock for the quantity → 409; a known SKU with stock → current behaviour.',
  ],
  acceptance: [
    'POST /carts/:id/items with an unknown SKU answers 404.',
    'The cart does not change after a refused item.',
    'Existing cart tests still pass.',
  ],
  files: ['src/routes/cart.ts', 'tests/cart.test.ts'],
  estimateUsd: [0.02, 0.05],
}

const FAILING_QA_142 = [
  'QA failed 1 of 24 tests:',
  '✕ tests/orders.cancel.test.ts › keeps cancelled orders out of the daily total',
  'expected 2700, received 3077',
  'Fix the code. Do not edit the tests.',
].join('\n')

const DIFF_142 = `diff --git a/src/routes/orders.ts b/src/routes/orders.ts
--- a/src/routes/orders.ts
+++ b/src/routes/orders.ts
@@ -58,2 +58,11 @@ export function orderRoutes(router: Router, { db, now }: Context): void {

+  router.post('/orders/:id/cancel', async (_req, { id }) => {
+    const order = await db.orders.find(id as string)
+    if (!order) return fail(404, 'Order not found')
+    if (order.status === 'shipped' || order.status === 'cancelled') {
+      return fail(409, \`A \${order.status} order cannot be cancelled\`)
+    }
+    return json(await db.orders.update(order.id, { status: 'cancelled' }))
+  })
+
   router.get('/orders/:id/receipt', async (_req, { id }) => {
diff --git a/src/reports/daily-total.ts b/src/reports/daily-total.ts
--- a/src/reports/daily-total.ts
+++ b/src/reports/daily-total.ts
@@ -4,3 +4,4 @@ import type { Order } from '../types.js'
 export function dailyTotal(orders: Order[], day: string): number {
-  return orders.filter((o) => o.createdAt.slice(0, 10) === day).reduce((sum, o) => sum + o.totalCents, 0)
+  const counted = orders.filter((o) => o.status !== 'cancelled')
+  return counted.filter((o) => o.createdAt.slice(0, 10) === day).reduce((sum, o) => sum + o.totalCents, 0)
 }
diff --git a/tests/orders.cancel.test.ts b/tests/orders.cancel.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/orders.cancel.test.ts
@@ -0,0 +1,31 @@
+import { describe, expect, it } from 'vitest'
+
+import { client } from './helpers.js'
+
+describe('cancel an order', () => {
+  it('cancels a pending order', async () => {
+    const api = client()
+    const placed = await api.order('cus_ada', [['APL-GALA-1KG', 1]])
+    expect((await api.post(\`/orders/\${placed.body.id}/cancel\`)).body.status).toBe('cancelled')
+  })
+
+  it('refuses to cancel a shipped order with 409', async () => {
+    const api = client()
+    const placed = await api.order('cus_ada', [['APL-GALA-1KG', 1]])
+    await api.post(\`/orders/\${placed.body.id}/pay\`)
+    await api.post(\`/orders/\${placed.body.id}/ship\`)
+    expect((await api.post(\`/orders/\${placed.body.id}/cancel\`)).status).toBe(409)
+  })
+
+  it('answers 404 for an unknown order', async () => {
+    expect((await client().post('/orders/ord_9999/cancel')).status).toBe(404)
+  })
+
+  it('keeps cancelled orders out of the daily total', async () => {
+    const api = client()
+    await api.order('cus_ada', [['BRD-SOUR-800', 4]])
+    const other = await api.order('cus_ben', [['MLK-OAT-1L', 1]])
+    await api.post(\`/orders/\${other.body.id}/cancel\`)
+    expect((await api.get('/reports/daily-total?date=2026-11-20')).body.totalCents).toBe(2700)
+  })
+})
`

const ENGINEER_SYSTEM = [
  'You are the Engineer. You change code in a throwaway copy of the repository.',
  'Tools: read_file, write_file, run_tests. Never edit files under tests/.',
].join('\n')

/** The Engineer fix step of run #142, recorded in full. */
const FIX_EVENTS_142: SeedStep['events'] = [
  {
    kind: 'model.request',
    at: 163,
    payload: {
      prompt: 'prompts/engineer.md',
      playbook: { version: 7, section: 'Engineer' },
      system: ENGINEER_SYSTEM,
      rules: [
        'Read every file you change before you write it.',
        'Run the tests after each write; never edit a test to make it pass.',
      ],
      user: FAILING_QA_142,
      raw: {
        model: MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: 'You are the Engineer. …', cache_control: { type: 'ephemeral' } }],
        tools: ['read_file', 'write_file', 'run_tests'],
        messages: [{ role: 'user', content: 'QA failed 1 of 24 tests: …' }],
      },
    },
  },
  {
    kind: 'tool.call',
    at: 165,
    payload: { tool: 'read_file', input: { path: 'src/routes/orders.ts' } },
  },
  {
    kind: 'tool.result',
    at: 165.1,
    payload: {
      tool: 'read_file',
      ok: true,
      output: '// 82 lines · export function orderRoutes(router: Router, …',
    },
  },
  {
    kind: 'tool.call',
    at: 168,
    payload: { tool: 'read_file', input: { path: 'src/reports/daily-total.ts' } },
  },
  {
    kind: 'tool.result',
    at: 168.1,
    payload: {
      tool: 'read_file',
      ok: true,
      output:
        'export function dailyTotal(orders: Order[], day: string): number {\n' +
        '  return orders.filter((o) => o.createdAt.slice(0, 10) === day).reduce((sum, o) => sum + o.totalCents, 0)\n}',
    },
  },
  {
    kind: 'tool.call',
    at: 176,
    payload: {
      tool: 'write_file',
      input: { path: 'src/reports/daily-total.ts', content: '…const counted = orders.filter(…' },
    },
  },
  {
    kind: 'tool.result',
    at: 176,
    payload: { tool: 'write_file', ok: true, output: 'wrote 7 lines (+2 −1)' },
  },
  { kind: 'tool.call', at: 177, payload: { tool: 'run_tests', input: { command: 'vitest run' } } },
  {
    kind: 'tool.result',
    at: 178.92,
    payload: {
      tool: 'run_tests',
      ok: true,
      output: { command: 'vitest run', exitCode: 0, passed: 24, failed: 0, durationMs: 1920 },
    },
  },
  {
    kind: 'model.response',
    at: 185,
    payload: {
      stopReason: 'end_turn',
      text: [
        'The failing test expects the daily total to leave out cancelled orders.',
        'dailyTotal in src/reports/daily-total.ts summed every order.',
        'Change: filter out orders with status "cancelled" before the sum.',
        'Changed 1 file: src/reports/daily-total.ts (+2 −1).',
        'run_tests: 24 passed, 0 failed.',
      ].join('\n'),
      raw: {
        id: 'msg_example_0142_fix',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 1204,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 3408,
          output_tokens: 788,
        },
      },
    },
  },
]

const gate = (at: number, dur: number | undefined, decision?: GateDecision, comment?: string): SeedStep => ({
  kind: 'gate',
  status:
    decision === undefined
      ? 'waiting'
      : decision === 'approve'
        ? 'approved'
        : decision === 'reject'
          ? 'rejected'
          : 'changes-requested',
  summary:
    decision === undefined ? 'waiting for you' : `${decision === 'approve' ? 'approved' : 'rejected'} by you`,
  at,
  dur,
  ...(decision ? { decision, decidedBy: 'person' as const, comment } : {}),
  events: [
    { kind: 'gate.waiting', at, payload: {} },
    ...(decision && dur !== undefined
      ? [{ kind: 'gate.decided' as const, at: at + dur, payload: { decision, by: 'person', comment } }]
      : []),
  ],
})

const plan = (
  at: number,
  dur: number,
  cost: number,
  tokens: SeedTokens | number,
  planBody?: object,
): SeedStep => ({
  kind: 'plan',
  role: 'po',
  status: 'passed',
  at,
  dur,
  cost,
  tokens,
  maxAttempts: 3,
  events: planBody ? [{ kind: 'model.response', at: at + dur, payload: { plan: planBody } }] : undefined,
})

const step = (
  kind: StepKind,
  role: Role | undefined,
  status: StepStatus,
  at: number,
  dur: number,
  cost: number,
  tokens: SeedTokens | number,
  extra: Partial<SeedStep> = {},
): SeedStep => ({
  kind,
  role,
  status,
  at,
  dur,
  cost,
  tokens,
  maxAttempts: 3,
  ...extra,
})

const queued = (kind: StepKind, role?: Role): SeedStep => ({ kind, role, status: 'queued' })
const skipped = (kind: StepKind, role?: Role): SeedStep => ({ kind, role, status: 'skipped' })

export const SEED_RUNS: SeedRun[] = [
  {
    id: 143,
    requestId: 'validate-sku',
    variant: 'crew-playbook',
    playbookVersion: 7,
    status: 'waiting',
    startedMinutesAgo: 2,
    repoRef: 'fernhill-orders@a41c9e2',
    steps: [
      plan(0, 8.6, 0.004, { in: 2104, cached: 1630, out: 512 }, PLAN_143),
      gate(8.6, undefined),
      queued('code', 'engineer'),
      queued('review', 'reviewer'),
      queued('test', 'qa'),
      queued('retro'),
    ],
  },
  {
    id: 142,
    requestId: 'cancel-order',
    variant: 'crew-playbook',
    playbookVersion: 7,
    status: 'passed',
    startedMinutesAgo: 26,
    duration: 232,
    repoRef: 'fernhill-orders@9c2e71b',
    tests: [24, 24],
    hidden: [6, 6],
    diff: DIFF_142,
    steps: [
      plan(0, 9.8, 0.004, { in: 2210, cached: 1700, out: 420 }, PLAN_142),
      gate(9.8, 72, 'approve', 'Plan matches the request. Refunds stay out of scope.'),
      step(
        'code',
        'engineer',
        'passed',
        82,
        41,
        0.019,
        { in: 9402, cached: 6120, out: 1790 },
        { summary: 'attempt 1' },
      ),
      step(
        'review',
        'reviewer',
        'passed',
        123,
        12,
        0.008,
        { in: 6105, cached: 4410, out: 498 },
        { summary: '1 comment' },
      ),
      step(
        'test',
        'qa',
        'failed',
        135,
        28,
        0.003,
        { in: 1820, cached: 1200, out: 310 },
        {
          summary: '23 / 24',
          events: [
            {
              kind: 'tool.result',
              at: 160,
              payload: {
                tool: 'run_tests',
                ok: false,
                output: { passed: 23, failed: 1, failures: [FAILING_QA_142.split('\n')[1]] },
              },
            },
          ],
        },
      ),
      {
        kind: 'fix-loop',
        status: 'fix-loop',
        summary: 'of 2',
        loop: 1,
        at: 163,
        dur: 48,
        events: [
          { kind: 'loop.started', at: 163, payload: { loop: 1, of: 2, reason: 'QA failed 1 of 24 tests' } },
        ],
        children: [
          step(
            'fix',
            'engineer',
            'passed',
            163,
            22,
            0.011,
            { in: 4612, cached: 3408, out: 788 },
            {
              summary: 'attempt 2',
              attempt: 2,
              events: FIX_EVENTS_142,
            },
          ),
          step(
            'test',
            'qa',
            'passed',
            185,
            26,
            0.003,
            { in: 1700, cached: 1200, out: 235 },
            { summary: '24 / 24' },
          ),
        ],
      },
      step(
        'retro',
        undefined,
        'passed',
        211,
        21,
        0.003,
        { in: 1050, cached: 0, out: 260 },
        {
          summary: '2 lessons',
          events: [{ kind: 'lesson.proposed', at: 232, payload: { lessons: 2, proposed: 1, duplicates: 1 } }],
        },
      ),
    ],
    lessons: [
      {
        step: [4],
        error: 'QA failed: cancelled orders still counted in the daily total.',
        cause: 'The Engineer changed status without looking for other code that reads it.',
        rule: 'Before changing a status field, find every reader of it and add a test for each reader.',
        section: 'Engineer',
        status: 'proposed',
        playbookVersion: 8,
      },
      {
        step: [4],
        error: 'The first QA report said "1 test failed" without its name.',
        cause: 'The QA summarised the Vitest output.',
        rule: 'Name the failing test and paste the expected and received values.',
        section: 'QA',
        status: 'duplicate',
        duplicateOf: 6,
      },
    ],
  },
  {
    id: 141,
    requestId: 'paginate-orders',
    variant: 'crew-playbook',
    playbookVersion: 7,
    status: 'passed',
    startedMinutesAgo: 60,
    duration: 125,
    repoRef: 'fernhill-orders@9c2e71b',
    tests: [22, 22],
    hidden: [5, 5],
    steps: [
      plan(0, 9, 0.004, 2400),
      gate(9, 31, 'approve', 'Cursor by order id is fine.'),
      step('code', 'engineer', 'passed', 40, 45, 0.016, 9000, { summary: 'attempt 1' }),
      step('review', 'reviewer', 'passed', 85, 12, 0.007, 5300, { summary: 'no comments' }),
      step('test', 'qa', 'passed', 97, 18, 0.003, 2100, { summary: '22 / 22' }),
      step('retro', undefined, 'passed', 115, 10, 0.002, 1000, { summary: 'no lessons' }),
    ],
  },
  {
    id: 140,
    requestId: 'discount-codes',
    variant: 'crew-playbook',
    playbookVersion: 6,
    status: 'failed',
    failureReason: 'fix-loops-exhausted',
    startedMinutesAgo: 120,
    duration: 341,
    repoRef: 'fernhill-orders@9c2e71b',
    tests: [24, 25],
    hidden: [4, 7],
    steps: [
      plan(0, 10, 0.004, 2500),
      gate(10, 40, 'approve', 'Both codes, tax after the discount.'),
      step('code', 'engineer', 'passed', 50, 60, 0.02, 11000, { summary: 'attempt 1' }),
      step('review', 'reviewer', 'passed', 110, 12, 0.008, 6200, { summary: '2 comments' }),
      step('test', 'qa', 'failed', 122, 28, 0.003, 2200, { summary: '22 / 25' }),
      {
        kind: 'fix-loop',
        status: 'fix-loop',
        summary: 'of 2',
        loop: 1,
        at: 150,
        dur: 82,
        children: [
          step('fix', 'engineer', 'passed', 150, 50, 0.015, 8400, { summary: 'attempt 2', attempt: 2 }),
          step('test', 'qa', 'failed', 200, 32, 0.003, 2200, { summary: '23 / 25' }),
        ],
      },
      {
        kind: 'fix-loop',
        status: 'failed',
        summary: 'of 2',
        loop: 2,
        at: 232,
        dur: 88,
        children: [
          step('fix', 'engineer', 'passed', 232, 58, 0.028, 16000, { summary: 'attempt 3', attempt: 3 }),
          step('test', 'qa', 'failed', 290, 30, 0.003, 2300, { summary: '24 / 25' }),
        ],
      },
      step('retro', undefined, 'passed', 320, 21, 0.004, 3200, { summary: '1 lesson' }),
    ],
  },
  {
    id: 139,
    requestId: 'rate-limit-orders',
    variant: 'crew-playbook',
    playbookVersion: 6,
    status: 'failed',
    failureReason: 'over-budget',
    startedMinutesAgo: 180,
    duration: 250,
    repoRef: 'fernhill-orders@9c2e71b',
    steps: [
      plan(0, 11, 0.005, 3000),
      gate(11, 24, 'approve', 'Use the app clock.'),
      step('code', 'engineer', 'failed', 35, 215, 0.245, 149000, {
        summary: 'stopped at the budget',
        events: [{ kind: 'budget.exceeded', at: 250, payload: { budgetUsd: 0.25, spentUsd: 0.25 } }],
      }),
      skipped('review', 'reviewer'),
      skipped('test', 'qa'),
      skipped('retro'),
    ],
  },
  {
    id: 138,
    requestId: 'export-csv',
    variant: 'crew-playbook',
    playbookVersion: 6,
    status: 'rejected',
    startedMinutesAgo: 26 * 60,
    duration: 48,
    repoRef: 'fernhill-orders@9c2e71b',
    steps: [
      plan(0, 7, 0.003, 2100),
      {
        ...gate(
          7,
          41,
          'reject',
          'The plan writes a CSV library by hand; quote fields as RFC 4180 says and keep it small.',
        ),
      },
      skipped('code', 'engineer'),
      skipped('review', 'reviewer'),
      skipped('test', 'qa'),
      skipped('retro'),
    ],
  },
  {
    id: 137,
    requestId: 'receipt-email',
    variant: 'crew-playbook',
    playbookVersion: 6,
    status: 'passed',
    startedMinutesAgo: 27 * 60,
    duration: 108,
    repoRef: 'fernhill-orders@4b7d0e3',
    tests: [21, 21],
    hidden: [3, 3],
    steps: [
      plan(0, 8, 0.003, 2200),
      gate(8, 22, 'approve', 'One line, right after the name.'),
      step('code', 'engineer', 'passed', 30, 32, 0.014, 7600, { summary: 'attempt 1' }),
      step('review', 'reviewer', 'passed', 62, 12, 0.006, 4300, { summary: '1 comment' }),
      step('test', 'qa', 'passed', 74, 18, 0.002, 1500, { summary: '21 / 21' }),
      step('retro', undefined, 'passed', 92, 16, 0.002, 800, { summary: '1 lesson' }),
    ],
    lessons: [
      {
        step: [2],
        error: 'The Engineer edited the receipt test so it would pass, and the Reviewer caught it.',
        cause: 'The playbook said to run the tests, not that the tests are the spec.',
        rule: 'Run the tests after each write; never edit a test to make it pass.',
        section: 'Engineer',
        status: 'accepted',
        playbookVersion: 7,
      },
    ],
  },
  {
    id: 136,
    requestId: 'fix-rounding',
    variant: 'single-agent',
    playbookVersion: null,
    status: 'passed',
    startedMinutesAgo: 28 * 60,
    duration: 72,
    repoRef: 'fernhill-orders@4b7d0e3',
    tests: [20, 20],
    hidden: [4, 4],
    steps: [
      step('solo', undefined, 'passed', 0, 72, 0.024, 14900, {
        summary: 'plan, code and tests in one agent',
      }),
    ],
  },
]
