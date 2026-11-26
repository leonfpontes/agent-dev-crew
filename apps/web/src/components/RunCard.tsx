// A run summary: every step on one time axis, the gate marked as the person's step, and the
// result underneath. The landing hero shows it; the share images draw it larger.
import { cn } from '@leonfpontes/atlas-ui'

import { barKind } from '../lib/run'
import type { ShareRun } from '../lib/share'
import { Status, runLabel, runVisual, stepVisual } from './Status'

const SIZES = {
  site: {
    head: 'px-4 py-3.5 text-[15px]',
    row: 'grid-cols-[20px_minmax(0,1.5fr)_minmax(72px,1fr)_58px] min-h-10 px-4 text-sm',
    small: 'text-xs',
    num: 'text-[13px]',
    bar: 'h-2',
    foot: 'px-4 py-3 text-[13px]',
    icon: 16,
  },
  art: {
    head: 'px-5 py-3.5 text-lg',
    row: 'grid-cols-[22px_minmax(0,1fr)_150px_74px] h-10 px-5 text-[17px]',
    small: 'text-sm',
    num: 'text-base',
    bar: 'h-2.5',
    foot: 'px-5 py-3 text-base',
    icon: 18,
  },
}

export function RunCard({
  run,
  size = 'site',
  className,
  tag,
}: {
  run: ShareRun
  size?: keyof typeof SIZES
  className?: string
  /** A note in the header, such as "example run". */
  tag?: string
}) {
  const z = SIZES[size]
  const status = run.status as Parameters<typeof runVisual>[0]
  return (
    <figure
      className={cn('m-0 overflow-hidden rounded-xl border bg-card', className)}
      aria-label={`Run ${run.id}: ${run.title}, ${runLabel(status, null).toLowerCase()}${run.tests ? `, ${run.tests} tests` : ''}, ${run.cost}, ${run.duration}`}
    >
      <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b', z.head)}>
        <b className="font-semibold">{run.title}</b>
        <span className="flex items-center gap-2">
          {tag && (
            <span className="rounded-sm border border-dashed border-warning bg-warning-subtle px-2 text-xs leading-[18px] font-medium text-warning">
              {tag}
            </span>
          )}
          <Status
            visual={runVisual(status)}
            size={z.icon}
            className={size === 'art' ? 'text-base' : undefined}
          />
        </span>
      </div>
      <ol className="py-1" aria-hidden="true">
        {run.rows.map((r) => {
          const kind = barKind({ kind: r.kind } as never, r.status)
          const gate = r.kind === 'gate'
          return (
            <li
              key={r.id}
              className={cn(
                'grid items-center gap-2.5',
                z.row,
                gate && 'bg-crew-subtle/70 shadow-[inset_2px_0_0_var(--crew)]',
              )}
            >
              <Status visual={stepVisual(r.status)} label={false} size={z.icon} />
              <span className={cn('min-w-0', r.inner && 'pl-4')}>
                {r.name}
                {gate ? (
                  <small className={cn('ml-1.5 font-medium text-crew', z.small)}>you approve here</small>
                ) : (
                  r.sub && <small className={cn('ml-1.5 text-muted-foreground', z.small)}>{r.sub}</small>
                )}
              </span>
              <span className={cn('crew-track bg-none', z.bar)}>
                {kind && (
                  <i
                    className={`crew-bar crew-bar-${kind === 'r' ? 'p' : kind}`}
                    style={{ left: `${r.left}%`, width: `${r.width}%` }}
                  />
                )}
              </span>
              <span className={cn('text-right font-mono tabular-nums', z.num)}>{r.cost}</span>
            </li>
          )
        })}
      </ol>
      <div
        className={cn(
          'flex flex-wrap justify-between gap-4 border-t font-mono text-muted-foreground tabular-nums',
          z.foot,
        )}
      >
        <span>
          {run.files > 0 && (
            <>
              {run.files} {run.files === 1 ? 'file' : 'files'} ·{' '}
              <span className="text-success">+{run.additions}</span>{' '}
              <span className="text-destructive">−{run.deletions}</span>
            </>
          )}
          {run.tests && ` · ${run.tests} tests`}
        </span>
        <span>
          {run.cost} · {run.duration}
        </span>
      </div>
    </figure>
  )
}
