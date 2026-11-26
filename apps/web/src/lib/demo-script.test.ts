// The GIF and the video can't fall behind their sources: docs/media/crew-demo.numbers.json (written
// with them by pnpm record-demo) must equal the captions the scoreboard and the replay run give
// today. A failure means: run pnpm record-demo and commit the media with the numbers.
import { describe, expect, it } from 'vitest'

import numbers from '@repo/docs/media/crew-demo.numbers.json'
import vtt from '@repo/docs/media/crew-demo.en.vtt?raw'
import { getJson } from './api'
import { GIF_MS, GIF_SCENES, gifCaptions, VIDEO_MS, VIDEO_SCENES, videoCaptions } from './demo-script'
import { SHOWCASE_RUN } from './share'
import type { EvaluationResponse, RunDetail } from './types'
import { installApi } from '../test/api'

describe('demo media', () => {
  it('carry the captions the scoreboard and the replay run give today (pnpm record-demo when this fails)', async () => {
    installApi({ scoreboard: 'real' })
    const evaluation = await getJson<EvaluationResponse>('/api/evaluation')
    const run = await getJson<RunDetail>(`/api/runs/${SHOWCASE_RUN}`)
    expect(numbers).toEqual({ video: videoCaptions(evaluation), gif: gifCaptions(run) })
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
