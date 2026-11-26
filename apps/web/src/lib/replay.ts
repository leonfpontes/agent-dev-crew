// Replay: the recorded run plays in compressed time behind a playhead (4× by default, 1× to read
// along). The gate wait is compressed like the rest, never skipped. Stop returns to the full trace.
import { useCallback, useEffect, useRef, useState } from 'react'

export type ReplayState = 'idle' | 'playing' | 'paused'

export interface Replay {
  state: ReplayState
  speed: number
  /** Run time shown, in ms; undefined when not replaying (the full trace). */
  t: number | undefined
  play: () => void
  pause: () => void
  stop: () => void
  toggle: () => void
  setSpeed: (speed: number) => void
}

/**
 * `durationMs` is the run's length. `onPlay` runs before the first frame (it fetches the timeline);
 * the clock starts once it resolves. `now` is injectable for tests.
 */
export function useReplay(
  durationMs: number,
  { onPlay, now = () => performance.now() }: { onPlay?: () => Promise<unknown>; now?: () => number } = {},
): Replay {
  const [state, setState] = useState<ReplayState>('idle')
  const [speed, setSpeedState] = useState(4)
  const [t, setT] = useState<number | undefined>(undefined)
  const clock = useRef({ base: 0, at: 0, speed: 4 })
  const frame = useRef<number | null>(null)

  const cancel = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }

  const tick = useCallback(() => {
    const c = clock.current
    const value = c.base + (now() - c.at) * c.speed
    if (value >= durationMs) {
      cancel()
      setT(undefined)
      setState('idle')
      return
    }
    setT(value)
    frame.current = requestAnimationFrame(tick)
  }, [durationMs, now])

  const run = useCallback(
    (from: number) => {
      clock.current = { base: from, at: now(), speed: clock.current.speed }
      setT(from)
      setState('playing')
      cancel()
      frame.current = requestAnimationFrame(tick)
    },
    [now, tick],
  )

  const play = useCallback(() => {
    const from = state === 'paused' && t !== undefined ? t : 0
    if (state === 'idle' && onPlay) {
      setState('playing')
      setT(0)
      void onPlay().then(
        () => run(0),
        () => setState('idle'),
      )
      return
    }
    run(from)
  }, [state, t, onPlay, run])

  const pause = useCallback(() => {
    cancel()
    setState('paused')
  }, [])

  const stop = useCallback(() => {
    cancel()
    setT(undefined)
    setState('idle')
  }, [])

  const toggle = useCallback(() => (state === 'playing' ? pause() : play()), [state, pause, play])

  const setSpeed = useCallback(
    (next: number) => {
      const c = clock.current
      if (state === 'playing')
        clock.current = { base: c.base + (now() - c.at) * c.speed, at: now(), speed: next }
      else clock.current = { ...c, speed: next }
      setSpeedState(next)
    },
    [state, now],
  )

  useEffect(() => cancel, [])

  return { state, speed, t, play, pause, stop, toggle, setSpeed }
}

/** "0:38" for the replay clock. */
export function mmss(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
