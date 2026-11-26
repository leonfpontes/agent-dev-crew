// Status = shape + color + word, never color alone. One table for every status the app shows.
import { cn } from '@leonfpontes/atlas-ui'

import type { FailureReason, RunStatus, StepStatus } from '../lib/types'
import { Icon, type IconName } from './icons'

export type Visual =
  | 'passed'
  | 'failed'
  | 'running'
  | 'queued'
  | 'waiting'
  | 'approved'
  | 'rejected'
  | 'changes'
  | 'loop'
  | 'skipped'

const VISUALS: Record<Visual, { icon: IconName; tone: string; label: string }> = {
  passed: { icon: 'passed', tone: 'text-success', label: 'Passed' },
  failed: { icon: 'failed', tone: 'text-destructive', label: 'Failed' },
  running: { icon: 'running', tone: 'text-info', label: 'Running' },
  queued: { icon: 'queued', tone: 'text-muted-foreground', label: 'Queued' },
  waiting: { icon: 'gate', tone: 'text-crew', label: 'Waiting for you' },
  approved: { icon: 'gate-ok', tone: 'text-crew', label: 'Approved' },
  rejected: { icon: 'gate-no', tone: 'text-crew', label: 'Rejected' },
  changes: { icon: 'gate', tone: 'text-crew', label: 'Changes requested' },
  loop: { icon: 'loop', tone: 'text-warning', label: 'Fix loop' },
  skipped: { icon: 'skipped', tone: 'text-muted-foreground', label: 'Skipped' },
}

export const visualLabel = (v: Visual) => VISUALS[v].label

export function stepVisual(status: StepStatus): Visual {
  switch (status) {
    case 'waiting':
      return 'waiting'
    case 'changes-requested':
      return 'changes'
    case 'fix-loop':
      return 'loop'
    default:
      return status
  }
}

export function runVisual(status: RunStatus): Visual {
  return status === 'waiting' ? 'waiting' : status
}

/** "Over budget" and "Failed" are both a failed run; the reason picks the word. */
export function runLabel(status: RunStatus, reason: FailureReason | null): string {
  if (status === 'failed' && reason === 'over-budget') return 'Over budget'
  return VISUALS[runVisual(status)].label
}

/**
 * The status mark. With `label` false the word is still there for screen readers. The running arc
 * turns once per second, and stops under reduced motion (the arc stays).
 */
export function Status({
  visual,
  label = true,
  text,
  size = 16,
  className,
  decorative = false,
}: {
  visual: Visual
  label?: boolean
  text?: string
  size?: number
  className?: string
  /** Icon only, hidden from screen readers: for a heading that already says the status in words. */
  decorative?: boolean
}) {
  const v = VISUALS[visual]
  const word = text ?? v.label
  if (decorative)
    return (
      <span
        data-status={visual}
        aria-hidden="true"
        className={cn('inline-flex items-center', v.tone, className)}
      >
        <Icon name={v.icon} size={size} />
      </span>
    )
  return (
    <span
      data-status={visual}
      className={cn(
        'inline-flex items-center gap-1.5 align-middle text-[13px] leading-none font-medium whitespace-nowrap',
        v.tone,
        className,
      )}
    >
      <Icon name={v.icon} size={size} className={visual === 'running' ? 'crew-spin' : undefined} />
      {label ? word : <span className="sr-only">{word}</span>}
    </span>
  )
}
