// What the app shows about live mode. No engine import here: the replay function stays small.

export const HOW_TO_RUN_LIVE =
  'Live runs need your own key and run on your machine: put ANTHROPIC_API_KEY in .env.local, then run ' +
  '"pnpm crew serve --live" and open http://127.0.0.1:8787. The public demo replays example runs.'

export interface LiveAvailability {
  available: boolean
  /** What to do when live runs aren't available. */
  how?: string
}

export function liveAvailability(env: Record<string, string | undefined>): LiveAvailability {
  return env.ANTHROPIC_API_KEY?.trim() ? { available: true } : { available: false, how: HOW_TO_RUN_LIVE }
}
