# Evaluation

Does splitting the work across a crew (PO, Engineer, Reviewer, QA) beat one agent with the same
model, and does the playbook the crew learns from its own retrospectives help? The same model gets
the same 10 feature requests in three variants, three rounds each. Results:
[`results/latest.md`](results/latest.md) (for people) and [`results/latest.json`](results/latest.json)
(read by the app, the replay demo and the README).

| Variant         | What runs                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------- |
| `single-agent`  | One agent with every tool: reads, writes `src/` and `tests/`, runs the tests                 |
| `crew`          | PO plan → gate (approved by the logged policy) → Engineer → Reviewer → QA, up to 2 fix loops |
| `crew-playbook` | The same crew, each role also following its section of the learned playbook                  |

```bash
ANTHROPIC_API_KEY=… pnpm eval                       # the ablation and the learning curve, $5 cap in all
pnpm eval --requests cancel-order --rounds 1 --epochs 1 --budget 1.2 --curve-budget 0.3   # a quick check
pnpm eval --report                                  # rewrite results/ from the last trace, no API call
```

Every number is checked before any call: budgets must be dollars above 0 (above $20 needs
`--confirm-budget`), rounds, epochs and `--concurrency` whole numbers of 1 or more.

```bash
pnpm eval --budget 5$                               # refused: "--budget must be a number of dollars above 0"
```

## Method

| Step           | What happens                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests       | Two sets on `fernhill-orders`, a fictitious shop's orders API: [`requests/`](requests), the easy baseline (10 one-rule requests), and [`requests-hard/`](requests-hard) (10 multi-step requests, see below). Each request has hidden acceptance tests the agents never see and a reference solution that proves the tests are fair (`pnpm --filter @crew/evals validate`).       |
| Model          | `claude-haiku-5-5` for every role and for the single agent, fallback `claude-haiku-4-5-20251001` ([ADR 0004](../docs/adr/0004-models-fallback-and-retro.md)). Prompts in `packages/engine/prompts/`; their hash is the `promptVersion` of the scoreboard.                                                                                                                        |
| Score          | After a run, the hidden tests are copied into the run's copy and run in the sandbox. A request passes when all of them pass. The tests the crew ran itself don't count.                                                                                                                                                                                                          |
| Learning       | Each epoch runs every request with the crew and the current playbook, with the retro on; the logged policy then approves the proposed versions, in order. An epoch that proposes nothing ends the learning (at most 3 epochs). The ablation's `crew-playbook` runs the learned version.                                                                                          |
| Learning curve | Requests passing per playbook version, for the versions a whole round ran with. The first and the last version get 3 rounds (solid points), the ones in between 1 (hollow points); each point says how many rounds it has. Versions approved inside an epoch fold into the next point.                                                                                           |
| Rounds         | 3 rounds of every request per variant; numbers are the mean of the round means ± the sample standard deviation between rounds.                                                                                                                                                                                                                                                   |
| Cost           | From each response's `usage` at the published prices ([`pricing.ts`](../packages/engine/src/pricing.ts)). Each run has a $0.25 budget the engine never passes; before a run starts the harness reserves that budget against the total cap ($5) and the curve's cap ($3), so the spend can't pass either. Runs that don't fit don't start and the scoreboard says `stoppedEarly`. |
| Time           | Wall-clock per run with 6 runs at once: it compares variants on the same machine, not machines.                                                                                                                                                                                                                                                                                  |

## The hard set

The easy set asks for one rule per request, and a single agent passed all of it. The hard set keeps the
same example and asks for changes that take several steps across 2 to 6 files, where a rule the
request states is easy to miss. Every expected status code, field and error message is written in the
request; nothing is hidden.

| Request                  | What makes it hard                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `stock-reservations`     | A new route, stock taken when an order is placed and given back on cancel; the first failing line decides, nothing moves |
| `promotions`             | Two promotions listed in a fixed order; the tax rounded once per order, which the current code doesn't do                |
| `store-timezone-reports` | Days in America/New_York across both daylight saving changes; a range report with empty days; dates that don't exist     |
| `split-shipments`        | Partial shipments next to the old ship route, a new status, checks in a stated order, lines that must not change         |
| `loyalty-points`         | Points earned at payment, redeemed at placement, with five conditions; the tax on the discounted subtotal, once          |
| `idempotency-keys`       | Replays per path compared by JSON value, errors not remembered, a 24-hour expiry on the app clock                        |
| `returns`                | A 30-day window, a tax share per return, and a last return that refunds exactly what is left of the total                |
| `price-changes`          | Carts at today's price, orders frozen at placement, a price history that skips repeats                                   |
| `order-query`            | Seven combinable parameters, ties by id in both directions, the first invalid parameter named in a fixed order           |
| `gift-cards`             | A payment, not a discount: totals unchanged, an order placed already paid, codes that ignore case                        |

## Limits

- 10 requests on one small example repository; read the ± before comparing two numbers.
- When a variant passes every request, the pass rate can't tell variants apart any more: compare
  cost, tokens and time instead.
- The retro learns only from what went wrong in the run it sees. A crew that passes every request
  at the first try gives it nothing to learn, and the curve stays at one point.
