import { describe, expect, it } from 'vitest'

import { MAX_FIX_LOOPS, ROLES, topologicalOrder } from './index.js'

const pipeline = [
  { id: 'po', after: [] },
  { id: 'gate', after: ['po'] },
  { id: 'engineer', after: ['gate'] },
  { id: 'reviewer', after: ['engineer'] },
  { id: 'qa', after: ['reviewer'] },
]

describe('topologicalOrder', () => {
  it('walks the crew pipeline in order, with the gate before any code', () => {
    expect(topologicalOrder(pipeline)).toEqual(['po', 'gate', 'engineer', 'reviewer', 'qa'])
  })

  it('keeps input order between nodes that are ready together', () => {
    expect(
      topologicalOrder([
        { id: 'b', after: [] },
        { id: 'a', after: [] },
        { id: 'c', after: ['a', 'b'] },
      ]),
    ).toEqual(['b', 'a', 'c'])
  })

  it('names the node that waits for a missing one', () => {
    expect(() => topologicalOrder([{ id: 'qa', after: ['tests'] }])).toThrow(
      'Node "qa" waits for "tests", which doesn\'t exist.',
    )
  })

  it('refuses a cycle and duplicate ids', () => {
    expect(() =>
      topologicalOrder([
        { id: 'a', after: ['b'] },
        { id: 'b', after: ['a'] },
      ]),
    ).toThrow('The pipeline has a cycle between: a, b.')
    expect(() =>
      topologicalOrder([
        { id: 'a', after: [] },
        { id: 'a', after: [] },
      ]),
    ).toThrow('same id')
  })
})

describe('contracts', () => {
  it('has the four roles in pipeline order and at most two fix loops', () => {
    expect(ROLES).toEqual(['po', 'engineer', 'reviewer', 'qa'])
    expect(MAX_FIX_LOOPS).toBe(2)
  })
})
