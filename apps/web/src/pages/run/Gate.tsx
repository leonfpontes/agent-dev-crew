// The human gate. While it waits, this card sits on top of the run: it is the only thing the run
// needs from the person. Approve needs no reason; Request changes and Reject need one, because it is
// the only record of why. The A / C / R shortcuts work only while the panel has focus.
import { useState, type KeyboardEvent } from 'react'

import { Alert, AlertDescription, AlertTitle, Badge, Button, cn, Textarea } from '@leonfpontes/atlas-ui'

import { Kbd } from '../../components/bits'
import { Icon } from '../../components/icons'
import { answerGate, type ApiError } from '../../lib/api'
import type { GateDecision, Plan } from '../../lib/types'
import { PlanBody } from './StepPanel'

export function GateCard({
  runId,
  plan,
  waiting,
  budgetLeft,
  revision,
  onDecided,
}: {
  runId: number
  plan: Plan | null
  /** How long the gate has waited, as the header strip says it ("2m 31s"). */
  waiting: string
  budgetLeft: number
  /** Earlier plan versions and the comments that sent them back. */
  revision: { comment: string | null }[]
  onDecided: (decision: GateDecision) => void
}) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<GateDecision | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [tried, setTried] = useState(false)
  const hasComment = comment.trim().length > 0

  const decide = async (decision: GateDecision) => {
    if (decision !== 'approve' && !hasComment) {
      setTried(true)
      return
    }
    setBusy(decision)
    setError(null)
    try {
      await answerGate(runId, decision, hasComment ? comment.trim() : undefined)
      onDecided(decision)
    } catch (e) {
      setError(e as ApiError)
    } finally {
      setBusy(null)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('textarea, input') || e.metaKey || e.ctrlKey || e.altKey) return
    const map: Record<string, GateDecision> = { a: 'approve', c: 'request-changes', r: 'reject' }
    const decision = map[e.key.toLowerCase()]
    if (!decision) return
    e.preventDefault()
    void decide(decision)
  }

  return (
    <section aria-labelledby="gate-h" className="mt-6">
      <div
        id="gate-panel"
        tabIndex={-1}
        onKeyDown={onKey}
        className="rounded-xl border border-crew-line bg-card outline-none focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_50%,transparent)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 max-[760px]:px-4">
          <h2 id="gate-h" className="flex items-center gap-2 text-base font-semibold">
            <Icon name="gate" className="text-crew" />
            {revision.length
              ? `Human gate · plan v${revision.length + 1} waiting for you`
              : 'Human gate · approve the plan before the Engineer writes code'}
          </h2>
          <Badge className="bg-crew-subtle text-crew">
            <Icon name="gate" size={12} />
            Waiting for you · {waiting}
          </Badge>
        </div>
        <div className="grid gap-4 px-5 pt-4 pb-5 max-[760px]:px-4">
          {revision.length > 0 && (
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {revision.map((r, i) => (
                <div key={i} className="contents">
                  <dt className="text-[13px] text-muted-foreground">Plan v{i + 1}</dt>
                  <dd className="m-0">Changes requested{r.comment ? ` · “${r.comment}”` : ''}</dd>
                </div>
              ))}
            </dl>
          )}
          {plan ? (
            <PlanBody plan={plan} budgetLeft={budgetLeft} />
          ) : (
            <p className="text-sm text-muted-foreground">The PO plan is still loading.</p>
          )}
          <div className="grid gap-3 border-t pt-4">
            <div className="grid gap-2">
              <label htmlFor="gate-comment" className="text-sm leading-none font-medium">
                Comment{' '}
                <span className="font-normal text-muted-foreground">
                  · required to request changes or reject · saved in the trace
                </span>
              </label>
              <Textarea
                id="gate-comment"
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value)
                  setTried(false)
                }}
                aria-invalid={tried && !hasComment ? true : undefined}
                aria-describedby="gate-hint"
                placeholder="For example: keep stock checks out of scope for now"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 max-[760px]:[&>button]:flex-[1_1_140px]">
              <Button
                aria-keyshortcuts="A"
                aria-busy={busy === 'approve'}
                disabled={!!busy}
                onClick={() => void decide('approve')}
              >
                <Icon name="check" />
                Approve plan <Kbd onPrimary>A</Kbd>
              </Button>
              <Button
                variant="outline"
                aria-keyshortcuts="C"
                disabled={!hasComment || !!busy}
                aria-busy={busy === 'request-changes'}
                onClick={() => void decide('request-changes')}
              >
                <Icon name="edit" />
                Request changes <Kbd>C</Kbd>
              </Button>
              <Button
                variant="outline"
                aria-keyshortcuts="R"
                disabled={!hasComment || !!busy}
                aria-busy={busy === 'reject'}
                onClick={() => void decide('reject')}
                className="border-destructive/45 text-destructive hover:bg-destructive-subtle hover:text-destructive"
              >
                <Icon name="x" />
                Reject <Kbd>R</Kbd>
              </Button>
            </div>
            <p
              id="gate-hint"
              className={cn(
                'flex items-start gap-1.5 text-sm text-muted-foreground',
                tried && !hasComment && 'text-destructive',
              )}
            >
              <Icon name="info" className="mt-[3px]" />
              {tried && !hasComment
                ? 'Write a comment first: Request changes and Reject need one.'
                : hasComment
                  ? 'Request changes: the PO gets your comment and writes the next plan; the gate opens again. Reject ends the run.'
                  : 'Write a comment to request changes (the PO revises the plan) or to reject (the run ends). Shortcuts work while this panel has focus.'}
            </p>
            {error && (
              <Alert variant={error.status === 405 ? 'info' : 'destructive'}>
                <Icon name={error.status === 405 ? 'info' : 'failed'} />
                <AlertTitle>
                  {error.status === 405
                    ? 'Replay mode: the gate stays as in the example'
                    : "The decision didn't go through"}
                </AlertTitle>
                <AlertDescription>
                  <p>{error.message}</p>
                  {error.how && <p>{error.how}</p>}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
