// A small line diff (longest common subsequence) that writes the unified format git uses, so a
// playbook version can store the change the retro proposed. Playbooks are short; O(n·m) is fine.

/** One line of the diff; `a` and `b` are the 0-based positions in the old and new text before it. */
type Op = { type: ' ' | '-' | '+'; line: string; a: number; b: number }

function ops(a: string[], b: string[]): Op[] {
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: Op[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const at = { a: i, b: j }
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ type: ' ', line: a[i]!, ...at })
      i++
      j++
    } else if (i < a.length && (j === b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) {
      out.push({ type: '-', line: a[i]!, ...at })
      i++
    } else {
      out.push({ type: '+', line: b[j]!, ...at })
      j++
    }
  }
  return out
}

const lines = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'))

/**
 * Unified diff from `before` to `after` with `context` lines around each change, without the
 * file header. Empty when the two are equal.
 */
export function unifiedDiff(before: string, after: string, context = 2): string {
  const all = ops(lines(before), lines(after))
  const changed = all.map((op, k) => (op.type === ' ' ? -1 : k)).filter((k) => k >= 0)
  if (changed.length === 0) return ''
  const hunks: [number, number][] = []
  for (const k of changed) {
    const start = Math.max(0, k - context)
    const end = Math.min(all.length - 1, k + context)
    const last = hunks[hunks.length - 1]
    if (last && start <= last[1] + 1) last[1] = end
    else hunks.push([start, end])
  }
  const out: string[] = []
  // git's ranges: "start,count", or just "start" for one line; an empty side names the line before.
  const range = (pos: number, count: number) =>
    count === 1 ? `${pos + 1}` : `${count === 0 ? pos : pos + 1},${count}`
  for (const [start, end] of hunks) {
    const slice = all.slice(start, end + 1)
    const first = all[start]!
    const oldCount = slice.filter((o) => o.type !== '+').length
    const newCount = slice.filter((o) => o.type !== '-').length
    out.push(`@@ -${range(first.a, oldCount)} +${range(first.b, newCount)} @@`)
    for (const o of slice) out.push(`${o.type}${o.line}`)
  }
  return out.join('\n') + '\n'
}

/** Lines added and removed by a unified diff. */
export function diffStat(diff: string): { added: number; removed: number } {
  const body = diff.split('\n').filter((l) => !l.startsWith('+++') && !l.startsWith('---'))
  return {
    added: body.filter((l) => l.startsWith('+')).length,
    removed: body.filter((l) => l.startsWith('-')).length,
  }
}
