# Contributing

## Set up

Node 24 (see `.nvmrc`) and pnpm (`corepack enable`), then:

```bash
pnpm install
pnpm qa
```

## Before you open a pull request

- [ ] `pnpm qa` passes (types, lint, formatting, tests, build, end-to-end)
- [ ] A new test for every new rule
- [ ] No secrets in the diff
- [ ] `docs/` and `CHANGELOG.md` updated

## Conventions

- Short branches from `main`: `feat/`, `fix/`, `docs/`, `perf/`, `ops/`.
- [Conventional Commits](https://www.conventionalcommits.org/); the body explains why.
- Comments explain why, not what.
- Decisions that are hard to undo get an ADR in `docs/adr/`.
