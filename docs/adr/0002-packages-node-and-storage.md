# 0002 · Private packages, Node 24 and the built-in SQLite

- **Date:** 2026-11-26 · **Status:** accepted

## Context

The crew is shown as a working system people clone and run (`pnpm install`, `pnpm demo`), not as
a library. Its trace (runs, steps, events, costs, lessons) needs a small local database that works
on a laptop, in CI and in the replay demo, with nothing to compile on install.

## Decision

| Folder                     | Package           | Job                                                                      |
| -------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `packages/core`            | `@crew/core`      | Roles, the DAG, the gate and the fix loop; the contracts everyone shares |
| `packages/sandbox`         | `@crew/sandbox`   | Runs agent code with no environment, writing to one folder only          |
| `apps/web`                 | `@crew/web`       | Runs, Run detail (trace and gate), Playbook and Evaluation               |
| `examples/fernhill-orders` | `fernhill-orders` | The example repository the crew changes                                  |
| `evals`                    | `@crew/evals`     | Requests with hidden tests, the three variants and the scoreboard        |

- **All packages are private.** Nothing goes to npm, so the "install the `.tgz` in an empty
  project" check has nothing to test; if a package is ever published, it applies from then on.
- **Node 24 or newer** (first written as 22.13, raised on 26/11/2026). The trace uses Node's
  built-in `node:sqlite`, and on Node 22 two things break: Vite doesn't list `node:sqlite` among
  the built-ins, so the app's tests can't load the replay API, and the sandboxed test runner fails
  under 22's permission model. The first CI run on Linux, on Node 22, showed both; every run before
  was on 24. Node 24 is the active LTS, and Vercel runs 26.
- **SQLite through `node:sqlite`:** one file under `.crew/`, migrations in SQL, no native module.
- TypeScript 6.0 (typescript-eslint 8 supports up to 6.0); libraries build with `tsc`, the app with Vite.

## Alternatives discarded

- `better-sqlite3`: fast and stable, but a native build on every install and in the Vercel function.
- JSON files for the trace: no queries, no indexes, and concurrent steps would fight over one file.
- Publishing the engine as a package: nobody needs it yet, and it would add a release process.

## Consequences

- Node 24 may print an "experimental" warning the first time `node:sqlite` loads; it is stable
  enough for a local trace and the API is small.
- The replay demo ships recorded runs; how it reads them on Vercel is decided with the replay API.
