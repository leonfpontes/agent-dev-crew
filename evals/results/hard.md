# Evaluation results · hard set

8 feature requests × 3 variants × 3 rounds on `claude-haiku-5-5` (fallback `claude-haiku-4-5-20251001`), prompts `e5e1c7407817`, example `fernhill-orders@39083dc`, run 2026-11-26.
Spent $4.90 of the $5.52 cap (ablation $3.46, learning curve $1.44 of its $3.00). **Stopped early: the budget ran out, so some runs are missing** (ablation complete; curve: v1 1 round of 3).

> **Note:** The budget ran out before the first playbook version's second and third curve rounds: the retro kept learning for all three epochs (v1 to v12), which cost more than planned, and the ablation came first. v1, v4 and v7 are one-round points.

Mean ± standard deviation across rounds. A request passes when all its hidden acceptance tests pass.

| Variant                       | Requests passing | Hidden tests passing | Cost per request | Tokens per request | Time per request | Fix loops per request | Gate interventions |
| ----------------------------- | ---------------- | -------------------- | ---------------- | ------------------ | ---------------- | --------------------- | ------------------ |
| Single agent                  | 100% ± 0         | 100% ± 0             | $0.0274 ± 0.0014 | 393607 ± 41856     | 145 ± 7 s        | 0.00 ± 0.00           | 0 of 0             |
| Crew, no playbook             | 88% ± 0          | 99% ± 0              | $0.0529 ± 0.0024 | 709554 ± 69402     | 252 ± 9 s        | 0.04 ± 0.07           | 0 of 24            |
| Crew + playbook v12 (learned) | 83% ± 7          | 98% ± 0              | $0.0640 ± 0.0054 | 937106 ± 90837     | 312 ± 13 s       | 0.04 ± 0.07           | 0 of 24            |

Times are wall-clock with 6 runs at once, so they compare variants, not machines.

## Learning curve

The retro proposed 20 lessons in 24 learning runs; 20 became rules, taking the playbook from v1 to v12.

Requests passing per playbook version, for the versions a whole round ran with. 3 rounds = solid point, 1 round = hollow point.

| Version | Rules | Rounds | Requests passing |
| ------- | ----- | ------ | ---------------- |
| v1      | 4     | 1      | 75% ± 0          |
| v4      | 9     | 1      | 88% ± 0          |
| v7      | 14    | 1      | 88% ± 0          |
| v12     | 24    | 3      | 83% ± 7          |

## Per request

| Request                                                   | Hidden tests | Single agent | Crew, no playbook | Crew + learned playbook |
| --------------------------------------------------------- | ------------ | ------------ | ----------------- | ----------------------- |
| Reserve stock and take returns that put it back           | 17           | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✗                   |
| Accept gift cards on orders that are safe to retry        | 16           | ✓ ✓ ✓        | ✓ ✓ ✗             | ✓ ✓ ✗                   |
| Report and query orders by the store's local day          | 16           | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Ship orders in parts and query them by status             | 15           | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Apply promotions at prices that can change on a schedule  | 18           | ✓ ✓ ✓        | ✗ ✗ ✓             | ✗ ✗ ✓                   |
| Earn and redeem points on orders paid with gift cards     | 17           | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Ship orders in parts and take returns of what has shipped | 17           | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Reserve stock on orders that are safe to retry            | 16           | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
