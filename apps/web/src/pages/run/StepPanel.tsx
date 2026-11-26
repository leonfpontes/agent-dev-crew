// The panel of the selected step: model, fallback, attempts, time, tokens and cost, then its
// prompt, response, tool calls and the raw API records, as the trace recorded them.
import type { ReactNode } from 'react'

import { Button, cn, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@leonfpontes/atlas-ui'

import { CodeBlock, LoadError, useCopy } from '../../components/bits'
import { Icon } from '../../components/icons'
import { Status, stepVisual } from '../../components/Status'
import { useApi } from '../../lib/api'
import { durationFixed, estimate, offset, tokensLong, usd } from '../../lib/format'
import { Link } from '../../lib/router'
import {
  json,
  MAX_FIX_LOOPS,
  sectionOf,
  stepName,
  toolArg,
  toolCalls,
  tokensIn,
  type ToolCall,
} from '../../lib/run'
import type { EventRow, Plan, StepRow } from '../../lib/types'

interface ModelRequest {
  prompt?: string
  playbook?: { version: number; section: string } | null
  system?: string
  rules?: string[]
  user?: string
  raw?: unknown
}
interface ModelResponse {
  text?: string
  stopReason?: string
  raw?: unknown
  plan?: Plan
}

function Msg({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex h-9 items-center justify-between gap-2 border-b bg-muted px-3 text-xs font-medium text-muted-foreground">
        <span>{title}</span>
        {meta && <span className="truncate font-mono">{meta}</span>}
      </div>
      <pre className="m-0 p-3 font-mono text-[13px]/[1.6] break-words whitespace-pre-wrap text-foreground">
        {children}
      </pre>
    </div>
  )
}

function Tools({ calls }: { calls: ToolCall[] }) {
  return (
    <ul aria-label="Tool calls" className="rounded-lg border">
      {calls.map((c, i) => {
        const tests =
          c.tool === 'run_tests' ? (c.output as { passed?: number; failed?: number } | undefined) : undefined
        return (
          <li key={i} className="border-b last:border-b-0">
            <details>
              <summary className="grid min-h-11 grid-cols-[16px_20px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2.5 text-sm">
                <Icon name="chevron" className="crew-chev text-muted-foreground" />
                <Icon
                  name={c.tool === 'write_file' ? 'edit' : c.tool === 'run_tests' ? 'term' : 'file'}
                  className="text-muted-foreground"
                />
                <span className="min-w-0 break-words">
                  <code className="text-[13px]">{c.tool}</code>{' '}
                  <span className="text-muted-foreground">{toolArg(c)}</span>
                </span>
                {tests?.passed !== undefined ? (
                  <Status
                    visual={tests.failed ? 'failed' : 'passed'}
                    text={tests.failed ? `${tests.failed} failed` : `${tests.passed} passed`}
                  />
                ) : c.tool === 'write_file' &&
                  typeof c.output === 'string' &&
                  /\+(\d+) −(\d+)/.test(c.output) ? (
                  <span className="font-mono text-[13px] tabular-nums">
                    <span className="text-success">+{/\+(\d+)/.exec(c.output)?.[1]}</span>{' '}
                    <span className="text-destructive">−{/−(\d+)/.exec(c.output)?.[1]}</span>
                  </span>
                ) : c.ok === false ? (
                  <Status visual="failed" text="error" />
                ) : (
                  <span className="font-mono text-[13px] text-muted-foreground tabular-nums">
                    {c.durationMs === undefined ? '' : `${(c.durationMs / 1000).toFixed(1)} s`}
                  </span>
                )}
              </summary>
              <pre className="m-0 border-t border-dashed py-2.5 pr-3 pl-[58px] font-mono text-xs/[1.6] whitespace-pre-wrap text-muted-foreground">
                {typeof c.output === 'string' ? c.output : json(c.output)}
              </pre>
            </details>
          </li>
        )
      })}
    </ul>
  )
}

function Rules({ request, step }: { request: ModelRequest; step: StepRow }) {
  if (!request.rules?.length) return null
  const section = request.playbook?.section ?? sectionOf(step)
  return (
    <div className="rounded-lg border">
      <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-t-lg border-b bg-muted px-3 text-[13px] font-medium">
        <Icon name="book" />
        <span>Playbook rules applied{request.playbook ? ` · v${request.playbook.version}` : ''}</span>
        <span className="flex-1" />
        {section && (
          <Link
            href={`/playbook#${section.toLowerCase()}`}
            className="inline-flex min-h-6 items-center gap-1 text-primary underline underline-offset-[3px] max-[760px]:min-h-11"
          >
            § {section} <Icon name="arrow" size={14} />
          </Link>
        )}
      </div>
      <ol className="grid list-decimal gap-1 py-2.5 pr-3 pl-8 text-sm">
        {request.rules.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ol>
    </div>
  )
}

export function PlanBody({ plan, budgetLeft }: { plan: Plan; budgetLeft?: number }) {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
        <div>
          <h3 className="text-sm font-semibold">PO plan</h3>
          <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-sm">
            {plan.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Acceptance criteria (QA tests these)</h3>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm">
            {plan.acceptance.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      </div>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm max-[760px]:grid-cols-[88px_minmax(0,1fr)]">
        <dt className="text-[13px] text-muted-foreground">Files to touch</dt>
        <dd className="m-0">
          {plan.files.length
            ? plan.files.map((f, i) => (
                <span key={f}>
                  {i > 0 && ', '}
                  <code>{f}</code>
                </span>
              ))
            : '—'}
        </dd>
        <dt className="text-[13px] text-muted-foreground">Estimate</dt>
        <dd className="m-0">
          <span className="font-mono text-[13px] tabular-nums">{estimate(plan.estimateUsd)}</span>
          {budgetLeft !== undefined && (
            <>
              {' '}
              <span className="text-muted-foreground">of</span>{' '}
              <span className="font-mono text-[13px] tabular-nums">{usd(budgetLeft)}</span>{' '}
              <span className="text-muted-foreground">left in the budget</span>
            </>
          )}
        </dd>
      </dl>
    </div>
  )
}

function subtitle(step: StepRow, parent: StepRow | undefined): string {
  const parts: string[] = []
  if (parent?.kind === 'fix-loop' && parent.loop_index)
    parts.push(`Fix loop ${parent.loop_index} of ${MAX_FIX_LOOPS}`)
  if (step.kind !== 'gate' && step.kind !== 'fix-loop') parts.push(`attempt ${step.attempt}`)
  if (step.summary && step.summary !== `attempt ${step.attempt}`) parts.push(step.summary)
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function StepPanel({
  runId,
  step,
  parent,
  onClose,
  className,
  headingId = 'step-h',
}: {
  runId: number
  step: StepRow
  parent?: StepRow
  onClose?: () => void
  className?: string
  headingId?: string
}) {
  const load = useApi<{ events: EventRow[] }>(`/api/runs/${runId}/steps/${step.id}/events`)
  const { copied, copy } = useCopy()
  const events = load.data?.events ?? []
  const request = events.find((e) => e.kind === 'model.request')?.payload as ModelRequest | undefined
  const response = events.find((e) => e.kind === 'model.response')?.payload as ModelResponse | undefined
  const calls = toolCalls(events)
  const failures = events
    .filter((e) => e.kind === 'tool.result')
    .flatMap((e) => ((e.payload as { output?: { failures?: string[] } }).output?.failures ?? []) as string[])
  const loopStarted = events.find((e) => e.kind === 'loop.started')?.payload as
    { reason?: string } | undefined
  const budget = events.find((e) => e.kind === 'budget.exceeded')?.payload as
    { budgetUsd?: number; spentUsd?: number } | undefined
  const full = !!(request || calls.length || (response && !response.plan))
  const isGate = step.kind === 'gate'
  const model = isGate ? (step.decided_by ?? 'person') : (step.model ?? '—')
  const link = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('step', String(step.id))
    return url.href
  }

  const overview = (
    <div className="grid gap-3">
      {request && <Rules request={request} step={step} />}
      {request?.user && (
        <Msg
          title="Input"
          meta={[
            request.prompt,
            request.playbook && `playbook v${request.playbook.version} § ${request.playbook.section}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          {request.user}
        </Msg>
      )}
      {response?.plan && <PlanBody plan={response.plan} />}
      {isGate && (
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-[13px] text-muted-foreground">Decision</dt>
          <dd className="m-0">{step.decision ? step.decision.replace('-', ' ') : 'waiting for you'}</dd>
          <dt className="text-[13px] text-muted-foreground">By</dt>
          <dd className="m-0">{step.decided_by ?? '—'}</dd>
          {step.comment && (
            <>
              <dt className="text-[13px] text-muted-foreground">Comment</dt>
              <dd className="m-0">“{step.comment}”</dd>
            </>
          )}
        </dl>
      )}
      {loopStarted?.reason && (
        <p className="text-sm">
          Started because {loopStarted.reason.charAt(0).toLowerCase() + loopStarted.reason.slice(1)}.
        </p>
      )}
      {failures.length > 0 && (
        <Msg title="Test failures" meta="vitest run">
          {failures.join('\n')}
        </Msg>
      )}
      {budget && (
        <p className="text-sm text-destructive">
          Stopped before the next call: it would pass the ${budget.budgetUsd?.toFixed(2)} budget ($
          {budget.spentUsd?.toFixed(3)} spent).
        </p>
      )}
      {calls.length > 0 && <Tools calls={calls} />}
      {response?.text && (
        <Msg title="Response" meta={`${tokensLong(step.output_tokens)} tokens`}>
          {response.text}
        </Msg>
      )}
      {load.state === 'ok' &&
        !full &&
        !response?.plan &&
        !isGate &&
        !loopStarted &&
        !failures.length &&
        !budget && (
          <p className="rounded-md border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
            The trace keeps no prompt, response or tool calls for {stepName(step)} in this run.
          </p>
        )}
    </div>
  )

  return (
    <section aria-labelledby={headingId} className={cn('rounded-xl border bg-card', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 max-[760px]:flex-nowrap max-[760px]:px-3">
        <div className="min-w-0">
          <h2 id={headingId} className="flex items-center gap-2 text-base font-semibold">
            <Status visual={stepVisual(step.status)} label={false} />
            {stepName(step)}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{subtitle(step, parent)}</p>
        </div>
        <div className="flex gap-1 max-[760px]:flex-nowrap">
          <Button
            variant="ghost"
            aria-label={copied === 'json' ? 'Copied' : 'Copy as JSON'}
            className="max-[760px]:w-(--control) max-[760px]:px-0"
            onClick={() => copy(json({ step, events }), 'json')}
          >
            <Icon name={copied === 'json' ? 'check' : 'copy'} />
            <span className="max-[760px]:hidden">{copied === 'json' ? 'Copied' : 'Copy as JSON'}</span>
          </Button>
          <Button
            variant="ghost"
            aria-label={copied === 'link' ? 'Copied' : 'Copy link to this step'}
            className="max-[760px]:w-(--control) max-[760px]:px-0"
            onClick={() => copy(link(), 'link')}
          >
            <Icon name={copied === 'link' ? 'check' : 'link'} />
            <span className="max-[760px]:hidden">
              {copied === 'link' ? 'Copied' : 'Copy link to this step'}
            </span>
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" aria-label="Close step" onClick={onClose}>
              <Icon name="x" />
            </Button>
          )}
        </div>
      </div>

      <dl className="mx-5 mt-4 grid grid-cols-4 rounded-lg border max-[760px]:mx-3 max-[760px]:grid-cols-2 [&>div]:grid [&>div]:min-w-0 [&>div]:gap-1 [&>div]:border-b [&>div]:px-3 [&>div]:py-2.5 [&>div:nth-child(4n)]:border-r-0 [&>div:nth-last-child(-n+4)]:border-b-0 [&>div]:border-r max-[760px]:[&>div:nth-child(2n)]:border-r-0 max-[760px]:[&>div:nth-last-child(-n+4)]:border-b max-[760px]:[&>div:nth-last-child(-n+2)]:border-b-0">
        {[
          ['Model', model],
          ['Fallback', step.fallback_used ? 'used' : 'not used'],
          ['Attempts', isGate ? '—' : `${step.attempt} of ${step.max_attempts}`],
          ['Duration', step.duration_ms === null ? '—' : durationFixed(step.duration_ms)],
          [
            'Tokens in',
            tokensIn(step) ? (
              <>
                {tokensLong(tokensIn(step))}
                {step.cache_read_tokens > 0 && (
                  <small className="block font-sans text-xs font-normal text-muted-foreground">
                    {tokensLong(step.cache_read_tokens)} cached
                  </small>
                )}
              </>
            ) : (
              '—'
            ),
          ],
          ['Tokens out', step.output_tokens ? tokensLong(step.output_tokens) : '—'],
          ['Cost', step.cost_micros ? usd(step.cost_micros) : '—'],
          ['Started', step.offset_ms === null ? '—' : offset(step.offset_ms)],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt className="text-xs leading-none font-medium text-muted-foreground">{k}</dt>
            <dd className="m-0 font-mono text-[13px]/[1.3] font-medium break-words tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      {load.state === 'loading' && (
        <div className="grid gap-2 px-5 py-4" role="status" aria-label="Loading the step">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
        </div>
      )}
      {load.state === 'error' && (
        <div className="px-5 py-4">
          <LoadError what="this step" error={load.error} onRetry={load.reload} />
        </div>
      )}
      {load.state === 'ok' &&
        (full ? (
          <Tabs defaultValue="overview" className="mt-3 gap-0">
            <div className="overflow-x-auto px-5 max-[760px]:px-3">
              <TabsList variant="line" aria-label="Step detail" className="min-w-max justify-start">
                <TabsTrigger value="overview" className="flex-none px-0.5">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="prompt" className="flex-none px-0.5">
                  Prompt
                </TabsTrigger>
                <TabsTrigger value="response" className="flex-none px-0.5">
                  Response
                </TabsTrigger>
                <TabsTrigger value="tools" className="flex-none px-0.5">
                  Tools <span className="font-mono text-[13px] text-muted-foreground">{calls.length}</span>
                </TabsTrigger>
                <TabsTrigger value="raw" className="flex-none px-0.5">
                  Raw
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="overview" className="px-5 pt-4 pb-5 max-[760px]:px-3">
              {overview}
            </TabsContent>
            <TabsContent value="prompt" className="grid gap-3 px-5 pt-4 pb-5 max-[760px]:px-3">
              {request?.system && (
                <Msg
                  title="System · cached"
                  meta={[request.prompt, request.playbook && `playbook v${request.playbook.version}`]
                    .filter(Boolean)
                    .join(' + ')}
                >
                  {request.system}
                  {request.rules?.length
                    ? `\n\nPlaybook v${request.playbook?.version ?? ''} § ${request.playbook?.section ?? ''}\n${request.rules.map((r) => `- ${r}`).join('\n')}`
                    : ''}
                </Msg>
              )}
              {request?.user && <Msg title="User">{request.user}</Msg>}
              {!request && (
                <p className="text-[13px] text-muted-foreground">No prompt recorded for this step.</p>
              )}
            </TabsContent>
            <TabsContent value="response" className="grid gap-3 px-5 pt-4 pb-5 max-[760px]:px-3">
              {response?.text ? (
                <Msg
                  title={`Assistant${response.stopReason ? ` · ${response.stopReason}` : ''}`}
                  meta={`${tokensLong(step.output_tokens)} tokens`}
                >
                  {response.text}
                </Msg>
              ) : (
                <p className="text-[13px] text-muted-foreground">No response recorded for this step.</p>
              )}
            </TabsContent>
            <TabsContent value="tools" className="grid gap-3 px-5 pt-4 pb-5 max-[760px]:px-3">
              {calls.length === 0 && (
                <p className="text-[13px] text-muted-foreground">This step called no tools.</p>
              )}
              {calls.map((c, i) => (
                <div key={i} className="grid gap-3">
                  {c.input !== undefined && <Msg title={`${c.tool} · input`}>{json(c.input)}</Msg>}
                  <Msg
                    title={`${c.tool} · result`}
                    meta={c.durationMs === undefined ? undefined : `${(c.durationMs / 1000).toFixed(2)} s`}
                  >
                    {typeof c.output === 'string' ? c.output : json(c.output)}
                  </Msg>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="raw" className="grid gap-3 px-5 pt-4 pb-5 max-[760px]:px-3">
              <p className="text-[13px] text-muted-foreground">
                The Messages API request and response as recorded, trimmed only where marked <code>…</code>.
              </p>
              {request?.raw !== undefined && (
                <CodeBlock title="request.json" copyText={json(request.raw)} copyLabel="Copy request">
                  {json(request.raw)}
                </CodeBlock>
              )}
              {response?.raw !== undefined && (
                <CodeBlock
                  title="response.json · usage"
                  copyText={json(response.raw)}
                  copyLabel="Copy response"
                >
                  {json(response.raw)}
                </CodeBlock>
              )}
            </TabsContent>
          </Tabs>
        ) : (
          <div className="px-5 pt-4 pb-5 max-[760px]:px-3">{overview}</div>
        ))}
    </section>
  )
}
