# 0003 · The engine package, and a sandbox that holds inside the test runner

- **Date:** 2026-11-26 · **Status:** accepted

## Context

The engine needs the core contracts, the trace and the sandbox, and the trace already depends on
the core, so the engine can't live in `@crew/core`. The code the agents write runs inside the
example's tests, so the sandbox has to hold inside the test runner (Vitest), not only around one
script. Node's permission model has no network switch, and Node starts worker threads without the
permission model (it warns that `--allow-worker` "could invalidate the permission model").

## Decision

- **`@crew/engine`** runs a request: the DAG walk, the agent loop (budget check, fallback model,
  tool calls), the tools, the trace recorder and the hidden-test scoring. `@crew/core` keeps only
  shared names and the DAG; run statuses, step kinds, event kinds and deciders stay in `@crew/trace`,
  which owns the tables they describe.
- **Tests run with Vitest's `forks` pool, never `threads`.** Forked children inherit the permission
  flags; worker threads would not. The runner reads only the copy and the dependency store, writes
  only the copy, and may load native addons (its bundler).
- **The network is blocked by a preload** (`packages/sandbox/preload/block-network.mjs`) passed in
  `NODE_OPTIONS`, so it reaches every Node child: sockets, TLS, UDP, DNS, `fetch` and `WebSocket`
  throw `ERR_CREW_SANDBOX_BLOCKED`, named imports included (`syncBuiltinESMExports`). Inside a test
  worker it also blocks starting processes. The environment has nothing else.
- The copy gets its own `package.json` and `pnpm-workspace.yaml`, so Vite never looks above it (the
  permission model refuses even reading files that don't exist outside the allowed folders), and
  Vite's native config loader, so it never writes a temporary bundle in `node_modules`.

## Alternatives discarded

- Containers or a VM: the real isolation, but Docker would be a requirement for a 3-command demo.
- Running tests in the engine's own process: fast, and gives agent code everything the engine has.
- Node's built-in test runner instead of Vitest: the example's tests are written for Vitest.

## Consequences

- The preload is a defense in depth, not a wall: code that reaches Node internals could still open a
  socket. The environment is empty and only the copy and the dependencies are readable, so there is
  nothing secret to send. Hidden tests never enter a run's read list.
- A forked worker per test file is slower than threads (about 1.5 s per run of the example's 20 tests).
