// The app's only door to the trace: GET reads, POST answers the gate. Errors carry the API's own
// sentence ("what went wrong and what to do") and, for replay writes, how to run live.
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ApiErrorBody, GateDecision } from './types'

/** After this long without an answer, the loading state turns into the error state. */
export const TIMEOUT_MS = 10_000

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly how?: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
    })
  } catch (e) {
    throw new ApiError(
      0,
      (e as Error).name === 'AbortError'
        ? `The API did not answer in ${TIMEOUT_MS / 1000} s. Check that pnpm demo is running, then try again.`
        : 'The API is not reachable. Start it with pnpm demo, then try again.',
    )
  } finally {
    clearTimeout(timer)
  }
  const body = (await response.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error ?? `The API answered ${response.status}. Try again.`,
      body?.how,
    )
  }
  return body as T
}

export const getJson = <T>(path: string) => request<T>(path)

export function answerGate(runId: number, decision: GateDecision, comment?: string) {
  return request<{ runId: number; decision: GateDecision }>(`/api/runs/${runId}/gate`, {
    method: 'POST',
    body: JSON.stringify(comment ? { decision, comment } : { decision }),
  })
}

export type Load<T> =
  | { state: 'loading'; data?: undefined; error?: undefined }
  | { state: 'ok'; data: T; error?: undefined }
  | { state: 'error'; data?: undefined; error: ApiError }

/**
 * Reads one API path. `pollMs` refreshes it in place (live runs) without going back to loading.
 * `null` reads nothing.
 */
export function useApi<T>(path: string | null, pollMs?: number): Load<T> & { reload: () => void } {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' })
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const shown = useRef(false)

  useEffect(() => {
    if (path === null) return
    let alive = true
    shown.current = false
    setLoad({ state: 'loading' })
    getJson<T>(path).then(
      (data) => {
        if (!alive) return
        shown.current = true
        setLoad({ state: 'ok', data })
      },
      (error: ApiError) => alive && setLoad({ state: 'error', error }),
    )
    return () => {
      alive = false
    }
  }, [path, nonce])

  useEffect(() => {
    if (path === null || !pollMs) return
    const timer = setInterval(() => {
      if (!shown.current) return
      getJson<T>(path).then(
        (data) => setLoad({ state: 'ok', data }),
        () => {},
      )
    }, pollMs)
    return () => clearInterval(timer)
  }, [path, pollMs])

  return { ...load, reload } as Load<T> & { reload: () => void }
}
