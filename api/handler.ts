// The public demo's API on Vercel: replay mode only. The recorded runs and the real scoreboard
// (evals/results/latest.json, bundled with the function by this import) are seeded into an in-memory
// database when the function starts, so there is no file to write; no model is ever called.
// vercel.json rewrites /api/<path> to /api/handler?path=<path>.
import { createApi, loadReplay, type ReplayOptions } from '@crew/api/replay'

import results from '../evals/results/latest.json' with { type: 'json' }

const replay = loadReplay({ evaluation: results as unknown as ReplayOptions['evaluation'] })
const api = createApi({
  trace: replay.trace,
  mode: 'replay',
  exampleData: replay.exampleData,
  evaluationMeta: replay.evaluationMeta,
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
