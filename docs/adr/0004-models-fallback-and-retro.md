# 0004 · Claude Haiku 5.5 for every role, Haiku 4.5 as the fallback, and a retro that only proposes

- **Date:** 2026-11-26 · **Status:** accepted

## Context

The crew makes dozens of model calls per run, and the evaluation runs 10 requests × 3 variants × 3
rounds under a $5 cap, plus the learning curve under its own $3 cap. The ablation (single agent vs
crew vs crew with playbook) only says something about the crew if every variant uses the same model.
The engine retries a step once with the role's fallback model when the provider throws after its own
retries ([ADR 0003](0003-engine-and-sandbox.md)). The playbook must not change behind anyone's back:
a bad lesson would make every later run worse.

Prices checked on 2026-11-26 at <https://platform.claude.com/docs/en/about-claude/pricing> (USD per
million tokens):

| Model                       | Input | Cache write (5 min) | Cache read | Output | Note                                                 |
| --------------------------- | ----- | ------------------- | ---------- | ------ | ---------------------------------------------------- |
| `claude-haiku-5-5`          | 0.10  | 0.125               | 0.01       | 0.50   | prompts over 100k tokens: 0.50 / 0.625 / 0.05 / 2.50 |
| `claude-haiku-4-5-20251001` | 1     | 1.25                | 0.10       | 5      | legacy, still active                                 |

## Decision

- **Every role and the single agent run on `claude-haiku-5-5`** with effort `medium`, so the
  variants differ only in how the work is split.
- **A cost allowlist decides which models a run may call:** by default the light models in the price
  table (`DEFAULT_ALLOWED_MODELS`). Any other model, a larger one or a typo, is refused before the
  call, for every role, the fallback and the retro included. It is configurable (`allowedModels` in
  `createRoleSpecs` and `createAnthropicProvider`), and a model also needs its price in `PRICES`, so
  it can't cost 0 in a budget.
- **The fallback is `claude-haiku-4-5-20251001`:** the only other light Claude model, and a different
  model, so an overload or a rate limit on Haiku 5.5 doesn't stop it too. It costs 10× more, but it
  only runs for a step whose primary call failed, and the engine checks the budget at the fallback's
  price before calling it.
- **The provider calls the Messages API with `fetch`** (one endpoint, nothing added to the lockfile),
  with automatic prompt caching: every turn of an agent resends the conversation so far. It retries
  408, 409, 429, 5xx and 529 up to 3 times with the server's `retry-after` (at most 30 s), then
  throws so the engine moves to the fallback. A refused request (400, 401, 403, 404) throws at once.
- **Prompts live in `packages/engine/prompts/*.md`**, one per role plus the retro, in English and
  short. The user message is data in tags (`<request>`, `<plan>`, `<gate_comment>`, `<failures>`,
  `<review_comments>`, `<diff>`); the prompt says what to do with each. A hash of the files is the
  prompt version the scoreboard records. In the `crew-playbook` variant each role also gets its own
  playbook section, recorded as the rules applied.
- **The retro only proposes.** After a crew run it makes one model call (Haiku 5.5, same fallback) that
  reads the run from the trace and returns up to 3 lessons (error, cause, rule, role, step). The
  lessons go to `lessons`; their rules become a `proposed` playbook version with the diff. A version
  counts only once a person (or the evaluation's logged policy) approves it. A rule the playbook
  already has is recorded as a duplicate of the version that has it and adds nothing. A clean run
  (green at the first try, plan approved as it was, no review comments) skips the call.
- **Proposals queue.** A new proposal builds on the newest version that isn't rejected, proposals are
  decided in order, and rejecting one rebuilds the proposals queued after it without its rules.

## Alternatives discarded

- **The same Haiku 5.5 with another setting as the fallback** (lower effort): no extra cost, but a
  model-wide overload or rate limit would stop both. Kept possible: `createRoleSpecs({ models })`.
- **The official SDK:** one more dependency for one endpoint.
- **Applying lessons straight away:** faster learning, but one wrong rule would reach every later run
  with nobody having read it, and the learning curve couldn't tell which version helped.
- **Free-text lessons:** easy to write, impossible to dedupe or trace to a step.

## Consequences

- If Anthropic retires Haiku 4.5, the fallback calls fail with 404 and a step whose primary also failed
  ends the run with `error`. Swap `MODELS.fallback` and add its price to `PRICES` (an unknown model is
  refused, so it can't cost 0 in a budget).
- A live run of `cancel-order` on 2026-11-26 passed with 28 / 28 tests and 6 / 6 hidden tests for
  $0.0125 (17 calls, 94k of 141k prompt tokens read from the cache). That is one run, not a
  measurement: the evaluation measures.
