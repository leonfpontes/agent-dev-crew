// The public demo's API on Vercel: replay mode only. The example runs and the real scoreboards
// (evals/results/latest.json and hard.json, bundled with the function by these imports) are seeded into
// in-memory databases when the function starts, so there is no file to write; no model is ever called.
// vercel.json rewrites /api/<path> to /api/handler?path=<path>.
import { createApi, loadReplay, type ReplayOptions } from '@crew/api/replay'

import hard from '../evals/results/hard.json' with { type: 'json' }
import results from '../evals/results/latest.json' with { type: 'json' }

const replay = loadReplay({
  evaluation: results as unknown as ReplayOptions['evaluation'],
  hardEvaluation: hard as unknown as ReplayOptions['evaluation'],
})
const api = createApi({
  trace: replay.trace,
  mode: 'replay',
  exampleData: replay.exampleData,
  evaluationMeta: replay.evaluationMeta,
  evaluations: replay.evaluations,
})

/** The request as the API expects it: /api/<path>, with the other query parameters kept. */
export function toApiRequest(request: Request): Request {
  const url = new URL(request.url)
  const path = url.searchParams.get('path') ?? ''
  url.searchParams.delete('path')
  url.pathname = `/api/${path.replace(/^\/+/, '')}`
  return new Request(url, request)
}

const handle = (request: Request) => api(toApiRequest(request))

export const GET = handle
export const HEAD = handle
export const POST = handle
