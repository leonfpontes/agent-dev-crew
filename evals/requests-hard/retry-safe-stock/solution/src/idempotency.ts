// Idempotency-Key: a retried POST /orders, /orders/:id/pay or /orders/:id/cancel gets the first answer again.
import { fail } from './http.js'

const PATHS = [/^\/orders$/, /^\/orders\/[^/]+\/(pay|cancel)$/]
const KEY = /^[A-Za-z0-9_-]{1,64}$/
const TTL_MS = 24 * 60 * 60 * 1000

interface Remembered {
  body: string
  status: number
  answer: string
  contentType: string
  at: number
}

/** The JSON text of a value with object keys sorted, so equal bodies compare equal. */
function canonical(text: string): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, sort((value as Record<string, unknown>)[k])]),
          )
        : value
  try {
    return JSON.stringify(sort(JSON.parse(text)))
  } catch {
    return text
  }
}

export function withIdempotency(
  handle: (req: Request) => Promise<Response>,
  now: () => Date,
): (req: Request) => Promise<Response> {
  const remembered = new Map<string, Remembered>()
  // Requests with the same key and path run one after the other: a retry that arrives while the
  // first is still running waits for it, then sees its remembered answer.
  const running = new Map<string, Promise<unknown>>()
  const oneAtATime = <T>(id: string, work: () => Promise<T>): Promise<T> => {
    const run = (running.get(id) ?? Promise.resolve()).then(work)
    running.set(
      id,
      run.catch(() => undefined),
    )
    return run
  }
  return async (req) => {
    const key = req.headers.get('idempotency-key')
    const path = new URL(req.url).pathname
    if (key === null || req.method !== 'POST' || !PATHS.some((p) => p.test(path))) return handle(req)
    if (!KEY.test(key)) return fail(400, 'Invalid Idempotency-Key')

    const text = await req.text()
    const id = `${path} ${key}`
    return oneAtATime(id, () => answer(req, text, id))
  }

  async function answer(req: Request, text: string, id: string): Promise<Response> {
    const body = canonical(text)
    const at = now().getTime()
    const seen = remembered.get(id)
    if (seen && at - seen.at < TTL_MS) {
      if (seen.body !== body) return fail(422, 'Idempotency-Key reused with a different request')
      return new Response(seen.answer, {
        status: seen.status,
        headers: { 'content-type': seen.contentType, 'idempotent-replayed': 'true' },
      })
    }
    remembered.delete(id)
    const res = await handle(new Request(req.url, { method: req.method, headers: req.headers, body: text }))
    if (res.status < 200 || res.status > 299) return res
    const saved = await res.text()
    const contentType = res.headers.get('content-type') ?? 'application/json; charset=utf-8'
    remembered.set(id, { body, status: res.status, answer: saved, contentType, at })
    return new Response(saved, { status: res.status, headers: res.headers })
  }
}
