// The playbook: a Markdown file with one `## <Role>` section of `- rule` lines per role. Every
// version lives in the trace (`playbook_versions`); v1 is playbook.md as it ships. A retro proposes
// the next version, and a version only counts once a person (or the evaluation's policy) approves it.
//
// Proposals queue: a new one builds on the newest version that isn't rejected, so two retros in a
// row don't drop each other's rules. They are decided in order; rejecting one rebuilds the proposals
// queued after it without its rules.

import { readFileSync } from 'node:fs'

import {
  PLAYBOOK_SECTIONS,
  unifiedDiff,
  type Decider,
  type PlaybookSection,
  type PlaybookStatus,
  type TraceDb,
} from '@crew/trace'

export const INITIAL_PLAYBOOK_FILE = new URL('../playbook.md', import.meta.url)
export const initialPlaybook = () => readFileSync(INITIAL_PLAYBOOK_FILE, 'utf8')

export interface PlaybookVersion {
  version: number
  title: string
  content: string
  status: PlaybookStatus
}

export interface ProposedRule {
  section: PlaybookSection
  rule: string
}

const heading = (line: string) => /^##\s+(.+?)\s*$/.exec(line)?.[1]

/** The rules of one section, in order. */
export function sectionRules(content: string, section: PlaybookSection): string[] {
  const rules: string[] = []
  let inside = false
  for (const line of content.split('\n')) {
    const h = heading(line)
    if (h !== undefined) inside = h === section
    else if (inside && /^\s*-\s+/.test(line)) rules.push(line.replace(/^\s*-\s+/, '').trim())
  }
  return rules
}

/** Compares rules the way a reader would: case, spacing and the final full stop don't count. */
export const normalizeRule = (rule: string) =>
  rule
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:!]+$/, '')
    .trim()

/** The section that already has this rule, if any. */
export function findRule(content: string, rule: string): PlaybookSection | undefined {
  const wanted = normalizeRule(rule)
  return PLAYBOOK_SECTIONS.find((s) => sectionRules(content, s).some((r) => normalizeRule(r) === wanted))
}

/** Adds each rule as the last line of its section (adding the section, in role order, if missing). */
export function applyRules(content: string, rules: ProposedRule[]): string {
  const lines = content.replace(/\n+$/, '').split('\n')
  for (const { section, rule } of rules) {
    const start = lines.findIndex((l) => heading(l) === section)
    if (start === -1) {
      // Before the first section that comes after it in role order, else at the end.
      const order = PLAYBOOK_SECTIONS.indexOf(section)
      const next = lines.findIndex((l) => {
        const h = heading(l) as PlaybookSection | undefined
        return h !== undefined && PLAYBOOK_SECTIONS.indexOf(h) > order
      })
      const block = [`## ${section}`, '', `- ${rule}`, '']
      if (next === -1) lines.push('', ...block.slice(0, -1))
      else lines.splice(next, 0, ...block)
      continue
    }
    let end = lines.findIndex((l, i) => i > start && heading(l) !== undefined)
    if (end === -1) end = lines.length
    let last = end - 1
    while (last > start && lines[last]!.trim() === '') last--
    lines.splice(last + 1, 0, `- ${rule}`)
  }
  return lines.join('\n') + '\n'
}

const row = (db: TraceDb, version: number) =>
  db
    .prepare('SELECT version, title, content, status FROM playbook_versions WHERE version = ?')
    .get(version) as PlaybookVersion | undefined

const latestVersion = (db: TraceDb) =>
  (db.prepare('SELECT MAX(version) AS v FROM playbook_versions').get() as { v: number | null }).v ?? 0

/** Writes v1 from playbook.md when the trace has no playbook yet; returns the current version. */
export function ensurePlaybook(db: TraceDb, now = new Date()): PlaybookVersion {
  if (latestVersion(db) === 0) {
    db.prepare(
      /* sql */ `INSERT INTO playbook_versions (version, title, content, diff, status, source, created_at, decided_at)
      VALUES (1, 'Initial playbook', ?, NULL, 'approved', 'initial', ?, ?)`,
    ).run(initialPlaybook(), now.toISOString(), now.toISOString())
  }
  return currentPlaybook(db)
}

/** The newest approved version: the one the `crew-playbook` variant runs with. */
export function currentPlaybook(db: TraceDb): PlaybookVersion {
  const found = db
    .prepare(
      "SELECT version, title, content, status FROM playbook_versions WHERE status = 'approved' ORDER BY version DESC LIMIT 1",
    )
    .get() as PlaybookVersion | undefined
  if (!found) throw new Error('The trace has no approved playbook: call ensurePlaybook first.')
  return found
}

/** The newest version before `before` that isn't rejected: what a proposal builds on. */
function baseBefore(db: TraceDb, before: number): PlaybookVersion {
  const found = db
    .prepare(
      "SELECT version, title, content, status FROM playbook_versions WHERE status <> 'rejected' AND version < ? ORDER BY version DESC LIMIT 1",
    )
    .get(before) as PlaybookVersion | undefined
  if (!found) throw new Error('The trace has no playbook: call ensurePlaybook first.')
  return found
}

export interface LessonInput {
  error: string
  cause: string
  rule: string
  section: PlaybookSection
  /** The step where the error showed. */
  stepId?: number | null
}

export interface ProposalResult {
  /** The proposed version, or undefined when every lesson was a duplicate. */
  version?: number
  /** The lessons as recorded, in order. */
  lessons: (LessonInput & { position: number; status: 'proposed' | 'duplicate'; duplicateOf?: number })[]
}

const titleOf = (rule: string) => {
  const t = rule.replace(/[.]+$/, '')
  return t.length <= 80 ? t : `${t.slice(0, 79).trimEnd()}…`
}

/**
 * Records a run's lessons and proposes the playbook version with their rules. A lesson whose rule
 * the playbook already has (or an earlier lesson of the same retro) is recorded as a duplicate of
 * the version that has it and adds nothing.
 */
export function proposePlaybookVersion(
  db: TraceDb,
  runId: number,
  lessons: LessonInput[],
  now = new Date(),
): ProposalResult {
  const latest = latestVersion(db)
  // A second retro of the same run (a retry) numbers its lessons after the first one's.
  const after = (
    db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM lessons WHERE run_id = ?').get(runId) as {
      p: number
    }
  ).p
  const base = baseBefore(db, latest + 1)
  const fresh: ProposedRule[] = []
  const recorded: ProposalResult['lessons'] = lessons.map((lesson, i) => {
    const position = after + i + 1
    const seen = fresh.some((f) => normalizeRule(f.rule) === normalizeRule(lesson.rule))
    if (findRule(base.content, lesson.rule) !== undefined || seen) {
      const duplicateOf = seen ? latest + 1 : firstVersionWith(db, lesson.rule, base.version)
      return { ...lesson, position, status: 'duplicate' as const, duplicateOf }
    }
    fresh.push({ section: lesson.section, rule: lesson.rule.trim() })
    return { ...lesson, position, status: 'proposed' as const }
  })

  const insertLessons = (version: number | null) => {
    const insert =
      db.prepare(/* sql */ `INSERT INTO lessons (run_id, step_id, position, error, cause, rule, section, status, playbook_version, duplicate_of)
      VALUES (:run_id, :step_id, :position, :error, :cause, :rule, :section, :status, :playbook_version, :duplicate_of)`)
    for (const l of recorded)
      insert.run({
        run_id: runId,
        step_id: l.stepId ?? null,
        position: l.position,
        error: l.error,
        cause: l.cause,
        rule: l.rule,
        section: l.section,
        status: l.status,
        playbook_version: l.status === 'proposed' ? version : null,
        duplicate_of: l.duplicateOf ?? null,
      })
  }

  db.exec('BEGIN')
  try {
    if (fresh.length === 0) {
      insertLessons(null)
      db.exec('COMMIT')
      return { lessons: recorded }
    }
    const version = latest + 1
    const before = row(db, latest)!
    const content = applyRules(base.content, fresh)
    db.prepare(
      /* sql */ `INSERT INTO playbook_versions (version, title, content, diff, status, source, source_run_id, created_at)
      VALUES (?, ?, ?, ?, 'proposed', 'retro', ?, ?)`,
    ).run(
      version,
      titleOf(fresh[0]!.rule),
      content,
      unifiedDiff(before.content, content),
      runId,
      now.toISOString(),
    )
    insertLessons(version)
    db.exec('COMMIT')
    return { version, lessons: recorded }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

/** The first non-rejected version up to `upTo` whose content has the rule. */
function firstVersionWith(db: TraceDb, rule: string, upTo: number): number {
  const rows = db
    .prepare(
      "SELECT version, content FROM playbook_versions WHERE status <> 'rejected' AND version <= ? ORDER BY version",
    )
    .all(upTo) as { version: number; content: string }[]
  return rows.find((r) => findRule(r.content, rule) !== undefined)?.version ?? upTo
}

/**
 * Approves or rejects a proposed version, in order. Approved, it becomes the current playbook and
 * its lessons are accepted; rejected, it stays in the history with its lessons rejected, and the
 * proposals queued after it are rebuilt without its rules.
 */
export function decidePlaybookVersion(
  db: TraceDb,
  version: number,
  decision: 'approve' | 'reject',
  by: Decider,
  now = new Date(),
): PlaybookVersion {
  const target = row(db, version)
  if (!target) throw new Error(`Playbook v${version} doesn't exist.`)
  if (target.status !== 'proposed') throw new Error(`Playbook v${version} was already ${target.status}.`)
  const earlier = db
    .prepare("SELECT MIN(version) AS v FROM playbook_versions WHERE status = 'proposed' AND version < ?")
    .get(version) as { v: number | null }
  if (earlier.v !== null)
    throw new Error(`Decide playbook v${earlier.v} first: proposals are decided in order.`)

  const status = decision === 'approve' ? 'approved' : 'rejected'
  db.exec('BEGIN')
  try {
    db.prepare(
      'UPDATE playbook_versions SET status = ?, decided_at = ?, decided_by = ? WHERE version = ?',
    ).run(status, now.toISOString(), by, version)
    db.prepare("UPDATE lessons SET status = ? WHERE playbook_version = ? AND status = 'proposed'").run(
      decision === 'approve' ? 'accepted' : 'rejected',
      version,
    )
    if (decision === 'reject') rebuildAfter(db, version)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return row(db, version)!
}

/** Rebuilds every proposal after `version` on the versions still standing. */
function rebuildAfter(db: TraceDb, version: number) {
  const queued = db
    .prepare(
      "SELECT version FROM playbook_versions WHERE status = 'proposed' AND version > ? ORDER BY version",
    )
    .all(version) as { version: number }[]
  for (const { version: v } of queued) {
    const rules = db
      .prepare(
        "SELECT section, rule FROM lessons WHERE playbook_version = ? AND status = 'proposed' ORDER BY run_id, position",
      )
      .all(v) as unknown as ProposedRule[]
    const content = applyRules(baseBefore(db, v).content, rules)
    const before = row(db, v - 1)!
    db.prepare('UPDATE playbook_versions SET content = ?, diff = ? WHERE version = ?').run(
      content,
      unifiedDiff(before.content, content),
      v,
    )
  }
}
