import { describe, expect, it } from 'vitest'

import { diffStat, unifiedDiff } from './index.js'

// Expected outputs are what `diff -U2` prints for the same inputs, without the file header.
describe('unifiedDiff', () => {
  it('writes an added line with its context', () => {
    expect(unifiedDiff('a\nb\nc\nd\ne\n', 'a\nb\nX\nc\nd\ne\n')).toBe('@@ -1,4 +1,5 @@\n a\n b\n+X\n c\n d\n')
  })

  it('writes a changed line as a removal and an addition', () => {
    expect(unifiedDiff('a\nb\nc\n', 'a\nB\nc\n')).toBe('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n')
  })

  it('writes a new file from line 0', () => {
    expect(unifiedDiff('', 'one\ntwo\n')).toBe('@@ -0,0 +1,2 @@\n+one\n+two\n')
  })

  it('splits far-apart changes into hunks and keeps near ones together', () => {
    const before = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')
    const after = before.replace('line 2', 'line two').replace('line 11', 'line eleven')
    const diff = unifiedDiff(before, after, 1)
    expect(diff.match(/^@@/gm)).toHaveLength(2)
    expect(diff).toContain('@@ -1,3 +1,3 @@')
    expect(diff).toContain('@@ -10,3 +10,3 @@')
    expect(unifiedDiff(before, after, 5).match(/^@@/gm)).toHaveLength(1)
  })

  it('is empty when nothing changed', () => {
    expect(unifiedDiff('same\n', 'same\n')).toBe('')
  })
})

describe('diffStat', () => {
  it('counts added and removed lines, not the file headers', () => {
    expect(diffStat('--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n-old\n+new\n+more\n')).toEqual({ added: 2, removed: 1 })
  })
})
