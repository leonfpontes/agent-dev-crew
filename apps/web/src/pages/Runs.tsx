// Runs: the run waiting for you first, filters and search above the table; the whole row opens a run.
// At 375 px each row becomes a stacked item: title, status + cost, duration + tokens.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@leonfpontes/atlas-ui'

import { CodeBlock, EmptyState, Kbd, LoadError, MetaStrip, PageHeader, Small } from '../components/bits'
import { Icon } from '../components/icons'
import { Status, runLabel, runVisual } from '../components/Status'
import { ApiError, useApi } from '../lib/api'
import { ago, clock, tokensShort, usd } from '../lib/format'
import { useTitle } from '../lib/hooks'
import { Link, navigate } from '../lib/router'
import type { Meta, RunListRow, RunsResponse, Variant } from '../lib/types'

type Filter = 'all' | 'waiting' | 'failed' | 'passed'
const FILTERS: { id: Filter; label: string; test: (r: RunListRow) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'waiting', label: 'Waiting for you', test: (r) => r.status === 'waiting' },
  { id: 'failed', label: 'Failed', test: (r) => r.status === 'failed' },
  { id: 'passed', label: 'Passed', test: (r) => r.status === 'passed' },
]

export const VARIANT_LABEL: Record<Variant, string> = {
  'single-agent': 'Single agent',
  crew: 'Crew',
  'crew-playbook': 'Crew + playbook',
}

export function VariantCell({ run }: { run: Pick<RunListRow, 'variant' | 'playbook_version'> }) {
  if (run.variant === 'single-agent') return <>single agent</>
  if (run.variant === 'crew' || run.playbook_version === null) return <>crew</>
  return (
    <>
      crew ·{' '}
      <Link
        href={`/playbook#v${run.playbook_version}`}
        className="inline-flex min-h-6 items-center text-foreground underline underline-offset-[3px] max-[760px]:min-h-11"
      >
        playbook v{run.playbook_version}
      </Link>
    </>
  )
}

const LIVE_EXAMPLE = 'pnpm crew run "Add an order cancellation endpoint"'

function NewRun({ meta }: { meta: Meta }) {
  const canRun = meta.mode === 'live' && meta.live.available
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [variant, setVariant] = useState<Variant>('crew-playbook')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const short = text.trim().length < 20

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ request: text.trim(), variant }),
      })
      const body = (await response.json()) as { runId?: number; error?: string }
      if (!response.ok || !body.runId)
        throw new ApiError(response.status, body.error ?? 'The run did not start.')
      setOpen(false)
      navigate(`/runs/${body.runId}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="grid justify-items-end gap-1 max-[760px]:justify-items-start">
      <Button disabled={!canRun} aria-describedby="new-run-hint" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        New run
      </Button>
      <span id="new-run-hint" className="text-xs text-muted-foreground">
        {canRun ? (
          'The PO plans first; nothing changes before you approve.'
        ) : (
          <>
            Live runs happen on your machine: <code>pnpm crew run "…"</code>
          </>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New run</DialogTitle>
            <DialogDescription>
              One feature request for <code>fernhill-orders</code>. The PO writes a plan and stops at the
              gate.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label htmlFor="new-run-text" className="text-sm leading-none font-medium">
              Feature request
            </label>
            <Textarea
              id="new-run-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add POST /orders/:id/cancel. A shipped order answers 409…"
              aria-describedby="new-run-text-hint"
            />
            <p id="new-run-text-hint" className="text-sm text-muted-foreground">
              At least 20 characters.
            </p>
            <label htmlFor="new-run-variant" className="mt-2 text-sm leading-none font-medium">
              Variant
            </label>
            <Select value={variant} onValueChange={(v) => setVariant(v as Variant)}>
              <SelectTrigger id="new-run-variant" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['crew-playbook', 'crew', 'single-agent'] as const).map((v) => (
                  <SelectItem key={v} value={v}>
                    {VARIANT_LABEL[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={short || busy} aria-busy={busy} onClick={() => void start()}>
              <Icon name="play" />
              Start run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  )
}

function LoadingRows() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading runs"
      role="status"
      className="overflow-hidden rounded-lg border bg-card"
    >
      {[
        ['90px', '60%'],
        ['70px', '45%'],
        ['90px', '70%'],
      ].map(([a, b], i) => (
        <div key={i} className="flex items-center gap-4 border-b px-3 py-4 last:border-b-0">
          <Skeleton className="h-3.5" style={{ width: a }} />
          <Skeleton className="h-3.5" style={{ width: b }} />
          <Skeleton className="ml-auto h-3.5 w-12" />
          <Skeleton className="h-3.5 w-13" />
        </div>
      ))}
    </div>
  )
}

function RunsTable({ rows, now }: { rows: RunListRow[]; now: Date }) {
  const refs = useRef<(HTMLTableRowElement | null)[]>([])
  const [active, setActive] = useState(0)
  const open = (r: RunListRow) => navigate(`/runs/${r.id}`)
  const move = (i: number) => {
    const j = Math.max(0, Math.min(rows.length - 1, i))
    setActive(j)
    refs.current[j]?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, i: number, r: RunListRow) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(i + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(i - 1)
    } else if (e.key === 'Enter') open(r)
  }

  return (
    <div className="relative overflow-hidden rounded-lg border bg-card">
      <Table aria-describedby="runs-kb" className="max-[760px]:block">
        <TableHeader className="max-[760px]:hidden">
          <TableRow className="hover:bg-transparent">
            <TableHead>Status</TableHead>
            <TableHead>Request</TableHead>
            <TableHead>Run</TableHead>
            <TableHead>Variant</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead>Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="max-[760px]:block">
          {rows.map((r, i) => (
            <TableRow
              key={r.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              tabIndex={i === active ? 0 : -1}
              data-run={r.id}
              onFocus={() => setActive(i)}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('a')) open(r)
              }}
              onKeyDown={(e) => onKey(e, i, r)}
              className={cn(
                'cursor-pointer outline-none focus-visible:bg-sidebar-accent focus-visible:shadow-[inset_0_0_0_2px_var(--ring)]',
                'max-[760px]:grid max-[760px]:grid-cols-[minmax(0,1fr)_auto] max-[760px]:gap-x-3 max-[760px]:gap-y-1 max-[760px]:p-3',
                r.status === 'waiting' && 'bg-crew-subtle/55 hover:bg-crew-subtle/80',
              )}
            >
              <TableCell className="max-[760px]:h-auto max-[760px]:p-0">
                <Status visual={runVisual(r.status)} text={runLabel(r.status, r.failure_reason)} />
                {r.fix_loops > 0 && (
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {' '}
                    · {r.fix_loops} fix {r.fix_loops === 1 ? 'loop' : 'loops'}
                  </span>
                )}
              </TableCell>
              <TableCell className="py-0 whitespace-normal max-[760px]:order-first max-[760px]:col-span-full max-[760px]:h-auto max-[760px]:p-0">
                <Link
                  href={`/runs/${r.id}`}
                  tabIndex={-1}
                  className="inline-flex min-h-11 items-center font-medium text-foreground no-underline hover:underline"
                >
                  {r.title}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-[13px] text-muted-foreground tabular-nums max-[760px]:hidden">
                #{r.id}
              </TableCell>
              <TableCell className="max-[760px]:hidden">
                <VariantCell run={r} />
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums max-[760px]:h-auto max-[760px]:p-0">
                {usd(r.cost_micros)}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums max-[760px]:h-auto max-[760px]:p-0 max-[760px]:text-left max-[760px]:text-muted-foreground">
                {r.duration_ms === null ? <span aria-label="still going">—</span> : clock(r.duration_ms)}
              </TableCell>
              <TableCell className="text-right font-mono text-[13px] tabular-nums max-[760px]:h-auto max-[760px]:p-0 max-[760px]:text-muted-foreground">
                {tokensShort(r.tokens)}
                <span className="sr-only"> tokens</span>
              </TableCell>
              <TableCell className="text-muted-foreground max-[760px]:hidden">
                {ago(r.started_at, now)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function RunsPage({ meta }: { meta: Meta }) {
  useTitle('Runs · Agent Dev Crew')
  const live = meta.mode === 'live'
  const load = useApi<RunsResponse>('/api/runs?limit=500', live ? 3000 : undefined)
  const [filter, setFilter] = useState<Filter>('all')
  const [variant, setVariant] = useState<'all' | Variant>('all')
  const [q, setQ] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const now = new Date()

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key !== '/' || t.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      search.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const all = load.data?.runs ?? []
  // The run waiting for you comes first; the rest stay newest first.
  const sorted = [...all].sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting'))
  const byVariant = sorted.filter((r) => variant === 'all' || r.variant === variant)
  const needle = q.trim().toLowerCase()
  const bySearch = byVariant.filter((r) => !needle || r.title.toLowerCase().includes(needle))
  const test = FILTERS.find((f) => f.id === filter)!.test
  const rows = bySearch.filter(test)
  const s = load.data?.summary

  return (
    <>
      <PageHeader
        title="Runs"
        lead={
          <>
            Each run takes one feature request through PO → your approval → Engineer → Reviewer → QA, on a
            throwaway copy of <code>fernhill-orders</code>.
          </>
        }
        actions={<NewRun meta={meta} />}
      />

      {load.state === 'error' && <LoadError what="the runs" error={load.error} onRetry={load.reload} />}
      {load.state === 'loading' && <LoadingRows />}

      {load.state === 'ok' && all.length === 0 && (
        <EmptyState
          icon={<Icon name={live ? 'queued' : 'list'} size={20} />}
          title={live ? 'Start your first run' : 'No runs on this machine yet'}
        >
          {live ? (
            <p>
              Give the crew one feature request for <code>fernhill-orders</code>. The PO writes a plan and
              stops at the gate, so nothing changes until you approve it.
            </p>
          ) : (
            <p>
              Load the example runs that ship with the demo, with their traces, diffs and costs. No API key
              needed.
            </p>
          )}
          <CodeBlock
            className="w-full"
            title={live ? 'Or from the terminal' : 'Terminal'}
            copyText={live ? `$ ${LIVE_EXAMPLE}` : '$ pnpm demo'}
          >
            {live ? `$ ${LIVE_EXAMPLE}` : '$ pnpm demo'}
          </CodeBlock>
          {!live && (
            <p>
              Or start a live run with your own key: <code>{LIVE_EXAMPLE}</code>.
            </p>
          )}
        </EmptyState>
      )}

      {load.state === 'ok' && s && all.length > 0 && (
        <>
          <MetaStrip
            className="mb-5"
            items={[
              { k: 'Runs', v: s.runs },
              {
                k: 'Passed',
                v: (
                  <>
                    {s.passed}
                    <Small>of {s.finished} finished</Small>
                  </>
                ),
              },
              { k: 'Total cost', v: usd(s.costMicros) },
              { k: 'Median duration', v: s.medianDurationMs === null ? '—' : clock(s.medianDurationMs) },
              { k: 'Fix loops used', v: s.fixLoops },
            ]}
          />

          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="gap-0">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <TabsList
                aria-label="Filter by status"
                className="max-[760px]:w-full max-[760px]:overflow-x-auto"
              >
                {FILTERS.map((f) => (
                  <TabsTrigger key={f.id} value={f.id} className="flex-none whitespace-nowrap">
                    {f.label}
                    <span className="font-mono text-[13px] text-muted-foreground tabular-nums">
                      {
                        byVariant
                          .filter((r) => !needle || r.title.toLowerCase().includes(needle))
                          .filter(f.test).length
                      }
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <Select value={variant} onValueChange={(v) => setVariant(v as 'all' | Variant)}>
                <SelectTrigger aria-label="Variant" className="max-[760px]:w-full">
                  <span className="text-muted-foreground">Variant</span>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {(['crew-playbook', 'crew', 'single-agent'] as const).map((v) => (
                    <SelectItem key={v} value={v}>
                      {VARIANT_LABEL[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="flex-1" />
              <label className="relative w-[280px] max-[760px]:w-full">
                <span className="sr-only">Search runs</span>
                <Icon
                  name="search"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  ref={search}
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search requests"
                  className="pr-10 pl-9"
                  aria-keyshortcuts="/"
                />
                <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
                  <Kbd>/</Kbd>
                </span>
              </label>
            </div>
            <TabsContent value={filter} tabIndex={-1} className="focus-visible:ring-0">
              {rows.length === 0 ? (
                <div className="grid justify-items-start gap-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  <p>No runs match these filters.</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFilter('all')
                      setVariant('all')
                      setQ('')
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                <RunsTable rows={rows} now={now} />
              )}
            </TabsContent>
          </Tabs>
          <p id="runs-kb" className="mt-2 text-[13px] text-muted-foreground max-[760px]:hidden">
            Keyboard: <Kbd>↑</Kbd> <Kbd>↓</Kbd> move between runs, <Kbd>Enter</Kbd> opens one.
          </p>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Showing {rows.length} of {all.length}{' '}
            {all.every((r) => r.origin === 'example') ? 'example runs' : 'runs'}
            {live ? ' · live mode, on this machine' : ' · replay mode replays them without calling a model'}
            {!meta.exampleData && (
              <>
                {' · the measured numbers are in '}
                <Link
                  href="/evaluation"
                  className="inline-flex min-h-6 items-center text-primary underline underline-offset-[3px] max-[760px]:min-h-11"
                >
                  Evaluation
                </Link>
              </>
            )}
          </p>
        </>
      )}
    </>
  )
}
