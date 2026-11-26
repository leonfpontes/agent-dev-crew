# 0005 · One Fetch API for the trace, replay in memory on Vercel, live only on this machine

- **Date:** 2026-11-26 · **Status:** accepted

## Context

The app needs the trace of the four screens. The public demo must cost nothing and need no key; a
person with a key must be able to run the crew and answer the gate from the app. The demo runs on a
serverless function, where the file system is read-only and a SQLite write-ahead log can't be created.

## Decision

- **`@crew/api`** is one Fetch handler (`createApi`) over the trace queries, so the same code runs on
  Node's http module locally and as a Vercel function. JSON in and out; errors say what to do next.
- **Replay** only reads (any write answers 405). The local server and the Vercel function seed the
  replay data into an in-memory database when they start (milliseconds), from the real scoreboard
  (`evals/results/latest.json`) when there is one: nothing to ship, nothing to write, and the same data
  in both places. (Updated 2026-11-26: the local server used to open `.crew/replay.sqlite`, which could
  be stale and show old example numbers labelled as measured.)
  The function imports `@crew/api/replay`, which never loads the engine, the model client or the sandbox.
- **Live** runs only locally (`pnpm crew serve --live`, 127.0.0.1, local origins only) with the person's
  own `ANTHROPIC_API_KEY`: it starts one run at a time and answers the gate through `WebGate`. Without a
  key, the API says how to set one up and stays read-only.
- The local server also serves the built app, so the demo is one command and one port (`pnpm demo`).
- Playback at 1× and 4× happens in the app, from the timeline's `offset_ms`; the API serves time, not frames.

## Consequences

- The demo always shows the seed's example data, marked `exampleData: true`.
- Live and the evaluation write to `.crew/trace.sqlite`; the replay file is never written by the API.
