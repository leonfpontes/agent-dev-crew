# AGENTS.md

Rules for any coding agent (Claude Code, Codex, Cursor, Copilot…) in this repository.
The repository is public from its first commit: everything in it is in English, and no client,
personal or internal team data goes in. Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Commands

```bash
pnpm install               # install (Node 22, see .nvmrc)
pnpm dev                   # web app on 127.0.0.1:5173
pnpm check                 # types + lint + format + tests + build: required before you finish
pnpm qa                    # pnpm check, then the end-to-end tests
pnpm vitest run <file>     # one test
pnpm --filter <package> build   # one package (names in docs/ARCHITECTURE.md)
E2E_PORT=4300 pnpm e2e     # end-to-end tests on your own port
pnpm eval                  # the evaluation on Claude (needs ANTHROPIC_API_KEY, $5 cap); --report rebuilds results/ for free
pnpm demo                  # the replay demo: build, serve app + API on 127.0.0.1:8787 (--port to change)
pnpm crew serve --live     # live mode with your ANTHROPIC_API_KEY (.env.local); pnpm crew run "<request>" in the terminal
```

## What the code doesn't tell you

- Several people and agents run servers on the same machine. The end-to-end tests start their
  own server on `E2E_PORT` (default 4173) with `--strictPort` and never reuse one that is already
  running: a busy port fails fast instead of testing someone else's build.
- Code written by the agents only runs through `packages/sandbox`: no environment variables, no
  network, writes only to a throwaway copy of the example repository. Tests run with Vitest's `forks`
  pool: worker threads would start without the permission model.

## Rules

- No internal names, clients or private projects anywhere in the repository
  (test: `tests/repo.test.ts`, no exceptions).
- Tests read only files that are in the repository; approved values from outside are frozen in
  a fixture (test: `tests/repo.test.ts`).
- Never read, print or commit secrets (`.env*`, tokens). A new variable goes in `.env.example` with no value.
- Decisions that are hard to undo get an ADR in `docs/adr/`.

## Done means

1. `pnpm qa` passes.
2. No console errors in the browser at 1440 and 375 px (when there is a UI).
3. `docs/` updated if a route, contract, command or variable changed.
4. One line in `CHANGELOG.md`.

## Traps already paid for

| Symptom                                                                                                      | Cause                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test -- --coverage` runs without coverage                                                              | pnpm passes the `--` on to Vitest; use `pnpm test --coverage`                                                                                                                                                         |
| `Cannot find module '@crew/…'` on a clean clone                                                              | `dist/` doesn't exist before the build; workspace imports resolve to `src/` through the `crew-source` export condition (TypeScript) and the aliases in `vitest.config.ts`. A new package the others import needs both |
| A sandboxed script fails with `ERR_ACCESS_DENIED` on an allowed folder                                       | Node checks permissions on real paths; on macOS `/var/folders` is `/private/var/folders`. Give the agents real paths (`realPath` from `@crew/sandbox`)                                                                |
| Sandboxed test code can read the repository or reach the network                                             | Vitest's `threads` pool: Node starts worker threads without the permission model. Use `forks`                                                                                                                         |
| A blocked function still works through `import { connect } from 'node:net'`                                  | Named imports keep the original until `syncBuiltinESMExports()` runs after the patch                                                                                                                                  |
| Vitest in the sandbox fails with `ERR_ACCESS_DENIED` on `…/pnpm-workspace.yaml` or `node_modules/.vite-temp` | Vite looks above the root for a workspace and bundles the config into `node_modules`; the copy gets its own `pnpm-workspace.yaml` and the config loads with `--configLoader native`                                   |
| The retro sees a passed or failed run as `running`, with no tests                                            | `runCrew` writes the run row after the retro step; read the outcome from the retro context (`status`, `failureReason`, `tests`), not from `runs`                                                                      |

## Publishing

Nothing is published (GitHub, Vercel) before the owner's final approval.
