import { describe, expect, it } from 'vitest'

import { count, parseDiff, parseHunks, splitPath } from './diff'

const GIT = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -4,3 +4,4 @@ export function a()
 keep
-old
+new one
+new two
 tail
diff --git a/tests/b.test.ts b/tests/b.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/b.test.ts
@@ -0,0 +1,2 @@
+import { it } from 'vitest'
+it('works', () => {})
`

describe('diffs', () => {
  it('splits a git diff into files with counts', () => {
    const files = parseDiff(GIT)
    expect(files.map((f) => [f.path, f.isNew, f.additions, f.deletions])).toEqual([
      ['src/a.ts', false, 2, 1],
      ['tests/b.test.ts', true, 2, 0],
    ])
  })

  it('numbers new and context lines from the new side, removed lines from the old side', () => {
    const lines = parseHunks('@@ -4,3 +4,4 @@\n keep\n-old\n+new one\n tail\n')
    expect(lines.map((l) => [l.type, l.n])).toEqual([
      ['hunk', null],
      ['ctx', 4],
      ['del', 5],
      ['add', 5],
      ['ctx', 6],
    ])
    expect(count(lines, 'add')).toBe(1)
  })

  it('reads an empty diff as no files', () => {
    expect(parseDiff(null)).toEqual([])
    expect(parseDiff('')).toEqual([])
  })

  it('splits a path into folder and name', () => {
    expect(splitPath('src/routes/orders.ts')).toEqual({ dir: 'src/routes/', name: 'orders.ts' })
    expect(splitPath('README.md')).toEqual({ dir: '', name: 'README.md' })
  })
})
