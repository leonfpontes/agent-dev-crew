# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## [Unreleased]

### Fixed

- An answer cut at `max_tokens` before any tool call no longer ends the step as finished: the engine drops it, asks the agent to act and goes on, within `maxTurns`.

### Added

- Repository skeleton: README, agent rules, CI, secret scanning, Dependabot and ADR 0001.
- pnpm monorepo: `@crew/core` (roles, DAG), `@crew/sandbox`, `@crew/web` on Atlas UI, `fernhill-orders` and `@crew/evals`, with coverage floors and end-to-end tests on `E2E_PORT` (ADR 0002).
- `fernhill-orders`: a small orders API (carts, orders, receipts, daily total) with 20 tests and no dependencies.
- 10 evaluation requests with 51 hidden acceptance tests, reference solutions and a validator that proves each one is a fair test.
- A hard set of 8 evaluation requests (`evals/requests-hard/`, 132 hidden tests) next to the easy baseline: each asks for two features that interact across routes and modules, on the same example, and each is proved fair by the validator.
- `@crew/trace`: the SQLite trace (runs, steps, events, costs, lessons, playbook versions) with reversible migrations, the screen queries and a replay seed.
- `@crew/engine`: the crew run (plan, human gate, code, review, test, up to 2 fix loops, retro hook) with a budget check before every model call, a fallback model, guarded tools, the trace of every step and the hidden-test scoring (ADR 0003).
- The crew's model layer (ADR 0004): role prompts in files, Claude Haiku 5.5 for every role with Haiku 4.5 as the fallback, the Messages API provider with retries and caching, the real price table, and the automatic retro that records lessons and proposes playbook versions, which count only once approved.
- `pnpm eval` (ADR 0006): the ablation (single agent, crew, crew with the learned playbook; 10 requests × 3 rounds) and the learning curve on Claude Haiku 5.5 under a $5 cap, with the scoreboard in `evals/results/` and the replay seed reading it. Models outside a cost allowlist are refused.
- The hard request set in the evaluation (`pnpm eval --set hard`), with `--probe` to measure how hard a set is, `--resume` to finish a stopped evaluation, and scoreboards that say their set and carry notes (`evals/results/hard.json`).
- The sandbox blocks the network and runs the example's tests inside it, with test workers that inherit the rules.
- `@crew/api`: the trace API for the four screens, the replay demo (no key, no cost, in memory on Vercel) and the local live mode with the human gate in the app; `pnpm demo`, `pnpm crew serve` and `pnpm crew run` (ADR 0005).
- `@crew/web`: the four screens on Atlas UI 0.2.0 from npm: Runs (filters, search, keyboard), Run detail (pipeline, Gantt with a 1× / 4× replay, step panel with prompt, tools and raw records, the human gate with A / C / R, diff and tests, retro), Playbook (versions, proposal, history) and Evaluation (headline, learning curve, cost × quality, all metrics, per-request matrix), each with its loading, empty and error states, light and dark, 375 to 1440 px.
- How it works at `/` (the runs moved to `/runs`), a 404 page, and the share images (social preview, OG image, README cover) drawn from the scoreboard and the replay run by `pnpm share-images`, with a test that fails when they fall behind.
- The README: cover, GIF and 1-minute captioned video recorded from `/demo` (`pnpm record-demo`), quickstart, the pipeline diagram and the scoreboard block generated from `evals/results/*.json` (`pnpm readme`), each with a test that fails when it falls behind its source.
- Live playbook decisions from the app (`POST /api/playbook/:version`: approve, reject, or approve an edited rule), and the scoreboard's model, cost limit and finish time on `/api/evaluation`; the local replay seeds in memory from the scoreboard, like the Vercel function.
