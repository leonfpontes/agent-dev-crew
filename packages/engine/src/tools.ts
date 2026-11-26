// The tools a role can call. Every path is relative to the repository copy and checked here, before
// the file system: no absolute paths, no way out with `..`, nothing hidden (the hidden tests arrive
// after the run, in `hidden/`) and nothing but `src/` and `tests/`. Writes are per role: the Engineer
// (and the single agent) writes code and tests, QA writes tests only, the PO and the Reviewer read.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runVitest, type TestReport } from '@crew/sandbox'
import * as v from 'valibot'

import type { ToolSpec } from './provider.js'
import type { Agent, Plan, Review } from './roles.js'
import { readTree, REPO_FOLDERS } from './workspace.js'

export const MAX_FILE_BYTES = 100_000

export type ToolName =
  'list_files' | 'read_file' | 'write_file' | 'run_tests' | 'submit_plan' | 'submit_review'

/** Which tools each agent gets. */
export const AGENT_TOOLS: Record<Agent, ToolName[]> = {
  po: ['list_files', 'read_file', 'submit_plan'],
  engineer: ['list_files', 'read_file', 'write_file', 'run_tests'],
  reviewer: ['list_files', 'read_file', 'submit_review'],
  qa: ['list_files', 'read_file', 'write_file', 'run_tests'],
  solo: ['list_files', 'read_file', 'write_file', 'run_tests'],
}

/** Where each agent may write. */
export const WRITABLE: Record<Agent, readonly string[]> = {
  po: [],
  engineer: ['src', 'tests'],
  reviewer: [],
  qa: ['tests'],
  solo: ['src', 'tests'],
}

const Path = v.pipe(v.string(), v.minLength(1), v.maxLength(200))
const INPUTS = {
  list_files: v.object({}),
  read_file: v.object({ path: Path }),
  write_file: v.object({ path: Path, content: v.pipe(v.string(), v.maxLength(MAX_FILE_BYTES)) }),
  run_tests: v.object({}),
  submit_plan: v.object({
    steps: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1), v.maxLength(20)),
    acceptance: v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1), v.maxLength(20)),
    files: v.pipe(v.array(Path), v.maxLength(20)),
    estimateUsd: v.pipe(v.number(), v.minValue(0)),
  }),
  submit_review: v.object({
    verdict: v.picklist(['approve', 'changes']),
    comments: v.pipe(v.array(v.string()), v.maxLength(20)),
  }),
} as const

export const TOOL_SPECS: Record<ToolName, ToolSpec> = {
  list_files: {
    name: 'list_files',
    description: 'List every file under src/ and tests/ of the repository, with its size in bytes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  read_file: {
    name: 'read_file',
    description: 'Read one file of the repository, e.g. "src/routes/orders.ts".',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative to the repository root.' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  write_file: {
    name: 'write_file',
    description: 'Create or replace one file with the full new content (up to 100 000 bytes).',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  run_tests: {
    name: 'run_tests',
    description: 'Run the repository tests (tests/**/*.test.ts) and get the passed and failed tests.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  submit_plan: {
    name: 'submit_plan',
    description:
      'Submit the plan for the human gate. Nothing is coded before a person (or the policy) approves it.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'What the Engineer will do, in order.',
        },
        acceptance: {
          type: 'array',
          items: { type: 'string' },
          description: 'Testable acceptance criteria.',
        },
        files: { type: 'array', items: { type: 'string' }, description: 'Files you expect to change.' },
        estimateUsd: { type: 'number', description: 'Your estimate of the cost of the rest of the run.' },
      },
      required: ['steps', 'acceptance', 'files', 'estimateUsd'],
      additionalProperties: false,
    },
  },
  submit_review: {
    name: 'submit_review',
    description: 'Submit your review of the diff: approve, or ask for changes with comments.',
    inputSchema: {
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['approve', 'changes'] },
        comments: { type: 'array', items: { type: 'string' } },
      },
      required: ['verdict', 'comments'],
      additionalProperties: false,
    },
  },
}

export interface ToolOutcome {
  ok: boolean
  /** What the model reads back. */
  output: unknown
  /** Set by the terminal tools: the step ends with this result. */
  plan?: Plan
  review?: Review
  tests?: TestReport
}

/** A tool error the model can act on. */
const fail = (message: string): ToolOutcome => ({ ok: false, output: { error: message } })

/** The checked relative path, or an error message. */
export function checkPath(raw: string): { file: string } | { error: string } {
  if (path.isAbsolute(raw) || /^[a-zA-Z]:/.test(raw))
    return { error: `Use a path relative to the repository, not "${raw}".` }
  const file = path.posix.normalize(raw.replaceAll('\\', '/'))
  if (file.startsWith('..')) return { error: `"${raw}" is outside the repository.` }
  const top = file.split('/')[0] ?? ''
  if (!(REPO_FOLDERS as readonly string[]).includes(top)) {
    return { error: `Only src/ and tests/ are part of the work; "${raw}" is not.` }
  }
  if (file.split('/').some((part) => part.startsWith('.'))) return { error: `"${raw}" is a hidden path.` }
  return { file }
}

export interface ToolContext {
  agent: Agent
  repoDir: string
  testTimeoutMs?: number
}

/** Runs one tool call. Never throws for a bad call: the model gets the error and can try again. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(AGENT_TOOLS[ctx.agent] as string[]).includes(name)) {
    return fail(`The ${ctx.agent} has no tool "${name}". Tools: ${AGENT_TOOLS[ctx.agent].join(', ')}.`)
  }
  const schema = INPUTS[name as ToolName]
  const parsed = v.safeParse(schema, input)
  if (!parsed.success) {
    const issue = parsed.issues[0]
    return fail(
      `Invalid input${issue ? ` at ${v.getDotPath(issue) ?? 'root'}` : ''}: ${issue?.message ?? 'unknown'}`,
    )
  }
  const args = parsed.output as Record<string, unknown>

  switch (name as ToolName) {
    case 'list_files': {
      const files = [...readTree(ctx.repoDir)].map(([file, content]) => ({
        path: file,
        bytes: Buffer.byteLength(content),
      }))
      return { ok: true, output: { files } }
    }
    case 'read_file': {
      const checked = checkPath(args.path as string)
      if ('error' in checked) return fail(checked.error)
      const full = path.join(ctx.repoDir, checked.file)
      if (!existsSync(full) || !statSync(full).isFile()) return fail(`There is no file "${checked.file}".`)
      return { ok: true, output: { path: checked.file, content: readFileSync(full, 'utf8') } }
    }
    case 'write_file': {
      const checked = checkPath(args.path as string)
      if ('error' in checked) return fail(checked.error)
      const top = checked.file.split('/')[0] as string
      if (!WRITABLE[ctx.agent].includes(top)) {
        return fail(
          `The ${ctx.agent} may write only in ${WRITABLE[ctx.agent].map((f) => `${f}/`).join(' and ')}.`,
        )
      }
      const full = path.join(ctx.repoDir, checked.file)
      mkdirSync(path.dirname(full), { recursive: true })
      writeFileSync(full, args.content as string)
      return { ok: true, output: { path: checked.file, bytes: Buffer.byteLength(args.content as string) } }
    }
    case 'run_tests': {
      const tests = await runVitest(ctx.repoDir, { timeoutMs: ctx.testTimeoutMs })
      return { ok: tests.error === undefined && tests.failed === 0, output: tests, tests }
    }
    case 'submit_plan': {
      const plan = args as unknown as Plan
      for (const file of plan.files) {
        const checked = checkPath(file)
        if ('error' in checked) return fail(`Plan file ${checked.error}`)
      }
      return { ok: true, output: { submitted: true }, plan }
    }
    case 'submit_review':
      return { ok: true, output: { submitted: true }, review: args as unknown as Review }
  }
}
