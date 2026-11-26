# 0006 · The evaluation harness, its budgets, and one scoreboard file for every reader

- **Date:** 2026-11-26 · **Status:** accepted

## Context

The evaluation answers two questions with real model calls: does a crew beat one agent with the same
model (the ablation), and does the playbook the crew learns help (the learning curve)? It runs 10
requests × 3 variants × 3 rounds plus the curve, under a hard $5 cap with the curve under $3. Its
numbers reach the README, the app's Evaluation and Playbook screens (through the replay seed), the
share images and the video, and any of them falling behind the others would publish two answers.

## Decision

- **`pnpm eval` (`evals/src/harness.ts`)** runs, in order: the learning epochs (crew with the current
  playbook and the retro on, then the logged policy approves the proposals; an epoch with nothing new
  ends it, at most 3), the ablation (no retro; `crew-playbook` runs the learned version), then the
  first version's other rounds. The first and last curve points get 3 rounds, the middle ones 1.
- **Budgets hold by reservation:** each run has its own $0.25 budget, which the engine never passes;
  a run starts only after the harness reserves that much against the total cap and its suite's cap.
  So the caps hold however much a run costs, at the price of stopping when less than one run's budget
  is left. A stop is recorded as `stoppedEarly`.
- **Runs in parallel** (6 at once by default): wall-clock time per run is reported as measured under
  that load and compared only between variants.
- **Curve runs number their rounds from 11**, so they never share a `(playbook version, round)` with the
  ablation's rounds 1 to 3: the trace's `learningCurve` query groups by that pair, and the last point is
  the ablation's three rounds of the learned version.
- **One scoreboard file, `evals/results/latest.json`,** built from the evaluation's trace with the same
  queries the screens use (`evaluationSummary`, `learningCurve`, `requestMatrix`), plus every run's
  totals, the learned playbook and its lessons. `latest.md` is the same numbers for people. The trace
  itself (`.crew/eval.sqlite`) stays local; `pnpm eval --report` rebuilds the files from it for free.
- **The replay seed reads the scoreboard** (`seed(db, now, { evaluation })`, and the seed command
  when the file exists): the Evaluation data and the playbook history become the
  measured ones, and the recorded example runs point at the real versions. A test seeds a database
  from the committed file and checks that every screen query returns the scoreboard's numbers.
- **The trace no longer depends on the evaluation** (its seed test that compared the requests moved
  to `@crew/evals`), so the evaluation can depend on the engine and the trace without a cycle.

## Alternatives discarded

- **Checking the worst case of the next model call only** (the engine's own guard): with 6 runs in
  flight, six "last" calls could pass the cap together.
- **Committing the evaluation's SQLite trace:** exact, but tens of megabytes of prompts in a public
  repository, and the app would need a second database.
- **Learning from the hidden tests:** the playbook would learn the answers to the exam.

## Consequences

- Changing the scoreboard means running `pnpm eval` (or `--report`), committing `evals/results/`, and
  telling the owners of every reader: the app and the replay API, the README, the share images, the video.
- If the crew passes every request at the first try, the retro has nothing to learn and the curve is
  one point; the numbers say so instead of drawing a curve.
