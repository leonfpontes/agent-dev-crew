// The GIF and the video can't fall behind their sources: docs/media/crew-demo.numbers.json (written
// with them by pnpm record-demo) must equal the captions the scoreboard and the replay run give
// today. A failure means: run pnpm record-demo and commit the media with the numbers.
import { describe, expect, it } from 'vitest'

import numbers from '@repo/docs/media/crew-demo.numbers.json'
import vtt from '@repo/docs/media/crew-demo.en.vtt?raw'
import { getJson } from './api'
import {
  GIF_MS,
  GIF_SCENES,
  gifCaptions,
  terminalLines,
  VIDEO_MS,
  VIDEO_SCENES,
  videoCaptions,
} from './demo-script'
import { planFrom } from './run'
import { scoreSets } from './scoreboards'
import { SHOWCASE_RUN } from './share'
import type { EventRow, RunDetail } from './types'
import { installApi } from '../test/api'

describe('demo media', () => {
  it('carry the captions the scoreboard and the replay run give today (pnpm record-demo when this fails)', async () => {
    installApi({ scoreboard: 'real' })
    const run = await getJson<RunDetail>(`/api/runs/${SHOWCASE_RUN}`)
    expect(numbers).toEqual({ video: videoCaptions(scoreSets()), gif: gifCaptions(run) })
  })

  it('keep every caption to one line of at most 70 characters, on screen for 2.5 s or more', () => {
    for (const c of [...numbers.video, ...numbers.gif]) {
      expect(c.text.length, c.text).toBeLessThanOrEqual(70)
      expect(c.to - c.from).toBeGreaterThanOrEqual(2500)
    }
  })

  it('ship the video captions as WebVTT too', () => {
    for (const c of numbers.video) expect(vtt).toContain(c.text)
  })

  it('cover each clock without gaps', () => {
    for (const [scenes, length] of [
      [VIDEO_SCENES, VIDEO_MS],
      [GIF_SCENES, GIF_MS],
    ] as const) {
      expect(scenes[0]!.from).toBe(0)
      expect(scenes.at(-1)!.to).toBe(length)
      scenes.slice(1).forEach((s, i) => expect(s.from).toBe(scenes[i]!.to))
    }
  })
})

describe('the terminal of the GIF and the video', () => {
  it('prints what pnpm crew run prints (packages/api/src/cli.ts), with the run of the trace', async () => {
    installApi({ scoreboard: 'real' })
    const run = await getJson<RunDetail>(`/api/runs/${SHOWCASE_RUN}`)
    const plan = await getJson<{ events: EventRow[] }>(
      `/api/runs/${SHOWCASE_RUN}/steps/${run.steps.find((s) => s.kind === 'plan')!.id}/events`,
    )
    const { head, gate } = terminalLines(run, planFrom(run, plan.events))
    expect(head[0]).toBe(`$ pnpm crew run "${run.run.title}" --variant ${run.run.variant}`)
    expect(head[1]).toBe(`Run #${run.run.id} started (${run.run.variant}).`)
    // the CLI's lines, as its template writes them: one estimate, the money left with 3 decimals
    expect(head.at(-1)).toMatch(/^Files: \S.* · estimate \$\d+(\.\d+)? of \$\d+\.\d{3} left$/)
    expect(gate[0]).toBe('Approve (y), request changes (c) or reject (n)? y')
    expect(gate[2]).toMatch(
      /^Run #\d+: (passed|failed|rejected)( \(.+\))? · (\d+ \/ \d+ tests|no tests) · \$\d+\.\d{4}$/,
    )
    expect(gate[3]).toBe('See it with: pnpm crew serve --live')
  })
})
