// Scores a finished run with the hidden acceptance tests. They exist only in evals/, never in a
// sandbox read list while the crew works; after the run, this copies them into the run's copy at
// hidden/ and runs only them, in the sandbox, then records the result on the run.

import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import { runVitest, type TestReport } from '@crew/sandbox'
import type { TraceDb } from '@crew/trace'

import { recordHiddenTests } from './recorder.js'

export async function scoreHiddenTests(
  trace: TraceDb,
  runId: number,
  repoDir: string,
  hiddenFiles: string[],
  { timeoutMs }: { timeoutMs?: number } = {},
): Promise<TestReport> {
  const target = path.join(repoDir, 'hidden')
  mkdirSync(target, { recursive: true })
  for (const file of hiddenFiles) cpSync(file, path.join(target, path.basename(file)))
  const report = await runVitest(repoDir, { include: ['hidden/**/*.test.ts'], timeoutMs })
  recordHiddenTests(
    trace,
    runId,
    report.error ? 0 : report.passed,
    report.error ? hiddenFiles.length : report.total,
  )
  return report
}
