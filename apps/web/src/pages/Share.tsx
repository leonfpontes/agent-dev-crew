// The share images, drawn by the app from the API: the GitHub social preview (1280 × 640), the
// OG image (1200 × 630) and the README cover (1280 × 640, light and dark). scripts/share-images.mjs
// screenshots each artboard and saves window.__shareValues next to them. Not linked from the app.
import { useEffect, type ReactNode } from 'react'

import { cn } from '@leonfpontes/atlas-ui'

import { Mark } from '../components/icons'
import { RunCard } from '../components/RunCard'
import { useApi } from '../lib/api'
import { useNoIndex, useTitle } from '../lib/hooks'
import { leadSet, scoreSets, SET_LABEL, setNumbers, type ScoreSet } from '../lib/scoreboards'
import { PHRASE, SHOWCASE_RUN, shareRun, shareValues } from '../lib/share'
import type { RunDetail } from '../lib/types'

const ART_SUB =
  'PO, Engineer, Reviewer and QA as a DAG, with a human gate, a cost trace and a playbook of rules you approve.'

function Art({
  id,
  width,
  height,
  dark = false,
  footer,
  sets,
  run,
}: {
  id: string
  width: number
  height: number
  dark?: boolean
  footer: ReactNode
  sets: ScoreSet[]
  run: RunDetail
}) {
  const lead = leadSet(sets)
  const n = lead ? setNumbers(lead) : null
  const og = width === 1200
  return (
    <div
      id={id}
      className={cn(
        'grid grid-rows-[1fr_auto] overflow-hidden bg-background text-foreground',
        dark && 'dark',
      )}
      style={{ width, height }}
      role="img"
      aria-label={`Agent Dev Crew. ${PHRASE}${n ? ` On the ${SET_LABEL[n.set]}, requests passing all hidden tests: one agent ${n.oneAgent}%, ${n.crewLabel} ${n.crew}%, at ${n.costRatio} the cost.` : ''} The trace of an example run.`}
    >
      <div
        className={cn(
          'grid items-start',
          og
            ? 'grid-cols-[470px_minmax(0,1fr)] gap-x-10 px-12 pt-12'
            : 'grid-cols-[500px_minmax(0,1fr)] gap-x-12 px-14 pt-[52px]',
        )}
      >
        <div>
          <div className="flex items-center gap-3 text-2xl font-semibold">
            <Mark size={34} />
            Agent Dev Crew
          </div>
          <h1
            className={cn(
              'mt-8 mb-4 leading-[1.12] font-semibold tracking-[-0.03em]',
              og ? 'text-[39px]' : 'text-[42px]',
            )}
          >
            {PHRASE}
          </h1>
          <p className="text-[20px] leading-[1.45] text-muted-foreground">{ART_SUB}</p>
          {n && (
            <div className="mt-5 text-[19px] text-muted-foreground">
              <p>
                <b className="font-mono font-medium text-foreground">{n.oneAgent}%</b> one agent ·{' '}
                <b className="font-mono font-medium text-foreground">{n.crew}%</b>{' '}
                {n.crewLabel.replace('the ', '')} ·{' '}
                <b className="font-mono font-medium text-foreground">{n.costRatio}</b> the cost
              </p>
              <p className="mt-1 text-[15px]">
                {SET_LABEL[n.set]} · {n.requests} requests × {n.rounds} rounds
              </p>
            </div>
          )}
        </div>
        <RunCard run={shareRun(run)} size="art" tag="example run" />
      </div>
      <div
        className={cn(
          'mt-6 flex justify-between gap-6 border-t py-[18px] font-mono text-lg text-muted-foreground [&_b]:font-medium [&_b]:text-foreground',
          og ? 'px-12' : 'px-14',
        )}
      >
        {footer}
      </div>
    </div>
  )
}

declare global {
  interface Window {
    __shareValues?: ReturnType<typeof shareValues>
  }
}

export function SharePage() {
  useNoIndex()
  useTitle('Share images · Agent Dev Crew')
  const sets = scoreSets()
  const run = useApi<RunDetail>(`/api/runs/${SHOWCASE_RUN}`)
  const ready = run.data
  useEffect(() => {
    if (run.data) window.__shareValues = shareValues(scoreSets(), run.data)
  }, [run.data])
  if (!ready) return <p className="p-6">Loading the scoreboard and run #{SHOWCASE_RUN}…</p>
  const pipeline = (
    <>
      <span>
        <b>PO</b> → <b>Human gate</b> → <b>Engineer</b> → <b>Reviewer</b> → <b>QA</b> → <b>Retro</b>
      </span>
      <span>trace · eval · replay demo</span>
    </>
  )
  const props = { sets, run: run.data }
  return (
    <main className="grid justify-start gap-10 bg-secondary p-8">
      <Art
        id="art-social"
        width={1280}
        height={640}
        {...props}
        footer={
          <>
            <span>
              <b>github.com/leonfpontes/agent-dev-crew</b>
            </span>
            <span>TypeScript · MIT</span>
          </>
        }
      />
      <Art
        id="art-og"
        width={1200}
        height={630}
        {...props}
        footer={
          <>
            <span>
              <b>How it works</b> · pipeline · trace · evaluation
            </span>
            <span>Agent Dev Crew · MIT</span>
          </>
        }
      />
      <Art id="art-cover-light" width={1280} height={640} {...props} footer={pipeline} />
      <Art id="art-cover-dark" width={1280} height={640} dark {...props} footer={pipeline} />
    </main>
  )
}
