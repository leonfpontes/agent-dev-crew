// Playbook: the version list, playbook.md with the proposed rule highlighted, and the proposal
// (run → error → cause → rule, the diff, Approve / Reject / Edit rule). Below, the history v1 → vN
// with each diff and what the evaluation measured.
import { useEffect, useState, type ReactNode } from 'react'

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  cn,
  Skeleton,
  Textarea,
} from '@leonfpontes/atlas-ui'

import { DiffLines, LoadError, PageHeader, SectionHead, Ticks } from '../components/bits'
import { Icon } from '../components/icons'
import { ApiError, useApi } from '../lib/api'
import { count, parseHunks } from '../lib/diff'
import { ago, percent, sdPoints } from '../lib/format'
import { useTitle } from '../lib/hooks'
import { Link } from '../lib/router'
import { ROLE_LABEL } from '../lib/run'
import type { EvaluationResponse, Meta, PlaybookVersion, RunDetail } from '../lib/types'

/** "run #142 · lesson 1 · QA · test, attempt 1", or how a hand edit came in. */
export function provenance(v: PlaybookVersion): string {
  if (v.source === 'initial') return 'written by hand'
  if (v.source === 'manual') return 'edited by hand'
  const run = v.source_run_id ?? v.lesson_run_id
  const parts = [run ? `run #${run}` : 'retro']
  if (v.lesson_position) parts.push(`lesson ${v.lesson_position}`)
  if (v.lesson_step_role && v.lesson_step_kind)
    parts.push(
      `${ROLE_LABEL[v.lesson_step_role]} · ${v.lesson_step_kind}${v.lesson_step_attempt ? `, attempt ${v.lesson_step_attempt}` : ''}`,
    )
  return parts.join(' · ')
}

interface Block {
  kind: 'h2' | 'li'
  text: string
}

/** The playbook's markdown: "## Role" sections with "- " rules (a rule may wrap onto indented lines). */
export function parsePlaybook(content: string): Block[] {
  const blocks: Block[] = []
  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) blocks.push({ kind: 'h2', text: line.slice(3).trim() })
    else if (line.startsWith('- ')) blocks.push({ kind: 'li', text: line.slice(2).trim() })
    else if (/^\s+\S/.test(line) && blocks.at(-1)?.kind === 'li') blocks.at(-1)!.text += ` ${line.trim()}`
  }
  return blocks
}

/** The rules a version added: its diff's added lines, joined when a rule wraps. */
export function addedRules(diff: string | null): string[] {
  const rules: string[] = []
  for (const l of parseHunks(diff ?? '')) {
    if (l.type !== 'add') continue
    if (l.text.startsWith('- ')) rules.push(l.text.slice(2).trim())
    else if (/^\s+\S/.test(l.text) && rules.length) rules[rules.length - 1] += ` ${l.text.trim()}`
  }
  return rules
}

function Markdown({ version }: { version: PlaybookVersion }) {
  const blocks = parsePlaybook(version.content)
  const added = new Set(addedRules(version.diff))
  const sections: { title: string; rules: string[] }[] = []
  for (const b of blocks) {
    if (b.kind === 'h2') sections.push({ title: b.text, rules: [] })
    else sections.at(-1)?.rules.push(b.text)
  }
  return (
    <div className="crew-md px-6 py-5 max-[760px]:px-4">
      {sections.map((s) => (
        <div key={s.title}>
          <h2 id={s.title.toLowerCase()} className="scroll-mt-28">
            {s.title}
          </h2>
          <ul>
            {s.rules.map((r) => (
              <li key={r} className={cn(added.has(r) && version.source !== 'initial' && 'crew-ins')}>
                {added.has(r) && version.source !== 'initial' ? (
                  <>
                    <strong className="font-semibold">
                      <Ticks text={r} />
                    </strong>{' '}
                    <Badge
                      className={cn(
                        version.status === 'proposed'
                          ? 'bg-crew-subtle text-crew'
                          : 'bg-success-subtle text-success',
                      )}
                    >
                      v{version.version}
                      {version.source_run_id ? ` · run #${version.source_run_id}` : ''}
                    </Badge>
                  </>
                ) : (
                  <Ticks text={r} />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function measured(v: PlaybookVersion, evaluation: EvaluationResponse | undefined): string {
  const point = evaluation?.learningCurve.points.find((p) => p.playbookVersion === v.version)
  if (point)
    return `Measured: ${percent(point.passRate.mean)}${point.rounds > 1 ? ` ${sdPoints(point.passRate.sd)}` : ''} (${point.rounds} ${point.rounds === 1 ? 'round' : 'rounds'})`
  if (v.source === 'manual') return 'Not measured · no rule changed'
  return 'Not measured yet'
}

function Proposal({
  version,
  previous,
}: {
  version: PlaybookVersion
  previous: PlaybookVersion | undefined
}) {
  const runId = version.lesson_run_id ?? version.source_run_id
  const run = useApi<RunDetail>(runId ? `/api/runs/${runId}` : null)
  const lessons = run.data?.lessons ?? []
  const lesson =
    lessons.find((l) => l.playbook_version === version.version) ??
    lessons.find((l) => l.position === version.lesson_position)
  const dropped = lessons.filter((l) => l.status === 'duplicate')
  const lines = parseHunks(version.diff ?? '')
  const [editing, setEditing] = useState(false)
  const [rule, setRule] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const decide = async (decision: 'approve' | 'reject', edited?: string) => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/playbook/${version.version}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(edited ? { decision, rule: edited } : { decision }),
      })
      const body = (await response.json().catch(() => ({}))) as { error?: string; how?: string }
      if (!response.ok)
        throw new ApiError(response.status, body.error ?? `The API answered ${response.status}.`, body.how)
      setDone(decision === 'approve' ? `Approved as v${version.version}.` : `Rejected v${version.version}.`)
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setBusy(false)
    }
  }

  const step =
    version.lesson_step_role && version.lesson_step_kind
      ? `${ROLE_LABEL[version.lesson_step_role]} · ${version.lesson_step_kind}${version.lesson_step_attempt ? `, attempt ${version.lesson_step_attempt}` : ''}`
      : null

  return (
    <aside id="proposal" aria-labelledby="pr-h" className="pb-side">
      <div className="rounded-xl border border-crew-line bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 max-[760px]:px-4">
          <h2 id="pr-h" className="flex items-center gap-2 text-base font-semibold">
            <Icon name="gate" className="text-crew" />
            Proposed change
          </h2>
          <Badge className="bg-crew-subtle text-crew">Waiting for you</Badge>
        </div>
        <div className="grid gap-4 px-5 pt-4 pb-5 max-[760px]:px-4">
          <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            <dt className="text-xs/[22px] font-medium text-muted-foreground">From</dt>
            <dd className="m-0">
              {runId ? (
                <Link href={`/runs/${runId}`} className="text-primary underline underline-offset-[3px]">
                  Run #{runId}
                </Link>
              ) : (
                'Retro'
              )}
              {version.lesson_position &&
                ` · lesson ${version.lesson_position}${lessons.length ? ` of ${lessons.length}` : ''}`}
              {step && (
                <>
                  , from{' '}
                  {runId ? (
                    <Link
                      href={`/runs/${runId}?step=${lesson?.step_id ?? ''}`}
                      className="text-primary underline underline-offset-[3px]"
                    >
                      {step}
                    </Link>
                  ) : (
                    step
                  )}
                </>
              )}
            </dd>
            {run.state === 'loading' && runId && (
              <>
                <dt className="sr-only">Lesson</dt>
                <dd className="col-span-2 m-0">
                  <Skeleton className="h-16" />
                </dd>
              </>
            )}
            {lesson && (
              <>
                <dt className="text-xs/[22px] font-medium text-muted-foreground">Error</dt>
                <dd className="m-0">{lesson.error}</dd>
                <dt className="text-xs/[22px] font-medium text-muted-foreground">Cause</dt>
                <dd className="m-0">{lesson.cause}</dd>
                <dt className="text-xs/[22px] font-medium text-muted-foreground">Rule</dt>
                <dd className="m-0">
                  <strong className="font-semibold">{lesson.rule}</strong>
                </dd>
              </>
            )}
          </dl>
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="flex min-h-11 items-center gap-2.5 border-b bg-muted px-3 font-mono text-[13px] font-medium">
              <span>
                playbook.md · v{previous?.version ?? version.version - 1} → v{version.version}
              </span>
              <span className="flex-1" />
              <span className="text-success">+{count(lines, 'add')}</span>
              {count(lines, 'del') > 0 && <span className="text-destructive">−{count(lines, 'del')}</span>}
            </div>
            <DiffLines lines={lines} label="Diff of playbook.md" />
          </div>
          {dropped.map((l) => (
            <p key={l.id} className="text-[13px] text-muted-foreground">
              Another lesson of the run was a duplicate of v{l.duplicate_of} and the retro dropped it.
            </p>
          ))}
          <div className="grid gap-3 border-t pt-4">
            {editing && (
              <div className="grid gap-2">
                <label htmlFor="rule-edit" className="text-sm leading-none font-medium">
                  Rule
                </label>
                <Textarea id="rule-edit" value={rule} onChange={(e) => setRule(e.target.value)} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={busy || (editing && !rule.trim())}
                aria-busy={busy}
                onClick={() => void decide('approve', editing ? rule.trim() : undefined)}
              >
                <Icon name="check" />
                Approve as v{version.version}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void decide('reject')}
                className="border-destructive/45 text-destructive hover:bg-destructive-subtle hover:text-destructive"
              >
                <Icon name="x" />
                Reject
              </Button>
              <Button
                variant="ghost"
                aria-expanded={editing}
                onClick={() => {
                  setEditing((e) => !e)
                  setRule(lesson?.rule ?? addedRules(version.diff)[0] ?? '')
                }}
              >
                <Icon name="edit" />
                {editing ? 'Keep the rule' : 'Edit rule'}
              </Button>
            </div>
            {done && (
              <p role="status" className="text-sm text-success">
                {done}
              </p>
            )}
            {error && (
              <Alert variant={error.status === 405 ? 'info' : 'destructive'}>
                <Icon name={error.status === 405 ? 'info' : 'failed'} />
                <AlertTitle>
                  {error.status === 405
                    ? 'Replay mode: the playbook stays as recorded'
                    : "The decision didn't go through"}
                </AlertTitle>
                <AlertDescription>
                  <p>{error.message}</p>
                  {error.how && <p>{error.how}</p>}
                </AlertDescription>
              </Alert>
            )}
            <p className="text-[13px] text-muted-foreground">
              Effect: measured in the next evaluation. This page claims no gain before that.
            </p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function History({
  versions,
  evaluation,
  openVersion,
}: {
  versions: PlaybookVersion[]
  evaluation: EvaluationResponse | undefined
  openVersion: number | null
}) {
  const row =
    'grid min-h-12 grid-cols-[40px_minmax(0,1.2fr)_minmax(0,1.3fr)_auto] items-center gap-3 border-b px-4 text-sm max-[760px]:grid-cols-[32px_minmax(0,1fr)] max-[760px]:px-3 max-[760px]:py-2 max-[760px]:[&>*:nth-child(n+3)]:col-start-2'
  return (
    <section id="history" aria-labelledby="hi-h" className="mt-6">
      <SectionHead
        id="hi-h"
        title={`History · v1 to v${versions[0]?.version ?? 1}`}
        note="Each version keeps its diff, where it came from and what the evaluation measured"
      />
      <div className="overflow-hidden rounded-xl border bg-card [&>*:last-child]:border-b-0 [&>details:last-child>summary]:border-b-0">
        {versions.map((v) => {
          const head: ReactNode = (
            <>
              <span
                className={cn(
                  'font-mono text-[13px] tabular-nums',
                  v.status === 'proposed' ? 'text-crew' : 'text-muted-foreground',
                )}
              >
                v{v.version}
              </span>
              <span>{v.title}</span>
              <span className="text-muted-foreground">{provenance(v)}</span>
              {v.status === 'proposed' ? (
                <Badge className="bg-crew-subtle text-crew">
                  <Icon name="gate" size={12} />
                  Waiting for you
                </Badge>
              ) : v.status === 'rejected' ? (
                <span className="text-[13px] text-muted-foreground">Rejected</span>
              ) : (
                <span className="font-mono text-[13px] text-muted-foreground">{measured(v, evaluation)}</span>
              )}
            </>
          )
          if (v.status === 'proposed' || !v.diff)
            return (
              <div key={v.version} id={`v${v.version}`} className={cn(row, 'scroll-mt-28')}>
                {head}
              </div>
            )
          return (
            <details
              key={v.version}
              id={`v${v.version}`}
              open={openVersion === v.version}
              className="scroll-mt-28 [&:not(:last-child)>[role=region]]:border-b"
            >
              <summary
                className={cn(
                  row,
                  'outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset [details[open]>&]:border-b',
                )}
              >
                {head}
              </summary>
              <DiffLines lines={parseHunks(v.diff)} label={`Diff of v${v.version}`} />
            </details>
          )
        })}
      </div>
    </section>
  )
}

export function PlaybookPage({ meta }: { meta: Meta }) {
  useTitle('Playbook · Agent Dev Crew')
  const live = meta.mode === 'live'
  const load = useApi<{ versions: PlaybookVersion[] }>('/api/playbook', live ? 5000 : undefined)
  const evaluation = useApi<EvaluationResponse>('/api/evaluation')
  const versions = load.data?.versions ?? []
  const proposed = versions.find((v) => v.status === 'proposed')
  const current = versions.find((v) => v.status === 'approved')
  const [picked, setPicked] = useState<number | null>(null)
  const [hash, setHash] = useState(() => window.location.hash)
  const shown = versions.find((v) => v.version === picked) ?? proposed ?? current ?? versions[0]

  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const hashVersion = /^#v(\d+)$/.exec(hash)?.[1]
  useEffect(() => {
    if (!versions.length || !hash) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash, versions.length])

  return (
    <>
      <PageHeader
        title="Playbook"
        lead={
          <>
            The rules every role reads before it works. Git versions <code>playbook.md</code>; a change enters
            only when you approve it.
          </>
        }
      />
      {load.state === 'error' && <LoadError what="the playbook" error={load.error} onRetry={load.reload} />}
      {load.state === 'loading' && (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading the playbook"
          className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 max-[760px]:grid-cols-1"
        >
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      )}
      {load.state === 'ok' && versions.length === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
          No playbook yet. The engine writes v1 from <code>packages/engine/playbook.md</code> on the first
          run.
        </p>
      )}
      {load.state === 'ok' && shown && (
        <>
          <div
            className={cn(
              'grid items-start gap-4',
              proposed
                ? 'grid-cols-[220px_minmax(0,1fr)_380px] max-[1300px]:grid-cols-[200px_minmax(0,1fr)] max-[1300px]:[&>.pb-side]:col-span-full'
                : 'grid-cols-[220px_minmax(0,1fr)]',
              'max-[760px]:grid-cols-1',
            )}
          >
            <nav aria-label="Versions" className="rounded-xl border bg-card">
              <div className="border-b px-4 py-2.5 text-xs font-medium text-muted-foreground">Versions</div>
              <ul className="p-2 text-sm">
                {versions.map((v) => (
                  <li key={v.version}>
                    <button
                      type="button"
                      aria-current={shown.version === v.version ? 'true' : undefined}
                      onClick={() => setPicked(v.version)}
                      className={cn(
                        'grid min-h-11 w-full cursor-pointer grid-cols-[48px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-md p-2 text-left outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        shown.version === v.version && 'bg-sidebar-accent hover:bg-sidebar-accent',
                      )}
                    >
                      <span
                        className={cn(
                          'font-mono text-[13px] tabular-nums',
                          v.status === 'proposed' ? 'text-crew' : 'text-muted-foreground',
                        )}
                      >
                        v{v.version}
                      </span>
                      <span>{v.status === 'proposed' ? 'Proposed' : v.title}</span>
                      <small className="col-start-2 text-xs text-muted-foreground">
                        {[
                          v === current && 'current',
                          v.source === 'retro' &&
                            (v.source_run_id ? `from run #${v.source_run_id}` : 'from a retro'),
                          v.source !== 'retro' && provenance(v),
                          v.status === 'proposed' ? 'waiting for you' : ago(v.created_at),
                          v.status === 'rejected' && 'rejected',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <article aria-labelledby="pb-h" className="min-w-0 rounded-xl border bg-card">
              <div className="flex min-h-11 items-center gap-2.5 rounded-t-xl border-b bg-muted px-3 font-mono text-[13px] font-medium">
                <Icon name="file" />
                <span id="pb-h">
                  playbook.md · v{shown.version}{' '}
                  {shown.status === 'proposed' ? 'proposed' : shown === current ? 'current' : shown.status}
                </span>
                <span className="flex-1" />
                {shown.diff && (
                  <>
                    <span className="text-success">+{count(parseHunks(shown.diff), 'add')}</span>
                    <span className="text-destructive">−{count(parseHunks(shown.diff), 'del')}</span>
                  </>
                )}
              </div>
              <Markdown version={shown} />
            </article>
            {proposed && (
              <Proposal
                version={proposed}
                previous={versions.find((v) => v.version < proposed.version && v.status === 'approved')}
              />
            )}
          </div>
          <History
            versions={versions}
            evaluation={evaluation.data}
            openVersion={hashVersion ? Number(hashVersion) : (current?.version ?? null)}
          />
        </>
      )}
    </>
  )
}
