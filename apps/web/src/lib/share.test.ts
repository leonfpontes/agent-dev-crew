// The share images can't fall behind their sources: docs/share.values.json (written with the
// images by pnpm share-images) must equal what the scoreboard and the replay run say today.
// A failure means: run pnpm share-images and commit the images with the values.
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import values from '@repo/docs/share.values.json'
import cover from '@repo/docs/cover-light.png?inline'
import coverDark from '@repo/docs/cover-dark.png?inline'
import social from '@repo/docs/social-preview.png?inline'
import og from '@repo/apps/web/public/og.png?inline'
import { getJson } from './api'
import { SHOWCASE_RUN, shareValues } from './share'
import type { EvaluationResponse, RunDetail } from './types'
import { installApi, renderAt } from '../test/api'

afterEach(cleanup)

/** Width and height of a PNG given as a data URL: big-endian integers at bytes 16 and 20. */
function pngSize(dataUrl: string) {
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]!), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('share images', () => {
  it('show the numbers of the scoreboard and of the replay run (pnpm share-images when this fails)', async () => {
    installApi({ scoreboard: 'real' })
    const evaluation = await getJson<EvaluationResponse>('/api/evaluation')
    const run = await getJson<RunDetail>(`/api/runs/${SHOWCASE_RUN}`)
    expect(values).toEqual(JSON.parse(JSON.stringify(shareValues(evaluation, run))))
  })

  it('have the sizes GitHub, Open Graph and the README expect', () => {
    expect(pngSize(social)).toEqual({ width: 1280, height: 640 })
    expect(pngSize(og)).toEqual({ width: 1200, height: 630 })
    expect(pngSize(cover)).toEqual({ width: 1280, height: 640 })
    expect(pngSize(coverDark)).toEqual({ width: 1280, height: 640 })
  })

  it('are drawn by /share, which exposes the values it drew', async () => {
    installApi({ scoreboard: 'real' })
    renderAt('/share')
    expect(
      (await screen.findAllByRole('img', { name: /^Agent Dev Crew\. A crew of AI agents/ })).length,
    ).toBe(4)
    expect(document.querySelectorAll('[id^="art-"]')).toHaveLength(4)
    expect(window.__shareValues?.run.id).toBe(SHOWCASE_RUN)
  })
})
