// The scoreboard: everything the README, the app and the replay seed read about the evaluation,
// computed from the evaluation's trace with the same queries the screens use, so the numbers can't
// drift apart. `evals/results/latest.json` is the source; `latest.md` is the same, for people.

import type { Variant } from '@crew/core'
import {
  evaluationSummary,
  learningCurve,
  meanSd,
  MICROS_PER_USD,
  requestMatrix,
  type EvalSuite,
  type TraceDb,
} from '@crew/trace'
import * as v from 'valibot'

export const RESULTS_SCHEMA_VERSION = 1

const MeanSd = v.object({ mean: v.number(), sd: v.number() })

export const VariantResultSchema = v.object({
  variant: v.picklist(['single-agent', 'crew', 'crew-playbook']),
  playbookVersion: v.nullable(v.number()),
  rounds: v.number(),
  runs: v.number(),
  /** Share of requests whose hidden tests all passed (the "PR" is good), 0 to 1. */
  passRate: MeanSd,
  /** Share of hidden tests passing, 0 to 1 (partial credit). */
  hiddenTestRate: MeanSd,
  costUsdPerRequest: MeanSd,
  tokensPerRequest: MeanSd,
  secondsPerRequest: MeanSd,
  fixLoopsPerRequest: MeanSd,
  gateInterventions: v.number(),
  gates: v.number(),
  costUsd: v.number(),
})

export const CurvePointSchema = v.object({
  playbookVersion: v.number(),
  /** 3 rounds = a solid point; 1 round = a hollow point. */
  rounds: v.number(),
  passRate: MeanSd,
  /** Rules in the playbook at this version. */
  rules: v.number(),
  title: v.string(),
})

export const RunRowSchema = v.object({
  id: v.number(),
  requestId: v.string(),
  variant: v.picklist(['single-agent', 'crew', 'crew-playbook']),
  playbookVersion: v.nullable(v.number()),
  suite: v.picklist(['main', 'learning-curve']),
  round: v.number(),
  status: v.string(),
  failureReason: v.nullable(v.string()),
  testsPassed: v.nullable(v.number()),
  testsTotal: v.nullable(v.number()),
  hiddenPassed: v.number(),
  hiddenTotal: v.number(),
  costMicros: v.number(),
  tokens: v.object({ input: v.number(), cacheRead: v.number(), cacheWrite: v.number(), output: v.number() }),
  durationMs: v.number(),
  fixLoops: v.number(),
  /** Gate steps, and the ones where the policy didn't simply approve. */
  gates: v.number(),
  fallbackUsed: v.boolean(),
})

export const ResultsSchema = v.object({
  schema: v.literal(RESULTS_SCHEMA_VERSION),
  /** The request set: `easy` (the baseline) or `hard`. Absent in scoreboards written before sets. */
  set: v.optional(v.picklist(['easy', 'hard']), 'easy'),
  runAt: v.string(),
  model: v.string(),
  fallbackModel: v.nullable(v.string()),
  promptVersion: v.string(),
  repoRef: v.string(),
  requests: v.number(),
  rounds: v.number(),
  concurrency: v.number(),
  budgetUsd: v.object({ total: v.number(), learningCurve: v.number(), perRun: v.number() }),
  spentUsd: v.object({ total: v.number(), main: v.number(), learningCurve: v.number() }),
  stoppedEarly: v.boolean(),
  /** What a reader must know to read the numbers right (a known bug, a missing round), in English. */
  notes: v.optional(v.array(v.string()), []),
  main: v.array(VariantResultSchema),
  curve: v.array(CurvePointSchema),
  matrix: v.array(
    v.object({
      requestId: v.string(),
      title: v.string(),
      hiddenTests: v.number(),
      results: v.record(v.string(), v.array(v.boolean())),
    }),
  ),
  playbook: v.object({
    learnedVersion: v.number(),
    versions: v.array(
      v.object({
        version: v.number(),
        title: v.string(),
        status: v.string(),
        source: v.string(),
        sourceRunId: v.nullable(v.number()),
        decidedBy: v.nullable(v.string()),
        content: v.string(),
        diff: v.nullable(v.string()),
      }),
    ),
    lessons: v.array(
      v.object({
        runId: v.number(),
        position: v.number(),
        error: v.string(),
        cause: v.string(),
        rule: v.string(),
        section: v.string(),
        status: v.string(),
        playbookVersion: v.nullable(v.number()),
        duplicateOf: v.nullable(v.number()),
      }),
    ),
  }),
  runs: v.array(RunRowSchema),
})

export type Results = v.InferOutput<typeof ResultsSchema>
export type VariantResult = v.InferOutput<typeof VariantResultSchema>

export const parseResults = (input: unknown): Results => v.parse(ResultsSchema, input)

const usd = (micros: number) => micros / MICROS_PER_USD
const ms = (stat: { mean: number; sd: number }, f: (n: number) => number) => ({
  mean: f(stat.mean),
  sd: f(stat.sd),
})

export interface ResultsMeta {
  set?: 'easy' | 'hard'
  runAt: string
  model: string
  fallbackModel: string | null
  promptVersion: string
  repoRef: string
  requests: number
  rounds: number
  concurrency: number
  budgetUsd: Results['budgetUsd']
  stoppedEarly: boolean
  learnedVersion: number
  notes?: string[]
}

const countRules = (content: string) => content.split('\n').filter((l) => /^\s*-\s+/.test(l)).length

/** The scoreboard of an evaluation trace. */
export function buildResults(trace: TraceDb, meta: ResultsMeta): Results {
  const runs = trace
    .prepare(
      /* sql */ `SELECT r.id, r.request_id, r.variant, r.playbook_version, r.eval_suite, r.eval_round, r.status,
        r.failure_reason, r.tests_passed, r.tests_total, COALESCE(r.hidden_passed, 0) AS hidden_passed,
        COALESCE(r.hidden_total, 0) AS hidden_total, COALESCE(r.duration_ms, 0) AS duration_ms,
        (SELECT COALESCE(SUM(cost_micros), 0) FROM costs c WHERE c.run_id = r.id) AS cost,
        (SELECT COALESCE(SUM(input_tokens), 0) FROM costs c WHERE c.run_id = r.id) AS input,
        (SELECT COALESCE(SUM(cache_read_tokens), 0) FROM costs c WHERE c.run_id = r.id) AS cache_read,
        (SELECT COALESCE(SUM(cache_write_tokens), 0) FROM costs c WHERE c.run_id = r.id) AS cache_write,
        (SELECT COALESCE(SUM(output_tokens), 0) FROM costs c WHERE c.run_id = r.id) AS output,
        (SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.kind = 'fix-loop') AS fix_loops,
        (SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.kind = 'gate') AS gates,
        (SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.fallback_used = 1) AS fallbacks
      FROM runs r WHERE r.eval_suite IS NOT NULL ORDER BY r.id`,
    )
    .all() as Record<string, number | string | null>[]
  const rows: Results['runs'] = runs.map((r) => ({
    id: r.id as number,
    requestId: r.request_id as string,
    variant: r.variant as Variant,
    playbookVersion: r.playbook_version as number | null,
    suite: r.eval_suite as EvalSuite,
    round: r.eval_round as number,
    status: r.status as string,
    failureReason: r.failure_reason as string | null,
    testsPassed: r.tests_passed as number | null,
    testsTotal: r.tests_total as number | null,
    hiddenPassed: r.hidden_passed as number,
    hiddenTotal: r.hidden_total as number,
    costMicros: r.cost as number,
    tokens: {
      input: r.input as number,
      cacheRead: r.cache_read as number,
      cacheWrite: r.cache_write as number,
      output: r.output as number,
    },
    durationMs: r.duration_ms as number,
    fixLoops: r.fix_loops as number,
    gates: r.gates as number,
    fallbackUsed: (r.fallbacks as number) > 0,
  }))

  const hiddenRate = (variant: Variant, version: number | null) => {
    const byRound = new Map<number, { p: number; t: number }>()
    for (const r of rows)
      if (r.suite === 'main' && r.variant === variant && r.playbookVersion === version) {
        const acc = byRound.get(r.round) ?? { p: 0, t: 0 }
        byRound.set(r.round, { p: acc.p + r.hiddenPassed, t: acc.t + r.hiddenTotal })
      }
    const { mean, sd } = meanSd([...byRound.values()].map((x) => (x.t ? x.p / x.t : 0)))
    return { mean, sd }
  }

  const order = (variant: Variant) => ['single-agent', 'crew', 'crew-playbook'].indexOf(variant)
  const main: VariantResult[] = evaluationSummary(trace, 'main')
    .sort((a, b) => order(a.variant) - order(b.variant))
    .map((s) => ({
      variant: s.variant,
      playbookVersion: s.playbookVersion,
      rounds: s.rounds,
      runs: rows.filter(
        (r) => r.suite === 'main' && r.variant === s.variant && r.playbookVersion === s.playbookVersion,
      ).length,
      passRate: s.passRate,
      hiddenTestRate: hiddenRate(s.variant, s.playbookVersion),
      costUsdPerRequest: ms(s.costMicrosPerRequest, usd),
      tokensPerRequest: s.tokensPerRequest,
      secondsPerRequest: ms(s.durationMsPerRequest, (n) => n / 1000),
      fixLoopsPerRequest: s.fixLoopsPerRequest,
      gateInterventions: s.gateInterventions,
      gates: s.gates,
      costUsd: usd(s.costMicros),
    }))

  const versions = trace
    .prepare(
      'SELECT version, title, status, source, source_run_id, decided_by, content, diff FROM playbook_versions ORDER BY version',
    )
    .all() as {
    version: number
    title: string
    status: string
    source: string
    source_run_id: number | null
    decided_by: string | null
    content: string
    diff: string | null
  }[]
  const curve = learningCurve(trace).map((p) => {
    const v = versions.find((x) => x.version === p.playbookVersion)
    return { ...p, rules: v ? countRules(v.content) : 0, title: v?.title ?? '' }
  })

  const lessons = trace
    .prepare(
      'SELECT run_id, position, error, cause, rule, section, status, playbook_version, duplicate_of FROM lessons ORDER BY run_id, position',
    )
    .all() as Record<string, string | number | null>[]

  const spent = (suite?: EvalSuite) =>
    usd(rows.filter((r) => !suite || r.suite === suite).reduce((s, r) => s + r.costMicros, 0))
  return parseResults({
    schema: RESULTS_SCHEMA_VERSION,
    set: meta.set ?? 'easy',
    runAt: meta.runAt,
    model: meta.model,
    fallbackModel: meta.fallbackModel,
    promptVersion: meta.promptVersion,
    repoRef: meta.repoRef,
    requests: meta.requests,
    rounds: meta.rounds,
    concurrency: meta.concurrency,
    budgetUsd: meta.budgetUsd,
    spentUsd: { total: spent(), main: spent('main'), learningCurve: spent('learning-curve') },
    stoppedEarly: meta.stoppedEarly,
    notes: meta.notes ?? [],
    main,
    curve,
    matrix: requestMatrix(trace).map((m) => ({ ...m, results: m.results as Record<string, boolean[]> })),
    playbook: {
      learnedVersion: meta.learnedVersion,
      versions: versions.map((x) => ({
        version: x.version,
        title: x.title,
        status: x.status,
        source: x.source,
        sourceRunId: x.source_run_id,
        decidedBy: x.decided_by,
        content: x.content,
        diff: x.diff,
      })),
      lessons: lessons.map((l) => ({
        runId: l.run_id as number,
        position: l.position as number,
        error: l.error as string,
        cause: l.cause as string,
        rule: l.rule as string,
        section: l.section as string,
        status: l.status as string,
        playbookVersion: l.playbook_version as number | null,
        duplicateOf: l.duplicate_of as number | null,
      })),
    },
    runs: rows,
  })
}

const pct = (x: { mean: number; sd: number }) => `${Math.round(x.mean * 100)}% ± ${Math.round(x.sd * 100)}`
const money = (x: { mean: number; sd: number }) => `$${x.mean.toFixed(4)} ± ${x.sd.toFixed(4)}`
const num = (x: { mean: number; sd: number }, digits = 0) =>
  `${x.mean.toFixed(digits)} ± ${x.sd.toFixed(digits)}`
const NAMES: Record<Variant, string> = {
  'single-agent': 'Single agent',
  crew: 'Crew, no playbook',
  'crew-playbook': 'Crew + learned playbook',
}

/** What a stopped evaluation lacks: ablation runs per variant, and curve points short of 3 rounds. */
export function missing(r: Results): string {
  const want = r.requests * r.rounds
  const main = r.main.filter((m) => m.runs < want).map((m) => `${m.variant} ${m.runs} of ${want} runs`)
  // The first and the last point get 3 rounds; the ones in between 1 by design.
  const ends = [r.curve[0], r.curve[r.curve.length - 1]].filter((p, i, all) => p && all.indexOf(p) === i)
  const curve = ends
    .filter((p) => p!.rounds < 3)
    .map((p) => `v${p!.playbookVersion} ${p!.rounds} round${p!.rounds === 1 ? '' : 's'} of 3`)
  return [
    main.length ? `ablation: ${main.join(', ')}` : 'ablation complete',
    curve.length ? `curve: ${curve.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('; ')
}

/** One sentence on what the learning epochs produced. */
export function learning(r: Results): string {
  const runs = r.runs.filter((x) => x.suite === 'learning-curve' && x.round === 11).length
  const proposed = r.playbook.lessons.length
  const added = r.playbook.lessons.filter((l) => l.status === 'accepted').length
  return r.playbook.learnedVersion === 1
    ? `The retro found nothing to learn: ${proposed} lessons in ${runs} learning runs, so the playbook stayed at v1 (${r.curve[0]?.rules ?? 0} initial rules) and \`crew-playbook\` ran with it.`
    : `The retro proposed ${proposed} lessons in ${runs} learning runs; ${added} became rules, taking the playbook from v1 to v${r.playbook.learnedVersion}.`
}

/** The scoreboard for people: the same numbers as latest.json. */
export function toMarkdown(r: Results): string {
  const lines = [
    r.set === 'hard' ? '# Evaluation results · hard set' : '# Evaluation results · easy set (baseline)',
    '',
    `${r.requests} feature requests × ${r.main.length} variants × ${r.rounds} rounds on \`${r.model}\` (fallback \`${r.fallbackModel ?? 'none'}\`), prompts \`${r.promptVersion}\`, example \`${r.repoRef}\`, run ${r.runAt.slice(0, 10)}.`,
    `Spent $${r.spentUsd.total.toFixed(2)} of the $${r.budgetUsd.total.toFixed(2)} cap (ablation $${r.spentUsd.main.toFixed(2)}, learning curve $${r.spentUsd.learningCurve.toFixed(2)} of its $${r.budgetUsd.learningCurve.toFixed(2)}).${r.stoppedEarly ? ` **Stopped early: the budget ran out, so some runs are missing** (${missing(r)}).` : ''}`,
    '',
    ...r.notes.flatMap((n) => [`> **Note:** ${n}`, '']),
    'Mean ± standard deviation across rounds. A request passes when all its hidden acceptance tests pass.',
    '',
    '| Variant | Requests passing | Hidden tests passing | Cost per request | Tokens per request | Time per request | Fix loops per request | Gate interventions |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...r.main.map(
      (m) =>
        `| ${m.variant === 'crew-playbook' ? `Crew + playbook v${m.playbookVersion}${r.playbook.learnedVersion === 1 ? ' (nothing learned)' : ' (learned)'}` : NAMES[m.variant]} | ${pct(m.passRate)} | ${pct(m.hiddenTestRate)} | ${money(m.costUsdPerRequest)} | ${num(m.tokensPerRequest)} | ${num(m.secondsPerRequest)} s | ${num(m.fixLoopsPerRequest, 2)} | ${m.gateInterventions} of ${m.gates} |`,
    ),
    '',
    `Times are wall-clock with ${r.concurrency} runs at once, so they compare variants, not machines.`,
    '',
    '## Learning curve',
    '',
    learning(r),
    '',
    'Requests passing per playbook version, for the versions a whole round ran with. 3 rounds = solid point, 1 round = hollow point.',
    '',
    '| Version | Rules | Rounds | Requests passing |',
    '| --- | --- | --- | --- |',
    ...r.curve.map((p) => `| v${p.playbookVersion} | ${p.rules} | ${p.rounds} | ${pct(p.passRate)} |`),
    '',
    '## Per request',
    '',
    `| Request | Hidden tests | ${r.main.map((m) => NAMES[m.variant]).join(' | ')} |`,
    `| --- | --- | ${r.main.map(() => '---').join(' | ')} |`,
    ...r.matrix.map(
      (m) =>
        `| ${m.title} | ${m.hiddenTests} | ${r.main.map((v) => (m.results[v.variant] ?? []).map((ok) => (ok ? '✓' : '✗')).join(' ')).join(' | ')} |`,
    ),
    '',
  ]
  return lines.join('\n')
}
