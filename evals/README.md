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

The easy set asks for one rule per request, and a single agent passed all of it. Calibration probes
(one round of the single agent) showed that harder single features weren't enough either: 9 of 10,
then 10 of 10. So each hard request now asks for two features that interact, on the same example:
several routes, state that carries from one request to the next (stock, carts, orders, balances,
refunds), changes across modules, and rules that only hold when both parts are right. Every expected
status code, field and error message is written in the request, under "Part 1", "Part 2" and
"Together"; nothing is hidden. A request passes only when all its hidden tests pass (15 to 18 each).

| Request                 | Parts                                | What only works when both parts are right                                                        |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `stock-and-returns`     | Stock reservations · returns         | Returned units go back on sale; returns, orders and cancels share one queue so stock stays right |
| `gift-cards-retries`    | Gift cards · Idempotency-Key         | A retry spends nothing twice; orders racing for one card take from it in turn                    |
| `local-day-queries`     | Store-day reports · order query      | `from`/`to` on the order list use the New York day, like the reports                             |
| `shipment-queries`      | Split shipments · order query        | `partially_shipped` in the filter, and between paid and shipped in the sort                      |
| `scheduled-promotions`  | Promotions · scheduled prices        | Promotions use the prices in force when the order is placed                                      |
| `points-and-gift-cards` | Loyalty points · gift cards          | Points first, then the card; an order the card pays in full earns its points at placement        |
| `ship-and-return`       | Split shipments · returns            | Only shipped units come back; the last return closes the total                                   |
| `retry-safe-stock`      | Stock reservations · Idempotency-Key | A replay takes no stock; a refusal for stock isn't remembered; cancels are retry-safe too        |

## Limits

- 10 requests on one small example repository; read the ± before comparing two numbers.
- When a variant passes every request, the pass rate can't tell variants apart any more: compare
  cost, tokens and time instead.
- The retro learns only from what went wrong in the run it sees. A crew that passes every request
  at the first try gives it nothing to learn, and the curve stays at one point.
