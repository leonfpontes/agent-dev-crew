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

## Method

| Step           | What happens                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests       | [`requests/`](requests): 10 requests to `fernhill-orders`, a fictitious shop's orders API, each with hidden acceptance tests the agents never see and a reference solution that proves the tests are fair (`pnpm --filter @crew/evals validate`).                                                                                                                                |
| Model          | `claude-haiku-5-5` for every role and for the single agent, fallback `claude-haiku-4-5-20251001` ([ADR 0004](../docs/adr/0004-models-fallback-and-retro.md)). Prompts in `packages/engine/prompts/`; their hash is the `promptVersion` of the scoreboard.                                                                                                                        |
| Score          | After a run, the hidden tests are copied into the run's copy and run in the sandbox. A request passes when all of them pass. The tests the crew ran itself don't count.                                                                                                                                                                                                          |
| Learning       | Each epoch runs every request with the crew and the current playbook, with the retro on; the logged policy then approves the proposed versions, in order. An epoch that proposes nothing ends the learning (at most 3 epochs). The ablation's `crew-playbook` runs the learned version.                                                                                          |
| Learning curve | Requests passing per playbook version, for the versions a whole round ran with. The first and the last version get 3 rounds (solid points), the ones in between 1 (hollow points); each point says how many rounds it has. Versions approved inside an epoch fold into the next point.                                                                                           |
| Rounds         | 3 rounds of every request per variant; numbers are the mean of the round means ± the sample standard deviation between rounds.                                                                                                                                                                                                                                                   |
| Cost           | From each response's `usage` at the published prices ([`pricing.ts`](../packages/engine/src/pricing.ts)). Each run has a $0.25 budget the engine never passes; before a run starts the harness reserves that budget against the total cap ($5) and the curve's cap ($3), so the spend can't pass either. Runs that don't fit don't start and the scoreboard says `stoppedEarly`. |
| Time           | Wall-clock per run with 6 runs at once: it compares variants on the same machine, not machines.                                                                                                                                                                                                                                                                                  |

## Limits

- 10 requests on one small example repository; read the ± before comparing two numbers.
- When a variant passes every request, the pass rate can't tell variants apart any more: compare
  cost, tokens and time instead.
- The retro learns only from what went wrong in the run it sees. A crew that passes every request
  at the first try gives it nothing to learn, and the curve stays at one point.
