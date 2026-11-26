// The README's scoreboard block, written from the scoreboards in evals/results/ (one per request
// set: easy, the baseline, and hard). No number in it is typed by hand: tests/readme.test.ts fails
// when the README falls behind, and `pnpm readme` rewrites the block.
import { parseResults, type Results, type VariantResult } from '@crew/evals'

export const START = '<!-- scoreboard:start (generated from evals/results/*.json by `pnpm readme`) -->'
export const END = '<!-- scoreboard:end -->'

export type RequestSet = 'easy' | 'hard'

export interface Scoreboard {
  set: RequestSet
  file: string
  results: Results
}

/** A scoreboard file: the results plus its request set (absent in files written before sets: easy). */
export function readScoreboard(file: string, raw: unknown): Scoreboard {
  const set = (raw as { set?: RequestSet }).set === 'hard' ? 'hard' : 'easy'
  return { set, file, results: parseResults(raw) }
}

/** "claude-haiku-5-5" → "Claude Haiku 5.5". */
export function modelName(id: string): string {
  const words = id.split('-')
  const out: string[] = []
  for (const w of words) {
    const prev = out.at(-1)
    if (/^\d{1,2}$/.test(w) && prev && /^\d{1,2}(\.\d{1,2})*$/.test(prev))
      out[out.length - 1] = `${prev}.${w}`
    else out.push(/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))
  }
  return out.join(' ')
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const pm = (s: { mean: number; sd: number }) => `${pct(s.mean)} ± ${Math.round(s.sd * 100)}`
const money = (x: number) => `$${x.toFixed(4)}`
const times = (x: number) => {
  const r = Math.round(x * 10) / 10
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}×`
}
const by = (r: Results, v: VariantResult['variant']) => r.main.find((m) => m.variant === v)
const tie = (a: VariantResult, b: VariantResult) =>
  Math.abs(a.passRate.mean - b.passRate.mean) <= a.passRate.sd + b.passRate.sd

const NAMES: Record<VariantResult['variant'], string> = {
  'single-agent': 'Single agent',
  crew: 'Crew, no playbook',
  'crew-playbook': 'Crew + playbook',
}

function sentences({ set, results: r }: Scoreboard): string[] {
  const one = by(r, 'single-agent')
  const crew = by(r, 'crew')
  const learned = by(r, 'crew-playbook')
  const out: string[] = []
  if (one && crew) {
    const alone =
      one.passRate.mean === 1 && one.passRate.sd === 0
        ? `passed all ${r.requests} in each of ${r.rounds} rounds (${pm(one.passRate)})`
        : `passed ${pm(one.passRate)} of them over ${r.rounds} rounds`
    const same = pm(one.passRate) === pm(crew.passRate)
    out.push(
      `On ${r.requests} feature requests with hidden acceptance tests, a single ${modelName(r.model)} agent ${alone}. The four-role crew ${same ? 'also passed' : 'passed'} ${pm(crew.passRate)}, at ${times(crew.costUsdPerRequest.mean / one.costUsdPerRequest.mean)} the cost per request (${money(crew.costUsdPerRequest.mean)} vs ${money(one.costUsdPerRequest.mean)}) and ${times(crew.secondsPerRequest.mean / one.secondsPerRequest.mean)} the time.`,
    )
  }
  const learningRuns = new Set(
    r.runs
      .filter((x) => x.suite === 'learning-curve')
      .map((x) => `${x.requestId}|${x.round}|${x.playbookVersion}`),
  ).size
  const lessons = r.playbook.lessons.length
  const accepted = r.playbook.lessons.filter((l) => l.status === 'accepted').length
  if (r.playbook.learnedVersion === 1)
    out.push(
      `The learning loop found nothing to learn: in ${learningRuns} learning runs the retro proposed ${lessons} ${lessons === 1 ? 'lesson' : 'lessons'}, so the playbook stayed at v1.${learned ? ` With v1, the crew passed ${pm(learned.passRate)}.` : ''}`,
    )
  else
    out.push(
      `In ${learningRuns} learning runs the retro proposed ${lessons} lessons; ${accepted} became rules, taking the playbook to v${r.playbook.learnedVersion}.${
        learned && crew
          ? learned.passRate.mean > crew.passRate.mean + learned.passRate.sd + crew.passRate.sd
            ? ` With it, the crew passed ${pm(learned.passRate)}, up from ${pm(crew.passRate)} without it.`
            : ` The rules did not make the crew better: with them it passed ${pm(learned.passRate)}, against ${pm(crew.passRate)} without them.`
          : ''
      }`,
    )
  if (one && crew) {
    const best = learned && learned.passRate.mean > crew.passRate.mean ? learned : crew
    if (tie(one, best))
      out.push(
        set === 'easy'
          ? 'On tasks this size, splitting the work buys cost, not accuracy. What the crew adds here is the human gate and a trace you can audit.'
          : 'On the harder set too, splitting the work buys cost, not accuracy. What the crew adds is the human gate and a trace you can audit.',
      )
    else if (best.passRate.mean > one.passRate.mean)
      out.push(
        `Here the crew earns its cost: ${Math.round((best.passRate.mean - one.passRate.mean) * 100)} points more requests pass than with one agent.`,
      )
    else
      out.push(
        `Here one agent does better than the crew (${pm(one.passRate)} vs ${pm(best.passRate)}), and costs less.`,
      )
  }
  out.push(
    `The whole evaluation, ${r.runs.length} runs, cost $${r.spentUsd.total.toFixed(2)} under a hard $${r.budgetUsd.total.toFixed(2)} cap.`,
  )
  return out
}

function table(r: Results): string[] {
  return [
    '| Variant | Requests passing | Cost per request | Time per request | Fix loops per request |',
    '| --- | --: | --: | --: | --: |',
    ...r.main.map(
      (m) =>
        `| ${m.variant === 'crew-playbook' ? `${NAMES[m.variant]} v${m.playbookVersion}` : NAMES[m.variant]} | ${pm(m.passRate)} | ${money(m.costUsdPerRequest.mean)} | ${Math.round(m.secondsPerRequest.mean)} s | ${m.variant === 'single-agent' ? 'does not apply' : m.fixLoopsPerRequest.mean.toFixed(2)} |`,
    ),
  ]
}

/** The block between the markers, from the scoreboards (hard first). Formatted as Prettier would. */
export function scoreboardBlock(boards: Scoreboard[]): string {
  // The hard set first: it is the stronger test.
  const sorted = [...boards].sort((a, b) => (a.set === b.set ? 0 : a.set === 'hard' ? -1 : 1))
  const parts: string[] = [START, '']
  for (const b of sorted) {
    const r = b.results
    parts.push(
      `### ${b.set === 'easy' ? 'Easy set · the baseline' : 'Hard set'}`,
      '',
      ...sentences(b).flatMap((s) => [s, '']),
      ...table(r),
      '',
      ...((r as Results & { notes?: string[] }).notes?.length
        ? [...(r as Results & { notes?: string[] }).notes!.map((n) => `- Note: ${n}`), '']
        : []),
      `${r.model} (fallback ${r.fallbackModel ?? 'none'}) · ${r.requests} requests × ${r.main.length} variants × ${r.rounds} rounds · run ${r.runAt.slice(0, 10)} · mean ± standard deviation across rounds · [full results](${b.file.replace(/\.json$/, '.md')})`,
      '',
    )
  }
  parts.push(END)
  return parts.join('\n')
}

/** The README with its block replaced. */
export function withScoreboard(readme: string, block: string): string {
  const a = readme.indexOf(START.slice(0, 22))
  const b = readme.indexOf(END)
  if (a < 0 || b < 0) throw new Error('The README has no scoreboard markers.')
  return readme.slice(0, a) + block + readme.slice(b + END.length)
}
