// Evaluation: the headline, the learning curve per playbook version, cost × quality, all metrics
// with a check on the best value, and the request × variant matrix with one mark per round.
// Every number comes from /api/evaluation; until a real run exists the band marks them as examples.
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import {
  Button,
  cn,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@leonfpontes/atlas-ui'

import {
  CodeBlock,
  EmptyState,
  LoadError,
  MetaStrip,
  PageHeader,
  SectionHead,
  Small,
} from '../components/bits'
import { Icon } from '../components/icons'
import { Status } from '../components/Status'
import {
  bestOf,
  byVariant,
  costDigits,
  headline,
  labelWidth,
  niceMax,
  placeLabels,
  tick,
  passes,
  scope,
  SORTS,
  sortRows,
  spread,
  type SortKey,
} from '../lib/evaluation'
import { useApi } from '../lib/api'
import { clock, percent, sdPoints, tokensShort, usd } from '../lib/format'
import { useTitle } from '../lib/hooks'
import { Link } from '../lib/router'
import type { EvaluationResponse, Meta, PlaybookVersion, Variant, VariantStats } from '../lib/types'
import { VARIANTS } from '../lib/types'
import { VARIANT_LABEL } from './Runs'

/** The command that produces the scoreboard (evals/src/eval-cli.ts: every request, variant and round, under its cap). */
export const EVAL_COMMAND = 'pnpm eval'

const card = 'rounded-xl border bg-card'

function ChartCard({
  id,
  title,
  lead,
  children,
  frame,
}: {
  id: string
  title: string
  lead: string
  children: ReactNode
  frame: RefObject<HTMLDivElement | null>
}) {
  return (
    <section aria-labelledby={id} className={card}>
      <div className="grid gap-1 px-5 pt-5 max-[760px]:px-4">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{lead}</p>
      </div>
      <div ref={frame} className="px-5 pt-4 pb-5 max-[760px]:px-4">
        {children}
      </div>
    </section>
  )
}

/** Lowercase the first letter, not an acronym: "Read before write" → "read…", "PO lists" stays. */
const lower = (t: string) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t)

/**
 * The drawing frame of a chart. From 640 px up the 600-unit viewBox scales with the card; below,
 * the viewBox takes the card's real width, so the 12 px labels stay 12 px on a phone.
 */
function useChartFrame() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // The content box: the SVG's own width, without the card's padding.
    const style = getComputedStyle(el)
    setWidth(el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) || 600)
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width || 600)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const narrow = width > 0 && width < 640
  const W = narrow ? Math.round(width) : 600
  return { ref, W, L: narrow ? 40 : 60, R: narrow ? W - 8 : 580, narrow }
}

const Y0 = 200
const Y1 = 20
const y = (share: number) => Y0 - share * (Y0 - Y1)

function LearningCurve({ data, versions }: { data: EvaluationResponse; versions: PlaybookVersion[] }) {
  const points = data.learningCurve.points
  const maxV = Math.max(
    ...points.map((p) => p.playbookVersion),
    ...versions.filter((v) => v.status === 'approved').map((v) => v.version),
    1,
  )
  const { ref, W, L, R, narrow } = useChartFrame()
  const x = (v: number) => (maxV === 1 ? (L + R) / 2 : L + 20 + ((v - 1) * (R - L - 40)) / (maxV - 1))
  const title = (v: number) =>
    versions.find((p) => p.version === v)?.title ?? (v === 1 ? 'Initial playbook' : `v${v}`)
  const baselines = (['single-agent', 'crew'] as const)
    .map((v) => ({ v, s: byVariant(data.main, v) }))
    .filter((b): b is { v: 'single-agent' | 'crew'; s: VariantStats } => !!b.s)
  // One label per baseline, under its band; equal baselines share a label, and labels never touch.
  const baseLabels: { text: string; y: number }[] = []
  for (const { v, s } of [...baselines].sort((a, b) => b.s.passRate.mean - a.s.passRate.mean)) {
    const text = `${percent(s.passRate.mean)} ${sdPoints(s.passRate.sd)}`
    const name = v === 'single-agent' ? 'one agent' : 'crew, no playbook'
    const same = baseLabels.find(
      (l) =>
        l.text.endsWith(` ${text}`) &&
        Math.abs(l.y - (y(Math.max(0, s.passRate.mean - s.passRate.sd)) + 14)) < 1,
    )
    if (same) {
      same.text = `${same.text.slice(0, -text.length - 1)} and ${name} ${text}`
      continue
    }
    const want = y(Math.max(0, s.passRate.mean - s.passRate.sd)) + 14
    const prev = baseLabels.at(-1)
    baseLabels.push({ text: `${name} ${text}`, y: prev && want < prev.y + 14 ? prev.y + 14 : want })
  }
  const measured = new Set(points.map((p) => p.playbookVersion))
  const unmeasured = Array.from({ length: maxV }, (_, i) => i + 1).filter((v) => !measured.has(v))
  const label = (p: (typeof points)[number]) =>
    `v${p.playbookVersion}, ${lower(title(p.playbookVersion))}, ${percent(p.passRate.mean)}${p.rounds > 1 ? ` ${sdPoints(p.passRate.sd)}` : ''}, ${p.rounds} ${p.rounds === 1 ? 'round' : 'rounds'}`

  return (
    <ChartCard
      frame={ref}
      id="lc-h"
      title="Learning curve · does the retro make the crew better?"
      lead="Requests that pass all their hidden tests, for the crew, per playbook version that changed a rule"
    >
      <svg
        viewBox={`0 0 ${W} 236`}
        role="img"
        aria-labelledby="lc-h"
        aria-describedby="lc-t"
        className="block h-auto w-full font-mono text-xs"
      >
        <g className="stroke-border">
          {[Y1, (Y0 + Y1) / 2, Y0].map((yy) => (
            <line key={yy} x1={L} x2={R} y1={yy} y2={yy} />
          ))}
        </g>
        <g className="fill-muted-foreground">
          <text x={L - 10} y={Y1 + 4} textAnchor="end">
            100%
          </text>
          <text x={L - 10} y={(Y0 + Y1) / 2 + 4} textAnchor="end">
            50%
          </text>
          <text x={L - 10} y={Y0 + 4} textAnchor="end">
            0%
          </text>
        </g>
        {baselines.map(({ v, s }) => (
          <g key={v}>
            <rect
              x={L}
              width={R - L}
              y={y(Math.min(1, s.passRate.mean + s.passRate.sd))}
              height={Math.max(
                0,
                y(Math.max(0, s.passRate.mean - s.passRate.sd)) -
                  y(Math.min(1, s.passRate.mean + s.passRate.sd)),
              )}
              className={cn('opacity-14', v === 'single-agent' ? 'fill-chart-5' : 'fill-chart-1')}
            />
            <line
              x1={L}
              x2={R}
              y1={y(s.passRate.mean)}
              y2={y(s.passRate.mean)}
              strokeWidth="1.5"
              strokeDasharray={v === 'single-agent' ? '2 4' : '6 4'}
              className={v === 'single-agent' ? 'stroke-chart-5' : 'stroke-chart-1'}
            />
          </g>
        ))}
        <g className="fill-muted-foreground" display={narrow ? 'none' : undefined}>
          {baseLabels.map((b) => {
            // Right-aligned, unless a point of the curve sits under the text; then left-aligned, then lower.
            const w = labelWidth(b.text) * 1.15
            const covers = (l: number, r: number, yy: number) =>
              points.some(
                (p) =>
                  x(p.playbookVersion) + 9 > l &&
                  x(p.playbookVersion) - 9 < r &&
                  Math.abs(y(p.passRate.mean) - (yy - 4)) < 14,
              )
            let yy = b.y
            while (covers(R - 4 - w, R - 4, yy) && covers(L + 4, L + 4 + w, yy) && yy < Y0 - 4) yy += 14
            const left = covers(R - 4 - w, R - 4, yy) && !covers(L + 4, L + 4 + w, yy)
            return (
              <text key={b.text} x={left ? L + 4 : R - 4} y={yy} textAnchor={left ? 'start' : 'end'}>
                {b.text}
              </text>
            )
          })}
        </g>
        {points.length > 1 && (
          <polyline
            fill="none"
            strokeWidth="2.5"
            className="stroke-chart-2"
            points={points.map((p) => `${x(p.playbookVersion)},${y(p.passRate.mean)}`).join(' ')}
          />
        )}
        <g className="stroke-muted-foreground" strokeWidth="1.5">
          {points
            .filter((p) => p.rounds > 1 && p.passRate.sd > 0)
            .map((p) => (
              <line
                key={p.playbookVersion}
                x1={x(p.playbookVersion)}
                x2={x(p.playbookVersion)}
                y1={y(Math.min(1, p.passRate.mean + p.passRate.sd))}
                y2={y(Math.max(0, p.passRate.mean - p.passRate.sd))}
              />
            ))}
        </g>
        <g>
          {points.map((p) => (
            <circle
              key={p.playbookVersion}
              cx={x(p.playbookVersion)}
              cy={y(p.passRate.mean)}
              r="5"
              tabIndex={0}
              role="img"
              aria-label={label(p)}
              strokeWidth="2.5"
              className={cn(
                'stroke-chart-2 outline-none focus-visible:stroke-ring',
                p.rounds > 1 ? 'fill-chart-2' : 'fill-background',
              )}
            >
              <title>{label(p)}</title>
            </circle>
          ))}
        </g>
        <g className="fill-foreground">
          {points.map((p) => (
            <text
              key={p.playbookVersion}
              x={x(p.playbookVersion)}
              y={y(Math.min(1, p.passRate.mean + p.passRate.sd)) - 8}
              textAnchor="middle"
            >
              {Math.round(p.passRate.mean * 100)}
            </text>
          ))}
        </g>
        <g className="fill-muted-foreground">
          {Array.from({ length: maxV }, (_, i) => i + 1).map((v) => (
            <text
              key={v}
              x={x(v)}
              y="224"
              textAnchor="middle"
              className={cn(!measured.has(v) && 'opacity-55')}
            >
              v{v}
            </text>
          ))}
        </g>
      </svg>
      <div className="sr-only">
        <table id="lc-t">
          <caption>Requests passing all hidden tests, by playbook version</caption>
          <thead>
            <tr>
              <th>Version</th>
              <th>Rule added</th>
              <th>Rounds</th>
              <th>Passing</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.playbookVersion}>
                <td>v{p.playbookVersion}</td>
                <td>{title(p.playbookVersion)}</td>
                <td>{p.rounds}</td>
                <td>
                  {percent(p.passRate.mean)}
                  {p.rounds > 1 ? ` ${sdPoints(p.passRate.sd)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {narrow && baseLabels.length > 0 && (
        <ul aria-hidden="true" className="mt-2 grid gap-1 text-xs text-muted-foreground">
          {baseLabels.map((b) => (
            <li key={b.text}>Dashed line: {b.text}</li>
          ))}
        </ul>
      )}
      <ol className="mt-2.5 grid gap-0.5 text-[13px]">
        {points.map((p) => (
          <li
            key={p.playbookVersion}
            className="grid min-h-7 grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 border-b last:border-b-0"
          >
            <b className="font-mono font-medium tabular-nums">v{p.playbookVersion}</b>
            <Link
              href={`/playbook#v${p.playbookVersion}`}
              className="inline-flex min-h-6 items-center text-foreground underline underline-offset-[3px] max-[760px]:min-h-11"
            >
              {p.playbookVersion === 1 ? lower(title(1)) : `+ ${lower(title(p.playbookVersion))}`}
            </Link>
            <span className="text-muted-foreground">
              {p.rounds} {p.rounds === 1 ? 'round' : 'rounds'}
            </span>
          </li>
        ))}
      </ol>
      {points.length === 1 && (
        <p className="mt-2.5 rounded-md border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
          One point so far: the learning runs measured v{points[0]!.playbookVersion} only. The curve grows
          when an approved lesson changes a rule and the next evaluation measures it.
        </p>
      )}
      <p className="mt-2.5 text-xs/[1.6] text-muted-foreground">
        <svg width="12" height="12" aria-hidden="true" className="mr-1 inline align-[-1px]">
          <circle cx="6" cy="6" r="4.5" strokeWidth="2" className="fill-chart-2 stroke-chart-2" />
        </svg>
        more than 1 round, with ± ·{' '}
        <svg width="12" height="12" aria-hidden="true" className="mr-1 inline align-[-1px]">
          <circle cx="6" cy="6" r="4.5" strokeWidth="2" className="fill-none stroke-chart-2" />
        </svg>
        1 round
        {unmeasured.length > 0 &&
          ` · ${unmeasured.map((v) => `v${v}`).join(' and ')} ${
            unmeasured.every((v) => versions.find((p) => p.version === v)?.source === 'manual')
              ? 'changed wording only and'
              : ''
          } ${unmeasured.length === 1 ? 'is' : 'are'} not measured.`.replace('  ', ' ')}
      </p>
    </ChartCard>
  )
}

const MARKS: Record<Variant, { cls: string; shape: (cx: number, cy: number) => ReactNode }> = {
  'single-agent': { cls: 'fill-chart-5', shape: (cx, cy) => <circle cx={cx} cy={cy} r="6" /> },
  crew: { cls: 'fill-chart-1', shape: (cx, cy) => <rect x={cx - 6} y={cy - 6} width="12" height="12" /> },
  'crew-playbook': { cls: 'fill-chart-2', shape: (cx, cy) => <path d={`M${cx} ${cy - 7}l7 12h-14z`} /> },
}

function CostQuality({ data }: { data: EvaluationResponse }) {
  const stats = VARIANTS.map((v) => byVariant(data.main, v)).filter((s): s is VariantStats => !!s)
  const maxUsd = niceMax(
    Math.max(...stats.map((s) => (s.costMicrosPerRequest.mean + s.costMicrosPerRequest.sd) / 1e6)) * 1.15,
  )
  const { ref, W, L, R, narrow } = useChartFrame()
  const x = (usdValue: number) => L + (usdValue / maxUsd) * (R - L - 20)
  const order = [...stats].sort(
    (a, b) => a.passRate.mean - b.passRate.mean || a.costMicrosPerRequest.mean - b.costMicrosPerRequest.mean,
  )
  const digits = costDigits(stats.map((s) => s.costMicrosPerRequest.mean))
  const money = (m: number) => `$${(m / 1e6).toFixed(digits)}`
  const labels = order.map(
    (s) =>
      `${VARIANT_LABEL[s.variant]} · ${percent(s.passRate.mean)} · ${money(s.costMicrosPerRequest.mean)}`,
  )
  // The best quality first, so it gets the place above its mark.
  const placed = placeLabelsFor(
    order,
    labels,
    (s) => ({ x: x(s.costMicrosPerRequest.mean / 1e6), y: y(s.passRate.mean) }),
    { left: L, right: R, top: 12, bottom: 232 },
  )
  const text = (s: VariantStats) =>
    `${VARIANT_LABEL[s.variant]}: ${money(s.costMicrosPerRequest.mean)} ± ${(s.costMicrosPerRequest.sd / 1e6).toFixed(digits)} per request, ${percent(s.passRate.mean)} ${sdPoints(s.passRate.sd)} passing`
  return (
    <ChartCard
      frame={ref}
      id="cq-h"
      title="Cost × quality · where is the best trade?"
      lead="One mark per variant, with ± one standard deviation on both axes · up and left is better"
    >
      <svg
        viewBox={`0 0 ${W} 252`}
        role="img"
        aria-labelledby="cq-h"
        aria-describedby="cq-t"
        className="block h-auto w-full font-mono text-xs"
      >
        <g className="stroke-border">
          {[Y1, (Y0 + Y1) / 2, Y0].map((yy) => (
            <line key={yy} x1={L} x2={R} y1={yy} y2={yy} />
          ))}
        </g>
        <g className="fill-muted-foreground">
          <text x={L - 10} y={Y1 + 4} textAnchor="end">
            100%
          </text>
          <text x={L - 10} y={(Y0 + Y1) / 2 + 4} textAnchor="end">
            50%
          </text>
          <text x={L - 10} y={Y0 + 4} textAnchor="end">
            0%
          </text>
          {[0, maxUsd / 2, maxUsd].map((v) => (
            <text key={v} x={x(v)} y="220" textAnchor="middle">
              {tick(v)}
            </text>
          ))}
          <text x={(L + R) / 2} y="244" textAnchor="middle" className="font-sans">
            Cost per request ($)
          </text>
        </g>
        <g className="stroke-muted-foreground" strokeWidth="1.5">
          {stats.map((s) => {
            const cx = x(s.costMicrosPerRequest.mean / 1e6)
            const cy = y(s.passRate.mean)
            return (
              <g key={s.variant}>
                <line
                  x1={x((s.costMicrosPerRequest.mean - s.costMicrosPerRequest.sd) / 1e6)}
                  x2={x((s.costMicrosPerRequest.mean + s.costMicrosPerRequest.sd) / 1e6)}
                  y1={cy}
                  y2={cy}
                />
                <line
                  x1={cx}
                  x2={cx}
                  y1={y(Math.min(1, s.passRate.mean + s.passRate.sd))}
                  y2={y(Math.max(0, s.passRate.mean - s.passRate.sd))}
                />
              </g>
            )
          })}
        </g>
        {stats.map((s) => {
          const cx = x(s.costMicrosPerRequest.mean / 1e6)
          const cy = y(s.passRate.mean)
          return (
            <g
              key={s.variant}
              tabIndex={0}
              role="img"
              aria-label={text(s)}
              className={cn(
                MARKS[s.variant].cls,
                'outline-none focus-visible:stroke-ring focus-visible:[stroke-width:4]',
              )}
            >
              <title>{text(s)}</title>
              {MARKS[s.variant].shape(cx, cy)}
            </g>
          )
        })}
        <g className="fill-foreground font-sans" display={narrow ? 'none' : undefined}>
          {placed.map((p, i) => (
            <text key={order[i]!.variant} x={p.x} y={p.y} textAnchor={p.anchor}>
              {labels[i]}
            </text>
          ))}
        </g>
      </svg>
      <div className="sr-only">
        <table id="cq-t">
          <caption>Cost and quality per variant</caption>
          <thead>
            <tr>
              <th>Variant</th>
              <th>Cost per request</th>
              <th>Requests passing all hidden tests</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.variant}>
                <td>{VARIANT_LABEL[s.variant]}</td>
                <td>
                  {money(s.costMicrosPerRequest.mean)} ± {(s.costMicrosPerRequest.sd / 1e6).toFixed(digits)}
                </td>
                <td>
                  {percent(s.passRate.mean)} {sdPoints(s.passRate.sd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {narrow && (
        <ul aria-hidden="true" className="mt-2 grid gap-1 text-[13px]">
          {stats.map((s) => (
            <li key={s.variant} className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 14 14" className={MARKS[s.variant].cls}>
                {MARKS[s.variant].shape(7, 7)}
              </svg>
              {VARIANT_LABEL[s.variant]} · {percent(s.passRate.mean)} · {money(s.costMicrosPerRequest.mean)}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2.5 text-xs/[1.6] text-muted-foreground">
        Marks differ in shape: circle for one agent, square for the crew, triangle for the crew with the
        playbook.
      </p>
    </ChartCard>
  )
}

/** Labels for the marks, placed from the highest mark down; returned in the marks' order. */
function placeLabelsFor<T>(
  items: T[],
  texts: string[],
  at: (item: T) => { x: number; y: number },
  plot: Parameters<typeof placeLabels>[1],
) {
  const idx = items.map((_, i) => i).sort((a, b) => at(items[a]!).y - at(items[b]!).y)
  const out = placeLabels(
    idx.map((i) => ({ ...at(items[i]!), text: texts[i]! })),
    plot,
  )
  const back = new Array<(typeof out)[number]>(items.length)
  idx.forEach((i, k) => (back[i] = out[k]!))
  return back
}

const secs = (ms: number) => `${Math.round(ms / 1000)}s`

function Metrics({ data }: { data: EvaluationResponse }) {
  const stats = VARIANTS.map((v) => byVariant(data.main, v))
  const present = stats.filter((s): s is VariantStats => !!s)
  const digits = costDigits(present.map((s) => s.costMicrosPerRequest.mean))
  const crewOnly = (s: VariantStats) => s.variant !== 'single-agent'
  const rows: {
    name: string
    best: Variant[]
    cell: (s: VariantStats) => ReactNode
  }[] = [
    {
      name: 'Requests passing all hidden tests',
      best: bestOf(present, (s) => s.passRate.mean, true),
      cell: (s) => (
        <>
          <b className="font-medium">{percent(s.passRate.mean)}</b>{' '}
          <small className="text-xs text-muted-foreground">{sdPoints(s.passRate.sd)}</small>
        </>
      ),
    },
    {
      name: 'Cost per request',
      best: bestOf(present, (s) => s.costMicrosPerRequest.mean),
      cell: (s) => (
        <>
          <b className="font-medium">{usd(s.costMicrosPerRequest.mean, digits)}</b>{' '}
          <small className="text-xs text-muted-foreground">
            ± {(s.costMicrosPerRequest.sd / 1e6).toFixed(digits)}
          </small>
        </>
      ),
    },
    {
      name: 'Tokens per request',
      best: bestOf(present, (s) => s.tokensPerRequest.mean),
      cell: (s) => (
        <>
          <b className="font-medium">{tokensShort(Math.round(s.tokensPerRequest.mean))}</b>{' '}
          <small className="text-xs text-muted-foreground">
            ± {tokensShort(Math.round(s.tokensPerRequest.sd))}
          </small>
        </>
      ),
    },
    {
      name: 'Time per request',
      best: bestOf(present, (s) => s.durationMsPerRequest.mean),
      cell: (s) => (
        <>
          <b className="font-medium">{clock(s.durationMsPerRequest.mean)}</b>{' '}
          <small className="text-xs text-muted-foreground">± {secs(s.durationMsPerRequest.sd)}</small>
        </>
      ),
    },
    {
      name: 'Fix loops per request',
      best: bestOf(present, (s) => (crewOnly(s) ? s.fixLoopsPerRequest.mean : null)),
      cell: (s) =>
        crewOnly(s) ? (
          <>
            <b className="font-medium">{s.fixLoopsPerRequest.mean.toFixed(1)}</b>{' '}
            <small className="text-xs text-muted-foreground">± {s.fixLoopsPerRequest.sd.toFixed(1)}</small>
          </>
        ) : (
          <span className="text-muted-foreground">does not apply</span>
        ),
    },
    {
      name: 'Gate interventions',
      best: [],
      cell: (s) =>
        crewOnly(s) ? (
          <>
            <b className="font-medium">{s.gateInterventions}</b>{' '}
            <small className="text-xs text-muted-foreground">
              of {s.gates}
              {s.gateInterventions === 0 ? ' · policy approved' : ''}
            </small>
          </>
        ) : (
          <span className="text-muted-foreground">does not apply</span>
        ),
    },
  ]
  return (
    <section aria-labelledby="t-h" className="mt-6">
      <SectionHead
        id="t-h"
        title="All metrics"
        note={`Mean ± standard deviation of ${scope(data).rounds} rounds. Best value in each row has a check.`}
      />
      <div
        role="region"
        aria-label="All metrics, by variant"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="w-max min-w-full">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Metric</TableHead>
                {stats.map(
                  (s, i) =>
                    s && (
                      <TableHead key={VARIANTS[i]} className="text-right">
                        {VARIANT_LABEL[s.variant]}
                      </TableHead>
                    ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableHead scope="row" className="font-medium text-foreground">
                    {r.name}
                  </TableHead>
                  {present.map((s) => (
                    <TableCell key={s.variant} className="text-right font-mono text-[13px] tabular-nums">
                      {r.best.includes(s.variant) && (
                        <span className="mr-1.5 inline-flex align-[-2px]">
                          <Status visual="passed" label={false} text="best" size={14} />
                        </span>
                      )}
                      {r.cell(s)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  )
}

function Matrix({ data }: { data: EvaluationResponse }) {
  const [sort, setSort] = useState<SortKey>('order')
  const [only, setOnly] = useState(false)
  const variants = VARIANTS.filter((v) => data.matrix.some((m) => m.results[v]))
  const rows = sortRows(data.matrix, sort).filter((r) => !only || spread(r) > 0)
  return (
    <section aria-labelledby="m-h" className="mt-6">
      <SectionHead id="m-h" title="Per request" />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger aria-label="Sort requests" className="max-[760px]:w-full">
            <span className="text-muted-foreground">Sort</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          aria-pressed={only}
          onClick={() => setOnly((o) => !o)}
          className={cn(
            only && 'border-primary bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent',
          )}
        >
          <Icon name="filter" />
          Only where variants disagree
        </Button>
        <span className="flex-1" />
        <span role="status" className="text-[13px] text-muted-foreground">
          {rows.length} of {data.matrix.length} requests
        </span>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        One mark per round: <Status visual="passed" text="passed" /> ·{' '}
        <Status visual="failed" text="failed" />
      </p>
      <div
        role="region"
        aria-label="Per request, by variant"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border bg-card outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <div className="w-max min-w-full">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Request</TableHead>
                <TableHead className="text-right">Hidden tests</TableHead>
                {variants.map((v) => (
                  <TableHead key={v}>{VARIANT_LABEL[v]}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.requestId}>
                  <TableCell className="h-10 whitespace-nowrap">{r.title}</TableCell>
                  <TableCell className="h-10 text-right font-mono text-[13px] tabular-nums">
                    {r.hiddenTests}
                  </TableCell>
                  {variants.map((v) => {
                    const rounds = r.results[v] ?? []
                    const n = passes(r, v)
                    return (
                      <TableCell key={v} className="h-10">
                        <span
                          role="img"
                          aria-label={`${n} of ${rounds.length} rounds passed`}
                          className="inline-flex gap-1 align-middle"
                        >
                          {rounds.map((ok, i) => (
                            <Status key={i} visual={ok ? 'passed' : 'failed'} label={false} text="" />
                          ))}
                        </span>{' '}
                        <span
                          className="ml-1 font-mono text-[13px] text-muted-foreground tabular-nums"
                          aria-hidden="true"
                        >
                          {n}/{rounds.length}
                        </span>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </section>
  )
}

function Command({ data }: { data: EvaluationResponse }) {
  const s = scope(data)
  return (
    <section aria-labelledby="h-h" className="mt-6">
      <SectionHead id="h-h" title="How we measure it" />
      <CodeBlock title="Terminal" copyText={`$ ${EVAL_COMMAND}`}>
        {`$ ${EVAL_COMMAND}\n`}
        <span className="text-code-dim">
          {`# ${s.requests} requests × ${s.variants} variants × ${s.rounds} rounds, then the learning curve${data.model ? ` · ${data.model}` : ''}\n# hidden tests run in a sandbox · a logged policy approves the gate · results → evals/results/latest.json`}
        </span>
      </CodeBlock>
    </section>
  )
}

export function EvaluationPage({ meta }: { meta: Meta }) {
  useTitle('Evaluation · Agent Dev Crew')
  const load = useApi<EvaluationResponse>('/api/evaluation')
  const playbook = useApi<{ versions: PlaybookVersion[] }>('/api/playbook')

  if (load.state === 'loading')
    return (
      <div role="status" aria-busy="true" aria-label="Loading the evaluation" className="grid gap-4">
        <Skeleton className="h-4 w-60" />
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="h-20" />
        <div className="grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    )
  if (load.state === 'error')
    return <LoadError what="the evaluation" error={load.error} onRetry={load.reload} />

  const data = load.data
  if (data.main.length === 0)
    return (
      <>
        <PageHeader title="Evaluation" />
        <EmptyState icon={<Icon name="chart" size={20} />} title="Run the evaluation to fill this page">
          <p>
            {meta.mode === 'live'
              ? 'This page shows no example numbers in live mode. The evaluation runs every feature request in each variant, for several rounds, and stops at the limit you give it.'
              : 'The scoreboard is empty. The evaluation runs every feature request in each variant, for several rounds, and stops at the limit you give it.'}
          </p>
          <CodeBlock className="w-full" title="Terminal" copyText={`$ ${EVAL_COMMAND}`}>
            {`$ ${EVAL_COMMAND}`}
          </CodeBlock>
        </EmptyState>
      </>
    )

  const s = scope(data)
  const sentence = headline(data)
  // The example for “±” is the widest spread on the page, so it never reads “± 0”.
  const lead = [...data.main].sort((a, b) => b.passRate.sd - a.passRate.sd)[0]
  const limit = data.limitUsd ? data.limitUsd * 1e6 : null
  const items: { k: ReactNode; v: ReactNode; extra?: ReactNode }[] = [
    {
      k: 'Requests',
      v: (
        <>
          {s.requests}
          <Small>
            hidden acceptance tests,{' '}
            {s.minHidden === s.maxHidden ? s.minHidden : `${s.minHidden} to ${s.maxHidden}`} each
          </Small>
        </>
      ),
    },
    { k: 'Variants × rounds', v: `${s.variants} × ${s.rounds}` },
  ]
  if (data.model) items.push({ k: 'Model', v: data.model })
  items.push({
    k: 'Eval cost',
    v: (
      <>
        {usd(s.costMicros, 2)}
        <Small>
          {limit ? `of ${usd(limit, 2)} limit · ` : ''}main {usd(s.mainMicros, 2)}
          {s.curveMicros > 0 && ` · curve ${usd(s.curveMicros, 2)}`}
        </Small>
      </>
    ),
    extra: limit ? (
      <Progress
        value={Math.round((s.costMicros / limit) * 100)}
        variant="neutral"
        className="mt-1 h-1"
        aria-label={`${Math.round((s.costMicros / limit) * 100)}% of the limit used`}
      />
    ) : undefined,
  })
  if (data.finishedAt)
    items.push({
      k: 'Last run',
      v: new Date(data.finishedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }),
    })

  return (
    <>
      <PageHeader
        eyebrow={`Evaluation · ${s.requests} requests × ${s.variants} variants × ${s.rounds} rounds`}
        title={sentence ?? 'Evaluation'}
        titleClass="max-w-[900px] text-[28px] leading-[1.2] tracking-[-0.02em] max-[760px]:text-[22px]"
        lead={
          <p className="mt-1.5 max-w-[900px] text-[13px]">
            Small sample: n = {s.requests} requests × {s.rounds} rounds.{' '}
            {lead ? `“${sdPoints(lead.passRate.sd)}” is` : '“±” is'} one standard deviation across the rounds;
            a gap smaller than the two ± together is not a result.
          </p>
        }
      />
      <MetaStrip className="mb-6" items={items} />
      <div className="grid grid-cols-2 items-start gap-4 max-[1100px]:grid-cols-1">
        <LearningCurve data={data} versions={playbook.data?.versions ?? []} />
        <CostQuality data={data} />
      </div>
      <Metrics data={data} />
      <Matrix data={data} />
      <Command data={data} />
    </>
  )
}
