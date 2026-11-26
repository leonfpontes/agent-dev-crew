// The throwaway copy of the example repository a run works in. Only `src/` and `tests/` are copied;
// the files the sandboxed test runner needs are written by @crew/sandbox. The diff of a run is the
// change from the original files, as the "pull request" the app shows.

import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

import { prepareForVitest, realPath } from '@crew/sandbox'
import { unifiedDiff } from '@crew/trace'

/** The folders of the repository the crew may see and change. */
export const REPO_FOLDERS = ['src', 'tests'] as const

export interface Workspace {
  /** Real path of the copy. */
  dir: string
  /** `<name>@<short hash of the original files>`, e.g. `fernhill-orders@9c2e71b`. */
  repoRef: string
  /** The original files, by relative path, for the diff. */
  original: Map<string, string>
}

/** Every file under the repository folders, by relative path (POSIX separators). */
export function readTree(root: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile())
        files.set(path.relative(root, full).split(path.sep).join('/'), readFileSync(full, 'utf8'))
    }
  }
  for (const folder of REPO_FOLDERS) if (existsSync(path.join(root, folder))) walk(path.join(root, folder))
  return files
}

/** `<folder name>@<short hash of src/ and tests/>`: which version of the example a run started from. */
export function repoRefOf(exampleDir: string, files = readTree(exampleDir)): string {
  const hash = createHash('sha256')
  for (const [file, content] of files) hash.update(`${file}\0${content}\0`)
  return `${path.basename(exampleDir)}@${hash.digest('hex').slice(0, 7)}`
}

/** Copies the example into `<workRoot>/run-<runId>/repo`, replacing an older copy. */
export function createWorkspace(exampleDir: string, workRoot: string, runId: number): Workspace {
  const original = readTree(exampleDir)
  const dir = path.join(workRoot, `run-${runId}`, 'repo')
  rmSync(path.dirname(dir), { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const folder of REPO_FOLDERS) {
    const from = path.join(exampleDir, folder)
    if (existsSync(from) && statSync(from).isDirectory())
      cpSync(from, path.join(dir, folder), { recursive: true })
  }
  prepareForVitest(dir)
  return { dir: realPath(dir), repoRef: repoRefOf(exampleDir, original), original }
}

/** The unified diff of the run: every changed, added or removed file, with git-style headers. */
export function workspaceDiff(ws: Workspace): string {
  const now = readTree(ws.dir)
  const files = [...new Set([...ws.original.keys(), ...now.keys()])].sort()
  const parts: string[] = []
  for (const file of files) {
    const before = ws.original.get(file)
    const after = now.get(file)
    if (before === after) continue
    const body = unifiedDiff(before ?? '', after ?? '')
    const from = before === undefined ? '/dev/null' : `a/${file}`
    const to = after === undefined ? '/dev/null' : `b/${file}`
    parts.push(`diff --git a/${file} b/${file}\n--- ${from}\n+++ ${to}\n${body}`.trimEnd())
  }
  return parts.join('\n')
}
