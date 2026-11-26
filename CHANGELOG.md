# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- Repository skeleton: README, agent rules, CI, secret scanning, Dependabot and ADR 0001.
- pnpm monorepo: `@crew/core` (roles, DAG), `@crew/sandbox`, `@crew/web` on Atlas UI, `fernhill-orders` and `@crew/evals`, with coverage floors and end-to-end tests on `E2E_PORT` (ADR 0002).
- `fernhill-orders`: a small orders API (carts, orders, receipts, daily total) with 20 tests and no dependencies.
- 10 evaluation requests with 51 hidden acceptance tests, reference solutions and a validator that proves each one is a fair test.
- `@crew/trace`: the SQLite trace (runs, steps, events, costs, lessons, playbook versions) with reversible migrations, the screen queries and a replay seed.
- `@crew/engine`: the crew run (plan, human gate, code, review, test, up to 2 fix loops, retro hook) with a budget check before every model call, a fallback model, guarded tools, the trace of every step and the hidden-test scoring (ADR 0003).
- The sandbox blocks the network and runs the example's tests inside it, with test workers that inherit the rules.
