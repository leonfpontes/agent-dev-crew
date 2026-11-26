// Idempotency-Key: a retried POST /orders or POST /orders/:id/pay gets the first answer again.
import { fail } from './http.js'

const PATHS = [/^\/orders$/, /^\/orders\/[^/]+\/pay$/]
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
  return async (req) => {
    const key = req.headers.get('idempotency-key')
    const path = new URL(req.url).pathname
    if (key === null || req.method !== 'POST' || !PATHS.some((p) => p.test(path))) return handle(req)
    if (!KEY.test(key)) return fail(400, 'Invalid Idempotency-Key')

    const text = await req.text()
    const body = canonical(text)
    const id = `${path} ${key}`
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
    const answer = await res.text()
    const contentType = res.headers.get('content-type') ?? 'application/json; charset=utf-8'
    remembered.set(id, { body, status: res.status, answer, contentType, at })
    return new Response(answer, { status: res.status, headers: res.headers })
  }
}
