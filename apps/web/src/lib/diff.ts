// Unified diffs as the trace stores them: the run's git diff, and the playbook's version diffs
// (hunks only, no file header). One line-number column, as on GitHub's split-free view: the new
// number for added and context lines, the old one for removed lines.

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk'
  /** The line number shown in the gutter; null for hunk headers. */
  n: number | null
  text: string
}

export interface DiffFile {
  path: string
  isNew: boolean
  additions: number
  deletions: number
  lines: DiffLine[]
}

/** The lines of one or more hunks (`@@ -a,b +c,d @@ …` and what follows). */
export function parseHunks(text: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  for (const raw of text.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (hunk) {
      oldNo = Number(hunk[1])
      newNo = Number(hunk[2])
      lines.push({ type: 'hunk', n: null, text: raw })
      continue
    }
    if (lines.length === 0) continue
    if (raw.startsWith('+')) lines.push({ type: 'add', n: newNo++, text: raw.slice(1) })
    else if (raw.startsWith('-')) lines.push({ type: 'del', n: oldNo++, text: raw.slice(1) })
    else if (raw.startsWith('\\')) continue
    else {
      lines.push({ type: 'ctx', n: newNo++, text: raw.startsWith(' ') ? raw.slice(1) : raw })
      oldNo++
    }
  }
  // A trailing newline in the text leaves one empty context line: drop it.
  const last = lines.at(-1)
  if (last && last.type === 'ctx' && last.text === '') lines.pop()
  return lines
}

export const count = (lines: DiffLine[], type: 'add' | 'del') => lines.filter((l) => l.type === type).length

/** A `git diff` with one or more files. */
export function parseDiff(diff: string | null | undefined): DiffFile[] {
  if (!diff) return []
  return diff
    .split(/^diff --git /m)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const header = chunk.split('\n', 1)[0] ?? ''
      const plus = /^\+\+\+ b\/(.+)$/m.exec(chunk)
      const path = plus?.[1] ?? header.replace(/^a\/\S+ b\//, '')
      const start = chunk.search(/^@@ /m)
      const lines = start < 0 ? [] : parseHunks(chunk.slice(start))
      return {
        path,
        isNew: /^new file mode/m.test(chunk),
        additions: count(lines, 'add'),
        deletions: count(lines, 'del'),
        lines,
      }
    })
}

/** "src/routes/" and "orders.ts". */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}
