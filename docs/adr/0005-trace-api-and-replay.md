# 0005 · One Fetch API for the trace, replay in memory on Vercel, live only on this machine

- **Date:** 2026-11-26 · **Status:** accepted

## Context

The app needs the trace of the four screens. The public demo must cost nothing and need no key; a
person with a key must be able to run the crew and answer the gate from the app. The demo runs on a
serverless function, where the file system is read-only and a SQLite write-ahead log can't be created.

## Decision

- **`@crew/api`** is one Fetch handler (`createApi`) over the trace queries, so the same code runs on
  Node's http module locally and as a Vercel function. JSON in and out; errors say what to do next.
- **Replay** only reads (any write answers 405). Locally it opens `.crew/replay.sqlite` read-only;
  on Vercel, where there is no such file, the function seeds the same example data into an
  in-memory database when it starts (milliseconds), so there is nothing to ship and nothing to write.
  The function imports `@crew/api/replay`, which never loads the engine, the model client or the sandbox.
- **Live** runs only locally (`pnpm crew serve --live`, 127.0.0.1, local origins only) with the person's
  own `ANTHROPIC_API_KEY`: it starts one run at a time and answers the gate through `WebGate`. Without a
  key, the API says how to set one up and stays read-only.
- The local server also serves the built app, so the demo is one command and one port (`pnpm demo`).
- Playback at 1× and 4× happens in the app, from the timeline's `offset_ms`; the API serves time, not frames.

## Consequences

- The demo always shows the seed's example data, marked `exampleData: true`.
- Live and the evaluation write to `.crew/trace.sqlite`; the replay file is never written by the API.
