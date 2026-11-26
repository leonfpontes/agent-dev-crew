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

| Folder   | What it has                            |
| -------- | -------------------------------------- |
| `docs/`  | This file, the docs index and the ADRs |
| `tests/` | Repository-wide guards                 |

## Contracts

Types, routes and formats the parts exchange. If one changes here, the doc changes in the same PR.
