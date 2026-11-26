# 0001 · pnpm monorepo in TypeScript, with the Atlas components

- **Date:** 2026-11-26 · **Status:** accepted

## Context

The crew has an engine (DAG, roles, gate, fix loop), a sandbox for the code the agents write, a
web app for the trace, an example repository the agents work on, and an evaluation. They change
together and share types (steps, costs, lessons). The app follows the Atlas design system, which
is published on npm as `@leonfpontes/atlas-ui`.

## Decision

- **pnpm workspaces**, one lockfile, TypeScript in `strict` everywhere.
- Workspace packages resolve to their `src/` in development (export condition plus Vitest alias),
  so a clean clone typechecks and tests before any build.
- **Vite + React** for the app, with `@leonfpontes/atlas-ui` from npm, not a copy.
- **Vitest** for unit tests, **Playwright** for end-to-end tests.

## Alternatives discarded

- npm workspaces: loose hoisting lets a package use a dependency it doesn't declare.
- Copying the Atlas components into the app: two sources to keep in sync, and it hides the reuse
  this portfolio wants to show.

## Consequences

- Contributors need Corepack or pnpm.
- New components the app needs go into Atlas first and arrive through a new `atlas-ui` version.
