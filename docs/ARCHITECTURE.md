# Architecture

```mermaid
flowchart LR
  cli[CLI / web app] --> core[packages/core: DAG engine]
  core --> roles[PO · Engineer · Reviewer · QA]
  roles -- model calls --> llm[(Claude)]
  roles -- code and tests --> sandbox[packages/sandbox]
  sandbox --> repo[examples/fernhill-orders copy]
  core -- steps, costs, lessons --> trace[(SQLite trace)]
  trace --> web[apps/web]
  evals[evals] --> core
```

| Folder                     | What it has                                                                       |
| -------------------------- | --------------------------------------------------------------------------------- |
| `packages/core`            | `@crew/core`: roles, the DAG of steps, the gate and the fix loop                  |
| `packages/sandbox`         | `@crew/sandbox`: runs agent code with no environment, writing to one folder only  |
| `packages/trace`           | `@crew/trace`: the SQLite trace (schema, migrations, screen queries, replay seed) |
| `apps/web`                 | `@crew/web`: the app, built with `@leonfpontes/atlas-ui` from npm                 |
| `examples/fernhill-orders` | `fernhill-orders`: the example repository the crew changes                        |
| `evals`                    | `@crew/evals`: requests with hidden tests, variants and the scoreboard            |
| `e2e/`                     | Playwright tests (`*.e2e.ts`) against the built app on `E2E_PORT`                 |
| `docs/`                    | This file, the docs index and the ADRs                                            |
| `tests/`                   | Repository-wide guards                                                            |

Packages, Node version and storage: [ADR 0002](adr/0002-packages-node-and-storage.md).

## Contracts

Types, routes and formats the parts exchange. If one changes here, the doc changes in the same PR.

| Contract                                                                                                                                                                                                | Defined in                                       | Used by                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------- |
| Roles `po`, `engineer`, `reviewer`, `qa`, in pipeline order                                                                                                                                             | `packages/core/src/contracts.ts` (`ROLES`)       | engine, trace, app                      |
| Step statuses `queued`, `running`, `passed`, `failed`, `waiting`, `approved`, `rejected`, `changes-requested`, `fix-loop`, `skipped`                                                                    | `STEP_STATUSES`                                  | trace, app (one icon shape each)        |
| Gate decisions `approve`, `request-changes`, `reject`                                                                                                                                                   | `GATE_DECISIONS`                                 | engine, CLI, app                        |
| Variants `single-agent`, `crew`, `crew-playbook`                                                                                                                                                        | `VARIANTS`                                       | evaluation, scoreboard, app             |
| At most 2 fix loops (QA → Engineer)                                                                                                                                                                     | `MAX_FIX_LOOPS`                                  | engine                                  |
| Pipeline as a DAG of `{ id, after[] }`, walked in dependency order; a cycle is a definition error                                                                                                       | `topologicalOrder` in `packages/core/src/dag.ts` | engine                                  |
| Sandbox policy `{ read[], write[], childProcesses?, addons? }` (absolute folders, resolved to real paths), no worker threads, environment with only the network blocker; `runVitest(repo, { include })` | `packages/sandbox/src/permissions.ts`            | engine (Engineer and QA tools)          |
| Feature request `{ id, title, request, hiddenTests[] }`                                                                                                                                                 | `evals/src/contracts.ts` (`parseRequests`)       | data story (writes), evaluation (reads) |

### Trace database

One SQLite file under `.crew/` (`openTrace(file)`, then `migrate(db)`), through `node:sqlite`. Each
migration in `packages/trace/src/migrations.ts` has an `up` and a `down`; `migrate(db, n)` moves to
any version and back, one transaction per migration. Money is in micros (USD millionths), time in
milliseconds, `offset_ms` counted from the start of the run.

| Table               | One row per                                                       | Written by                       |
| ------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `runs`              | run (`id` is the `#142` people see), with status, diff, tests     | engine                           |
| `steps`             | DAG step; a `fix-loop` step groups its `fix` and `test` children  | engine                           |
| `events`            | thing that happened in a run, in `seq` order, JSON `payload`      | engine                           |
| `costs`             | model call: tokens (input, cache read, cache write, output), cost | engine                           |
| `lessons`           | lesson of a run's retro: error, cause, rule, playbook section     | retro                            |
| `playbook_versions` | playbook.md version: content, diff from the one before, status    | retro (proposed), gate (decided) |

| Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Defined in                        | Used by                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------- |
| Run statuses `running`, `waiting`, `passed`, `failed`, `rejected`; failure reasons `fix-loops-exhausted`, `over-budget`, `error`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `packages/trace/src/contracts.ts` | engine, API, app        |
| Run origins `live`, `eval`, `example`; evaluation suites `main` (ablation) and `learning-curve`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `contracts.ts`                    | engine, evaluation, app |
| Step kinds `plan`, `gate`, `code`, `review`, `test`, `fix-loop`, `fix`, `retro`, `solo` (single agent); gate deciders `person`, `policy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `contracts.ts`                    | engine, app             |
| Event kinds (`run.*`, `step.*`, `model.request`, `model.response`, `tool.call`, `tool.result`, `gate.*`, `loop.started`, `budget.exceeded`, `lesson.proposed`, `log`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `contracts.ts`                    | engine, Run detail      |
| The reads of the four screens (`listRuns`, `runsSummary`, `getRun`, `stepEvents`, `playbookHistory`, `evaluationSummary`, `learningCurve`, `requestMatrix`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `packages/trace/src/queries.ts`   | API (B3), app           |
| Replay seed: `seed(db, now, { evaluation? })`; `pnpm --filter @crew/trace seed` writes `.crew/replay.sqlite`. The example runs are example data; the Evaluation data and the playbook history are the real scoreboard (`evals/results/latest.json`) when it exists, the example numbers otherwise (`--example`). Each request set has its own database, because each has its own playbook history (both start at v1): a scoreboard with `set: 'hard'` seeds only its evaluation (runs, playbook versions, lessons; no example runs, no #142 proposal), with titles and texts from `SEED_REQUESTS_HARD`; `pnpm --filter @crew/trace seed -- --set hard` writes `.crew/replay-hard.sqlite` from `evals/results/hard.json`. The screen queries stay the same on either database | `packages/trace/src/seed.ts`      | replay API, e2e tests   |

Event payloads: `model.request` `{ prompt, playbook: { version, section }, system, rules[], user, raw }`;
`model.response` `{ text, stopReason, raw }` or, for the PO, `{ plan: { steps[], acceptance[], files[], estimateUsd } }`;
`tool.call` `{ tool, input }`; `tool.result` `{ tool, ok, output }`; `gate.decided` `{ decision, by, comment }`;
`loop.started` `{ loop, of, reason }`; `budget.exceeded` `{ budgetUsd, spentUsd }`. `raw` is the Messages API
record, trimmed only where marked `…`.

### API (`@crew/api`)

One Fetch handler (`createApi`) serves the app locally (`pnpm crew serve`, 127.0.0.1:8787, with the built
app on the same port) and on Vercel (`api/handler.ts`, replay only) ([ADR 0005](adr/0005-trace-api-and-replay.md)).
Rows keep the trace's column names (`snake_case`); money is in micros, time in ms. Errors are
`{ "error": "<what went wrong and what to do>" }`, sometimes with `how`.

| Method and route                                 | Answer                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/meta`                                  | `{ mode: "replay" \| "live", exampleData, replaySpeeds: [1, 4], live: { available, how? } }`                                                                                                                                                                                                                                                                    |
| `GET /api/runs?status=&variant=&q=&limit=`       | `{ runs: RunListRow[], summary: RunsSummary, waiting: number[] }`: newest first, no evaluation runs; `waiting` = runs whose gate waits for a person (live). 400 on an unknown status or variant, or a `limit` outside 1–500                                                                                                                                     |
| `GET /api/runs/:id`                              | `{ run, steps: StepRow[], costByPart, lessons, gate: { waiting, plan, decidable } }`. In replay the gate step shows the recorded `decision`, `decided_by` and `comment`; `decidable` is true only live, while the run waits. 404 for an unknown run                                                                                                             |
| `GET /api/runs/:id/timeline`                     | `{ runId, durationMs, replaySpeeds, events: { seq, step_id, offset_ms, kind, payload }[] }` in `seq` order. Payloads kept for `run.*`, `step.*`, `gate.*`, `loop.started`, `budget.exceeded`, `lesson.proposed`; `null` for model and tool events (fetch them per step). Play a run at speed `s` by showing each event at `offset_ms / s`                       |
| `GET /api/runs/:id/steps/:stepId/events`         | `{ events: EventRow[] }` with parsed payloads: prompt, response, tool calls and results, raw API records. 404 when the step isn't in the run                                                                                                                                                                                                                    |
| `GET /api/playbook`                              | `{ versions }`: every playbook version with its content, diff, status and source                                                                                                                                                                                                                                                                                |
| `GET /api/evaluation`                            | `{ exampleData, model?, limitUsd?, finishedAt?, main: VariantStats[], learningCurve: { points: CurvePoint[], variants: VariantStats[] }, matrix: MatrixRow[] }`. `model`, `limitUsd` and `finishedAt` come with the real scoreboard (`evals/results/latest.json`: `model`, `budgetUsd.total`, `runAt`)                                                          |
| `POST /api/runs` (live, with a key)              | body `{ request (20–4000 chars), title?, variant? }` → 202 `{ runId }` as soon as the run exists. 409 while another run is in progress, or without a key (with `how`)                                                                                                                                                                                           |
| `POST /api/runs/:id/gate` (live)                 | body `{ decision: "approve" \| "request-changes" \| "reject", comment? }`; request changes and reject need a comment → `{ runId, decision }`. 409 when the run isn't waiting                                                                                                                                                                                    |
| `POST /api/playbook/:version` (live, with a key) | body `{ decision: "approve" \| "reject", rule? }` → `{ version, status }`. `rule` approves an edited rule (only with approve, and only for a proposal of one rule): the version's content, diff and lesson keep the approved text. Proposals are decided in order; 409 when the version was already decided or an earlier one waits, 404 for an unknown version |

Replay answers every write with 405 and `how`. Replay data is seeded in memory from the scoreboard when the server starts, locally and on Vercel, so a stale `.crew/replay.sqlite` never shows old numbers. Live accepts writes only from local origins (403
otherwise). Bodies are limited to 32 KB. The replay never calls a model or the network.

Commands: `pnpm demo` (build, then serve the app and the replay API on http://127.0.0.1:8787; `pnpm demo --port 8891` for another port); `pnpm crew serve
[--live] [--port]`; `pnpm crew run "<request>" [--variant] [--policy]` (a live run in the terminal, the gate
as a y / c / n prompt).

### App (`@crew/web`)

The four screens read only the API above; every number on them comes from it. Components are
`@leonfpontes/atlas-ui` from npm, with one color of its own, `--crew`, for the human gate.

| Route           | Screen                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `/`             | How it works: the public page (claim, a run summary, pipeline, trace, playbook, evaluation, quickstart) |
| `/runs`         | Runs: the run waiting at the gate first, status tabs, variant filter, search (`/`), arrow keys          |
| `/runs/:id`     | Run detail; `?step=<id>` selects a step, `?section=summary\|trace\|diff\|retro` picks the phone tab     |
| `/playbook`     | Playbook; `#v<n>` opens a version in the history, `#engineer` (any role) scrolls to its rules           |
| `/evaluation`   | Evaluation                                                                                              |
| `/share?record` | The share images' artboards; without `?record` (and for any unknown path), the 404 page                 |
| `/demo?record`  | The stage the README GIF (`&mode=gif`) and the video are recorded from, frame by frame                  |

Share images: `pnpm share-images` builds, serves the app like `pnpm demo` and screenshots `/share`
into `apps/web/public/og.png` (the `og:image`), `docs/social-preview.png` (the repository's social
preview, set by hand in the GitHub settings) and `docs/cover-light.png` / `docs/cover-dark.png` (the
README cover), with the numbers they show in `docs/share.values.json`. A test fails when those
numbers differ from the scoreboard or the replay run. `og:image` needs an absolute URL: the build
reads `SITE_URL`, or Vercel's production domain.

Demo media: `pnpm record-demo` builds, serves the app and records `/demo` frame by frame into
`docs/media/crew-demo.gif` (20 s) and `crew-demo.mp4` (60 s, captions in the picture and in
`crew-demo.en.vtt`), with the captions it drew in `crew-demo.numbers.json`; a test compares them with
the scoreboard and the replay run. The README's scoreboard block comes from `evals/results/*.json`
(`pnpm readme`), with a test that fails when it falls behind.

`?theme=dark` or `?theme=light` (also `?dark`) sets the theme for links and captures; otherwise the
saved choice, then the system. `pnpm dev` serves the app on 127.0.0.1:5173 and sends `/api` to
`CREW_API` (default `http://127.0.0.1:8787`, the API of `pnpm crew serve`). The app's tests call the
real API handler in process, over the replay seed (`apps/web/src/test/api.tsx`).

Decisions in the app write through the API: the gate with `POST /api/runs/:id/gate`; a playbook
proposal with `POST /api/playbook/:version` and `{ decision: "approve" | "reject", rule? }` (replay answers 405
to both, and the app shows the API's `how`).

### Hidden tests

Two sets of requests run on the same, unchanged `fernhill-orders`: the **easy** set
(`evals/requests/`, 10 one-rule requests, 51 hidden tests, the baseline of the first evaluation) and the
**hard** set (`evals/requests-hard/`, 8 requests of two interacting features each, 132 hidden tests). Each set has a `requests.json`, and `<set>/<id>/` holds the hidden test files and a reference
`solution/` (files that replace or add to `src/` of the example). The engine never puts `evals/` in a
sandbox read list. After the crew finishes, the harness copies the hidden tests into the run's copy of
`fernhill-orders` at `hidden/`; they import the app from `../src/index.js` and use only its HTTP API
(`createApp({ db, now }).fetch(request)`). `pnpm --filter @crew/evals validate [-- --set easy|hard]`
proves each request is a fair test: its hidden tests fail on the example as it ships and pass on the
solution, which keeps the 20 visible tests green and type-checks. A test also checks that every error
message a hard hidden test expects is written in the request (or is one the example already gives), so
no request hides a requirement.

| Contract                                                                                                                                                                                                                         | Defined in              | Used by                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------- |
| `REQUEST_SETS` (`easy`, `hard`), `REQUEST_SET_RULES` (folder, 3 to 7 hidden tests for easy and 10 to 20 for hard, whether a solution may add files), `requestSetDir(evalsDir, set)`, `loadRequestSet(evalsDir, exampleDir, set)` | `evals/src/requests.ts` | `pnpm eval --set`, `pnpm validate --set` |

### Evaluation and scoreboard

`pnpm eval` ([ADR 0006](adr/0006-evaluation-harness-and-scoreboard.md), method in [evals/README.md](../evals/README.md))
runs the learning epochs, the ablation and the curve's other rounds under hard budgets, into a trace at
`.crew/eval.sqlite`, then writes the scoreboard.

| Contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Defined in             | Used by                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------- |
| `runEvaluation(options) → { spentMicros, spentBySuite, runs, skipped, stoppedEarly, epochVersions, learnedVersion, errors }`; budgets by reservation (`Budget`), curve rounds numbered from `CURVE_ROUND_BASE + 1`                                                                                                                                                                                                                                                                                       | `evals/src/harness.ts` | `pnpm eval`                                   |
| Scoreboards `evals/results/latest.json` (easy set) and `hard.json` (hard set) (`ResultsSchema`, `schema: 1`): `set`, `notes[]`, `main[]` per variant (pass rate, hidden-test rate, cost, tokens, seconds, fix loops: mean ± sd over rounds; gate interventions; cost), `curve[]` (version, rounds, pass rate, rules), `matrix[]`, `playbook` (learned version, versions, lessons), `runs[]` (one row per run), `spentUsd`, `budgetUsd`, `stoppedEarly`; each `.md` of the same name has the same numbers | `evals/src/results.ts` | replay seed, README, share images, video, app |

### Engine (`@crew/engine`)

`runCrew(options)` takes one request through the crew and writes it to the trace ([ADR 0003](adr/0003-engine-and-sandbox.md)):

- **crew / crew-playbook:** `plan` (PO, must call `submit_plan`) → `gate` (run status `waiting` until a
  `GateDecider` answers; request changes sends the comment back to the PO, at most 2 revisions) →
  `code` (Engineer) → `review` (Reviewer, `submit_review`) → `test` (QA) → up to 2 `fix-loop` steps,
  each a parent of `fix` (Engineer, with the failures and the review comments) and `test` (QA) → `retro`
  (optional hook, never fails the run).
- **single-agent:** `solo` (one agent with every tool) → `test`. Tests still failing when it stops count
  as `fix-loops-exhausted`: it has no loop of its own.
- **The tests that decide a step are the engine's own sandboxed run** at the end of the QA (or solo)
  step, recorded as a `tool.result` with `by: "engine"`; what a model says about tests never counts.
- **Budget:** before every model call the engine prices the worst case (the request's estimated input
  plus `maxTokens` of output); if it doesn't fit, the step fails with a `budget.exceeded` event and the
  run fails `over-budget` without making the call.
- **Cut answers:** an answer that stops at `max_tokens` without a tool call has not finished. The engine
  drops it (a cut thinking block may not go back to the API valid), adds `CUT_ANSWER_NOTE` to the last
  user message, logs a warning and calls again; the turn counts toward `maxTurns` and is paid for.
- **Fallback:** when the provider throws, the step retries once with the role's fallback model
  (`fallback_used = 1`, `attempt = 2`); a second failure fails the run with `error`.
- **Hidden tests:** `scoreHiddenTests(trace, runId, repoDir, files)` copies them to `<copy>/hidden/`
  after the run, runs only them and records `hidden_passed` / `hidden_total`.

| Contract (for the AI story)                                                                                                                                                                                                                                | Defined in                                                   | Notes                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `ModelProvider.complete(request) → ModelResponse`: `{ agent, model, system, messages, tools, maxTokens }` in; `{ model, content[] (text, tool_use), stopReason, usage, raw }` out. Throw when the call fails after the provider's own retries              | `packages/engine/src/provider.ts`                            | Messages API shapes; `usage` = input (not cached), cache read, cache write, output                      |
| `PriceFn(model, usage) → micros`                                                                                                                                                                                                                           | `provider.ts`                                                | the real price table; `flatPrice` for tests                                                             |
| `RoleSpec`: `{ agent, promptFile, playbookSection?, models: { primary, fallback? }, maxTurns, maxTokens, system(input), user(input), rules?(input) }`, one per `po`, `engineer`, `reviewer`, `qa`, `solo`                                                  | `packages/engine/src/roles.ts`                               | `RoleInput` carries the request, plan, gate comment, diff, failures, review comments, loop and playbook |
| Tools per agent: PO `list_files`, `read_file`, `submit_plan`; Engineer and solo `list_files`, `read_file`, `write_file` (src/, tests/), `run_tests`; Reviewer `list_files`, `read_file`, `submit_review`; QA the Engineer's, writing tests/ only           | `packages/engine/src/tools.ts` (`AGENT_TOOLS`, `TOOL_SPECS`) | paths stay in src/ and tests/: no absolute paths, no `..`, no hidden files                              |
| `GateDecider.decide({ runId, title, plan, revision, budgetLeftMicros }) → { decision, by, comment? }`; `approveByPolicy` for the evaluation                                                                                                                | `packages/engine/src/gate.ts`                                | request changes and reject need a comment                                                               |
| Retro hook `(context) → { lessons[] }`; the context has the run's outcome (`status`, `failureReason`, `tests`, `failures`, `diff`), the `variant`, the retro `stepId` and `complete(request, promptFile)`, a model call through the run's budget and trace | `engine.ts`                                                  | the run row is written after the retro: read the outcome from the context                               |
| `ScriptedProvider` (answers from a script per agent; never calls an API)                                                                                                                                                                                   | `provider.ts`                                                | for tests and recorded demos                                                                            |

The AI story ([ADR 0004](adr/0004-models-fallback-and-retro.md)) plugs into those contracts:

| Contract                                                                                                                                                                                                                                                                                                                                                                    | Defined in                         | Notes                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| `createAnthropicProvider({ apiKey })`: the Messages API with `fetch`, prompt caching, 3 retries on 408, 409, 429, 5xx and 529 (with `retry-after`), then it throws so the engine uses the fallback; models outside the cost allowlist (`allowedModels`, default the priced light models) refused                                                                            | `packages/engine/src/anthropic.ts` | the key comes from `ANTHROPIC_API_KEY`; nothing else reads it                                     |
| `anthropicPrice`: the real `PriceFn` (`PRICES`, with Haiku 5.5's tier for prompts over 100k tokens); an unknown model throws                                                                                                                                                                                                                                                | `pricing.ts`                       | micros = tokens × USD per million                                                                 |
| `createRoleSpecs()`: the five `RoleSpec`s, prompts from `packages/engine/prompts/<agent>.md`, `MODELS` (primary `claude-haiku-5-5`, fallback `claude-haiku-4-5-20251001`, the same for the single agent), `LIMITS` (turns and tokens per role); `promptVersion()` hashes the prompt files                                                                                   | `agents.ts`                        | in `crew-playbook` each role gets its playbook section in the system prompt and as `rules`        |
| Playbook: `ensurePlaybook(db)` writes v1 from `packages/engine/playbook.md`; `currentPlaybook(db)` is the newest approved version; `proposePlaybookVersion(db, runId, lessons)` records the lessons and proposes the next version (duplicates kept as `duplicate`, no version if all are); `decidePlaybookVersion(db, version, decision, by)` approves or rejects, in order | `playbook.ts`                      | a proposal builds on the newest version not rejected; a rejection rebuilds the proposals after it |
| `createRetro({ trace })`: the retro hook; one call to `submit_lessons` (0 to 3 lessons: error, cause, rule, section, step), one reminder if the answer is not valid; skips clean runs and the single agent                                                                                                                                                                  | `retro.ts`                         | its `lesson.proposed` events carry `status`, `playbookVersion`, `duplicateOf` and `stepId`        |
