// The playbook in the trace: v1 from playbook.md, proposals from lessons (duplicates dropped), and
// decisions in order, with rejected versions kept in the history.
import { describe, expect, it } from 'vitest'

import {
  applyRules,
  currentPlaybook,
  decidePlaybookVersion,
  ensurePlaybook,
  findRule,
  initialPlaybook,
  proposePlaybookVersion,
  sectionRules,
  type LessonInput,
} from './index.js'
import { freshTrace } from './test/fixtures.js'

const NOW = new Date('2026-11-26T12:00:00Z')

/** A trace with v1 and one run (lessons need a run); `addRun` adds another. */
function setup() {
  const db = freshTrace()
  ensurePlaybook(db, NOW)
  const addRun = () =>
    Number(
      db
        .prepare(
          /* sql */ `INSERT INTO runs (title, request, variant, origin, status, repo_ref, model, budget_micros, started_at, duration_ms)
          VALUES ('t', 'r', 'crew', 'live', 'passed', 'fernhill-orders@abc1234', 'claude-haiku-5-5', 1, ?, 1)`,
        )
        .run(NOW.toISOString()).lastInsertRowid,
    )
  const runId = addRun()
  const step = db
    .prepare(
      "INSERT INTO steps (run_id, seq, kind, role, status, offset_ms) VALUES (?, 1, 'test', 'qa', 'failed', 0)",
    )
    .run(runId)
  return { db, runId, stepId: Number(step.lastInsertRowid), addRun }
}

const lesson = (
  rule: string,
  section: LessonInput['section'] = 'Engineer',
  stepId?: number,
): LessonInput => ({
  error: 'QA failed: cancelled orders still counted.',
  cause: 'The total kept reading the old status.',
  rule,
  section,
  stepId,
})

const lessonsOf = (db: ReturnType<typeof freshTrace>) =>
  db
    .prepare(
      'SELECT position, rule, status, playbook_version, duplicate_of, step_id FROM lessons ORDER BY id',
    )
    .all()

describe('playbook text', () => {
  const doc = initialPlaybook()

  it('ships a generic v1 with one section per role', () => {
    for (const section of ['PO', 'Engineer', 'Reviewer', 'QA'] as const)
      expect(sectionRules(doc, section).length).toBeGreaterThan(0)
  })

  it('adds a rule at the end of its section, and a missing section in role order', () => {
    const one = applyRules(doc, [{ section: 'Engineer', rule: 'Run the tests after each write.' }])
    expect(sectionRules(one, 'Engineer')).toEqual([
      'Read every file you change before you write it.',
      'Run the tests after each write.',
    ])
    expect(sectionRules(one, 'Reviewer')).toEqual(sectionRules(doc, 'Reviewer'))

    const noReviewer = '# Playbook\n\n## PO\n\n- Plan.\n\n## QA\n\n- Test.\n'
    const added = applyRules(noReviewer, [{ section: 'Reviewer', rule: 'Read the diff.' }])
    expect(added).toBe(
      '# Playbook\n\n## PO\n\n- Plan.\n\n## Reviewer\n\n- Read the diff.\n\n## QA\n\n- Test.\n',
    )
    expect(applyRules('# P\n', [{ section: 'QA', rule: 'Test.' }])).toBe('# P\n\n## QA\n\n- Test.\n')
  })

  it('finds a rule written another way (case, spacing, full stop, code marks)', () => {
    expect(findRule(doc, 'read every  file you change before you write `it`')).toBe('Engineer')
    expect(findRule(doc, 'Read the diff.')).toBeUndefined()
  })
})

describe('playbook versions', () => {
  it('writes v1 once, approved, from playbook.md', () => {
    const db = freshTrace()
    expect(ensurePlaybook(db, NOW)).toMatchObject({
      version: 1,
      status: 'approved',
      content: initialPlaybook(),
    })
    ensurePlaybook(db, NOW)
    expect(db.prepare('SELECT COUNT(*) AS n FROM playbook_versions').get()).toEqual({ n: 1 })
    expect(() => currentPlaybook(freshTrace())).toThrow('no approved playbook')
  })

  it('proposes the next version with the diff, and records each lesson with its run and step', () => {
    const { db, runId, stepId } = setup()
    const result = proposePlaybookVersion(
      db,
      runId,
      [lesson('Before changing a status field, find every reader of it.', 'Engineer', stepId)],
      NOW,
    )
    expect(result.version).toBe(2)
    const v2 = db.prepare('SELECT * FROM playbook_versions WHERE version = 2').get() as Record<
      string,
      unknown
    >
    expect(v2).toMatchObject({
      title: 'Before changing a status field, find every reader of it',
      status: 'proposed',
      source: 'retro',
      source_run_id: runId,
      decided_at: null,
    })
    expect(v2.diff).toContain('+- Before changing a status field, find every reader of it.')
    expect(lessonsOf(db)).toEqual([
      {
        position: 1,
        rule: 'Before changing a status field, find every reader of it.',
        status: 'proposed',
        playbook_version: 2,
        duplicate_of: null,
        step_id: stepId,
      },
    ])
    // Proposed is not current until approved.
    expect(currentPlaybook(db).version).toBe(1)
  })

  it('drops duplicates: a rule the playbook has, and the same rule twice in one retro', () => {
    const { db, runId } = setup()
    const result = proposePlaybookVersion(
      db,
      runId,
      [
        lesson('Run the full suite, not only the tests you added', 'QA'),
        lesson('Name the failing test and its expected value.', 'QA'),
        lesson('name the failing test and its expected value', 'QA'),
      ],
      NOW,
    )
    expect(result.version).toBe(2)
    expect(lessonsOf(db)).toMatchObject([
      { position: 1, status: 'duplicate', duplicate_of: 1, playbook_version: null },
      { position: 2, status: 'proposed', playbook_version: 2 },
      { position: 3, status: 'duplicate', duplicate_of: 2 },
    ])
    const v2 = db.prepare('SELECT content FROM playbook_versions WHERE version = 2').get() as {
      content: string
    }
    expect(sectionRules(v2.content, 'QA')).toHaveLength(2)
  })

  it('numbers the lessons of a second retro of the same run after the first', () => {
    const { db, runId } = setup()
    proposePlaybookVersion(db, runId, [lesson('Run the tests after each write.')], NOW)
    const second = proposePlaybookVersion(db, runId, [lesson('Name the failing test.', 'QA')], NOW)
    expect(second.lessons[0]).toMatchObject({ position: 2 })
    expect(lessonsOf(db)).toMatchObject([{ position: 1 }, { position: 2, playbook_version: 3 }])
  })

  it('proposes nothing when every lesson is a duplicate, and still records the lessons', () => {
    const { db, runId } = setup()
    const result = proposePlaybookVersion(
      db,
      runId,
      [lesson('Read every file you change before you write it')],
      NOW,
    )
    expect(result.version).toBeUndefined()
    expect(db.prepare('SELECT COUNT(*) AS n FROM playbook_versions').get()).toEqual({ n: 1 })
    expect(lessonsOf(db)).toMatchObject([{ status: 'duplicate', duplicate_of: 1 }])
  })

  it('approved, a proposal becomes the current playbook and its lessons are accepted', () => {
    const { db, runId } = setup()
    proposePlaybookVersion(db, runId, [lesson('Run the tests after each write.')], NOW)
    const v2 = decidePlaybookVersion(db, 2, 'approve', 'person', NOW)
    expect(v2.status).toBe('approved')
    expect(currentPlaybook(db).version).toBe(2)
    expect(
      db.prepare('SELECT decided_by, decided_at FROM playbook_versions WHERE version = 2').get(),
    ).toEqual({
      decided_by: 'person',
      decided_at: NOW.toISOString(),
    })
    expect(lessonsOf(db)).toMatchObject([{ status: 'accepted', playbook_version: 2 }])
    expect(() => decidePlaybookVersion(db, 2, 'reject', 'person', NOW)).toThrow('already approved')
    expect(() => decidePlaybookVersion(db, 9, 'approve', 'person', NOW)).toThrow("doesn't exist")
  })

  it('rejected, a proposal stays in the history, its lessons are rejected and the playbook stays', () => {
    const { db, runId, addRun } = setup()
    proposePlaybookVersion(db, runId, [lesson('Run the tests after each write.')], NOW)
    decidePlaybookVersion(db, 2, 'reject', 'policy', NOW)
    expect(db.prepare('SELECT status FROM playbook_versions WHERE version = 2').get()).toEqual({
      status: 'rejected',
    })
    expect(lessonsOf(db)).toMatchObject([{ status: 'rejected', playbook_version: 2 }])
    expect(currentPlaybook(db).version).toBe(1)
    // The next proposal builds on v1, not on the rejected v2, and diffs against v2 (the one before).
    proposePlaybookVersion(db, addRun(), [lesson('Name the failing test.', 'QA')], NOW)
    const v3 = db.prepare('SELECT content, diff FROM playbook_versions WHERE version = 3').get() as {
      content: string
      diff: string
    }
    expect(sectionRules(v3.content, 'Engineer')).not.toContain('Run the tests after each write.')
    expect(v3.diff).toContain('-- Run the tests after each write.')
    expect(v3.diff).toContain('+- Name the failing test.')
  })

  it('queues proposals: decided in order, and rejecting one rebuilds the next without its rules', () => {
    const { db, runId, addRun } = setup()
    const other = addRun()
    proposePlaybookVersion(db, runId, [lesson('Run the tests after each write.')], NOW)
    proposePlaybookVersion(db, other, [lesson('Name the failing test.', 'QA')], NOW)
    const v3 = () =>
      db.prepare('SELECT content, diff FROM playbook_versions WHERE version = 3').get() as {
        content: string
        diff: string
      }
    // v3 builds on v2, so approving both keeps both rules.
    expect(sectionRules(v3().content, 'Engineer')).toContain('Run the tests after each write.')
    expect(() => decidePlaybookVersion(db, 3, 'approve', 'person', NOW)).toThrow('Decide playbook v2 first')

    decidePlaybookVersion(db, 2, 'reject', 'person', NOW)
    expect(sectionRules(v3().content, 'Engineer')).not.toContain('Run the tests after each write.')
    expect(sectionRules(v3().content, 'QA')).toContain('Name the failing test.')
    expect(v3().diff).toContain('-- Run the tests after each write.')
    decidePlaybookVersion(db, 3, 'approve', 'person', NOW)
    expect(currentPlaybook(db)).toMatchObject({ version: 3 })
  })
})
