// The Vercel function of the public demo, called the way Vercel calls it after the rewrite.
import { describe, expect, it } from 'vitest'

import { GET, POST, toApiRequest } from '../api/handler.js'

describe('api/handler (Vercel, replay)', () => {
  it('turns /api/handler?path=… back into the API route, keeping the other parameters', () => {
    const req = toApiRequest(new Request('https://crew.example.dev/api/handler?path=runs&status=waiting'))
    expect(new URL(req.url).pathname).toBe('/api/runs')
    expect(new URL(req.url).search).toBe('?status=waiting')
  })

  it('answers the replay API, and refuses writes', async () => {
    const runs = await GET(new Request('https://crew.example.dev/api/handler?path=runs'))
    expect(runs.status).toBe(200)
    expect(((await runs.json()) as { runs: unknown[] }).runs.length).toBeGreaterThan(0)
    const meta = (await (
      await GET(new Request('https://crew.example.dev/api/handler?path=meta'))
    ).json()) as { mode: string; exampleData: boolean }
    // The function ships the real scoreboard: the Evaluation is measured, not example data.
    expect(meta).toMatchObject({ mode: 'replay', exampleData: false })
    const write = await POST(
      new Request('https://crew.example.dev/api/handler?path=runs', { method: 'POST', body: '{}' }),
    )
    expect(write.status).toBe(405)
  })
})
