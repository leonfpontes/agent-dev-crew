// Schema migrations, in order. Each has an `up` and a `down` that undoes it exactly, so the
// database can move to any version and back. A new migration goes at the end; never edit one
// that has shipped. The CHECK lists come from the contracts, so a new status is one change.

import { GATE_DECISIONS, MAX_FIX_LOOPS, ROLES, STEP_STATUSES, VARIANTS } from '@crew/core'

import {
  DECIDERS,
  EVAL_SUITES,
  EVENT_KINDS,
  FAILURE_REASONS,
  LESSON_STATUSES,
  PLAYBOOK_SECTIONS,
  PLAYBOOK_SOURCES,
  PLAYBOOK_STATUSES,
  RUN_ORIGINS,
  RUN_STATUSES,
  STEP_KINDS,
} from './contracts.js'

export interface Migration {
  version: number
  name: string
  up: string
  down: string
}

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ')

const init: Migration = {
  version: 1,
  name: 'runs, steps, events, costs, lessons and playbook versions',
  up: /* sql */ `
    CREATE TABLE playbook_versions (
      version      INTEGER PRIMARY KEY CHECK (version >= 1),
      title        TEXT    NOT NULL,
      content      TEXT    NOT NULL,                 -- the whole playbook.md at this version
      diff         TEXT,                             -- unified diff from the version before; NULL for v1
      status       TEXT    NOT NULL CHECK (status IN (${list(PLAYBOOK_STATUSES)})),
      source       TEXT    NOT NULL CHECK (source IN (${list(PLAYBOOK_SOURCES)})),
      source_run_id INTEGER,                         -- no foreign key: old runs may be pruned
      created_at   TEXT    NOT NULL,
      decided_at   TEXT,
      decided_by   TEXT    CHECK (decided_by IN (${list(DECIDERS)})),
      CHECK ((status = 'proposed') = (decided_at IS NULL)),
      CHECK ((source = 'retro') = (source_run_id IS NOT NULL)),
      CHECK ((version = 1) = (diff IS NULL))
    ) STRICT;

    CREATE TABLE runs (
      id               INTEGER PRIMARY KEY,          -- shown as #142
      title            TEXT    NOT NULL,
      request          TEXT    NOT NULL,             -- the feature request as the crew got it
      request_id       TEXT,                         -- evals request id, when there is one
      variant          TEXT    NOT NULL CHECK (variant IN (${list(VARIANTS)})),
      playbook_version INTEGER REFERENCES playbook_versions (version),
      origin           TEXT    NOT NULL CHECK (origin IN (${list(RUN_ORIGINS)})),
      eval_suite       TEXT    CHECK (eval_suite IN (${list(EVAL_SUITES)})),
      eval_round       INTEGER CHECK (eval_round >= 1),
      status           TEXT    NOT NULL CHECK (status IN (${list(RUN_STATUSES)})),
      failure_reason   TEXT    CHECK (failure_reason IN (${list(FAILURE_REASONS)})),
      repo_ref         TEXT    NOT NULL,             -- e.g. fernhill-orders@9c2e71b
      model            TEXT    NOT NULL,             -- default model of the run
      budget_micros    INTEGER NOT NULL CHECK (budget_micros > 0),
      started_at       TEXT    NOT NULL,             -- ISO 8601, UTC
      duration_ms      INTEGER CHECK (duration_ms >= 0),
      tests_passed     INTEGER CHECK (tests_passed >= 0),
      tests_total      INTEGER CHECK (tests_total >= 0),
      hidden_passed    INTEGER CHECK (hidden_passed >= 0),
      hidden_total     INTEGER CHECK (hidden_total >= 0),
      diff             TEXT,                         -- the "pull request": unified diff of the run
      CHECK ((origin = 'eval') = (eval_suite IS NOT NULL AND eval_round IS NOT NULL AND request_id IS NOT NULL)),
      CHECK ((status IN ('running', 'waiting')) = (duration_ms IS NULL)),
      CHECK ((status = 'failed') = (failure_reason IS NOT NULL)),
      CHECK ((variant = 'crew-playbook') = (playbook_version IS NOT NULL)),
      CHECK (tests_passed <= tests_total),
      CHECK (hidden_passed <= hidden_total)
    ) STRICT;

    CREATE TABLE steps (
      id             INTEGER PRIMARY KEY,
      run_id         INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      parent_id      INTEGER REFERENCES steps (id) ON DELETE CASCADE,  -- the fix-loop group
      seq            INTEGER NOT NULL,             -- order in the run, parents before children
      kind           TEXT    NOT NULL CHECK (kind IN (${list(STEP_KINDS)})),
      role           TEXT    CHECK (role IN (${list(ROLES)})),
      status         TEXT    NOT NULL CHECK (status IN (${list(STEP_STATUSES)})),
      summary        TEXT,                         -- short result: "23 / 24", "1 comment"
      model          TEXT,                         -- the model that answered (NULL: no model call)
      fallback_used  INTEGER NOT NULL DEFAULT 0 CHECK (fallback_used IN (0, 1)),
      attempt        INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
      max_attempts   INTEGER NOT NULL DEFAULT 1 CHECK (max_attempts >= attempt),
      loop_index     INTEGER CHECK (loop_index BETWEEN 1 AND ${MAX_FIX_LOOPS}),
      offset_ms      INTEGER CHECK (offset_ms >= 0),  -- start, from the start of the run
      duration_ms    INTEGER CHECK (duration_ms >= 0),
      decision       TEXT    CHECK (decision IN (${list(GATE_DECISIONS)})),
      decided_by     TEXT    CHECK (decided_by IN (${list(DECIDERS)})),
      comment        TEXT,                         -- the gate comment, kept in the trace
      UNIQUE (run_id, seq),
      CHECK (kind IN ('plan', 'code', 'review', 'test', 'fix') OR role IS NULL),
      CHECK (kind = 'gate' OR (decision IS NULL AND decided_by IS NULL)),
      CHECK ((decision IS NULL) = (decided_by IS NULL)),
      CHECK ((kind = 'fix-loop') = (loop_index IS NOT NULL AND parent_id IS NULL)),
      CHECK (offset_ms IS NOT NULL OR duration_ms IS NULL)
    ) STRICT;

    CREATE TABLE events (
      id        INTEGER PRIMARY KEY,
      run_id    INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      step_id   INTEGER REFERENCES steps (id) ON DELETE CASCADE,
      seq       INTEGER NOT NULL,                  -- order in the run
      offset_ms INTEGER NOT NULL CHECK (offset_ms >= 0),
      kind      TEXT    NOT NULL CHECK (kind IN (${list(EVENT_KINDS)})),
      payload   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload)),
      UNIQUE (run_id, seq)
    ) STRICT;

    CREATE TABLE costs (
      id                 INTEGER PRIMARY KEY,
      run_id             INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      step_id            INTEGER NOT NULL REFERENCES steps (id) ON DELETE CASCADE,
      model              TEXT    NOT NULL,
      input_tokens       INTEGER NOT NULL CHECK (input_tokens >= 0),      -- not cached
      cache_read_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
      cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
      output_tokens      INTEGER NOT NULL CHECK (output_tokens >= 0),
      cost_micros        INTEGER NOT NULL CHECK (cost_micros >= 0),       -- USD millionths
      offset_ms          INTEGER NOT NULL CHECK (offset_ms >= 0)
    ) STRICT;

    CREATE TABLE lessons (
      id               INTEGER PRIMARY KEY,
      run_id           INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      step_id          INTEGER REFERENCES steps (id) ON DELETE SET NULL,  -- where the error showed
      position         INTEGER NOT NULL CHECK (position >= 1),
      error            TEXT    NOT NULL,
      cause            TEXT    NOT NULL,
      rule             TEXT    NOT NULL,
      section          TEXT    NOT NULL CHECK (section IN (${list(PLAYBOOK_SECTIONS)})),
      status           TEXT    NOT NULL CHECK (status IN (${list(LESSON_STATUSES)})),
      playbook_version INTEGER REFERENCES playbook_versions (version),    -- the version it proposed
      duplicate_of     INTEGER REFERENCES playbook_versions (version),
      UNIQUE (run_id, position),
      CHECK ((status = 'duplicate') = (duplicate_of IS NOT NULL)),
      CHECK (status IN ('duplicate', 'rejected') OR playbook_version IS NOT NULL)
    ) STRICT;
  `,
  down: /* sql */ `
    DROP TABLE lessons;
    DROP TABLE costs;
    DROP TABLE events;
    DROP TABLE steps;
    DROP TABLE runs;
    DROP TABLE playbook_versions;
  `,
}

// One index per screen query (see queries.ts), plus one per foreign key a delete has to follow.
// UNIQUE (run_id, seq) on steps and events, and UNIQUE (run_id, position) on lessons, already
// index a run's timeline.
const indexes: Migration = {
  version: 2,
  name: 'indexes for the Runs, Run detail, Playbook and Evaluation screens',
  up: /* sql */ `
    -- Runs list: only the runs outside the evaluation, newest first, without a sort.
    CREATE INDEX runs_list              ON runs (started_at DESC) WHERE eval_suite IS NULL;
    -- Evaluation: only its runs, grouped by suite, variant, playbook version and round.
    CREATE INDEX runs_by_eval           ON runs (eval_suite, variant, playbook_version, eval_round)
      WHERE eval_suite IS NOT NULL;
    CREATE INDEX runs_by_playbook       ON runs (playbook_version);
    CREATE INDEX steps_by_parent        ON steps (parent_id);
    CREATE INDEX events_by_step         ON events (step_id, seq);
    CREATE INDEX costs_by_run           ON costs (run_id, step_id);
    CREATE INDEX costs_by_step          ON costs (step_id);
    CREATE INDEX lessons_by_step        ON lessons (step_id);
    CREATE INDEX lessons_by_version     ON lessons (playbook_version);
    CREATE INDEX lessons_by_duplicate   ON lessons (duplicate_of);
  `,
  down: /* sql */ `
    DROP INDEX lessons_by_duplicate;
    DROP INDEX lessons_by_version;
    DROP INDEX lessons_by_step;
    DROP INDEX costs_by_step;
    DROP INDEX costs_by_run;
    DROP INDEX events_by_step;
    DROP INDEX steps_by_parent;
    DROP INDEX runs_by_playbook;
    DROP INDEX runs_by_eval;
    DROP INDEX runs_list;
  `,
}

export const MIGRATIONS: readonly Migration[] = [init, indexes]
export const LATEST_VERSION = MIGRATIONS.length
