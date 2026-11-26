# Evaluation results

10 feature requests × 3 variants × 3 rounds on `claude-haiku-5-5` (fallback `claude-haiku-4-5-20251001`), prompts `e5e1c7407817`, example `fernhill-orders@39083dc`, run 2026-11-26.
Spent $1.29 of the $4.90 cap (ablation $1.14, learning curve $0.15 of its $3.00).

Mean ± standard deviation across rounds. A request passes when all its hidden acceptance tests pass.

| Variant                              | Requests passing | Hidden tests passing | Cost per request | Tokens per request | Time per request | Fix loops per request | Gate interventions |
| ------------------------------------ | ---------------- | -------------------- | ---------------- | ------------------ | ---------------- | --------------------- | ------------------ |
| Single agent                         | 100% ± 0         | 100% ± 0             | $0.0054 ± 0.0004 | 72489 ± 9890       | 27 ± 3 s         | 0.00 ± 0.00           | 0 of 0             |
| Crew, no playbook                    | 100% ± 0         | 100% ± 0             | $0.0166 ± 0.0012 | 200379 ± 24225     | 72 ± 5 s         | 0.07 ± 0.12           | 0 of 30            |
| Crew + playbook v1 (nothing learned) | 97% ± 6          | 98% ± 3              | $0.0159 ± 0.0006 | 187406 ± 9874      | 69 ± 2 s         | 0.00 ± 0.00           | 0 of 29            |

Times are wall-clock with 6 runs at once, so they compare variants, not machines.

## Learning curve

The retro found nothing to learn: 0 lessons in 10 learning runs, so the playbook stayed at v1 (4 initial rules) and `crew-playbook` ran with it.

Requests passing per playbook version, for the versions a whole round ran with. 3 rounds = solid point, 1 round = hollow point.

| Version | Rules | Rounds | Requests passing |
| ------- | ----- | ------ | ---------------- |
| v1      | 4     | 4      | 98% ± 5          |

## Per request

| Request                                    | Hidden tests | Single agent | Crew, no playbook | Crew + learned playbook |
| ------------------------------------------ | ------------ | ------------ | ----------------- | ----------------------- |
| Add an order cancellation endpoint         | 6            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Paginate GET /orders                       | 5            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Validate the SKU before adding to the cart | 4            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Apply discount codes at checkout           | 7            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Add the customer email to the receipt      | 3            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Rate-limit POST /orders                    | 6            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Export orders as CSV                       | 5            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Fix rounding in order totals               | 4            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✗ ✓ ✓                   |
| Refund part of an order                    | 6            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
| Search orders by customer                  | 5            | ✓ ✓ ✓        | ✓ ✓ ✓             | ✓ ✓ ✓                   |
