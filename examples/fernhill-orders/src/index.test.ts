import { describe, expect, it } from 'vitest'

import { formatCents } from './index.js'

describe('formatCents', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(8400)).toBe('$84.00')
    expect(formatCents(-1950)).toBe('-$19.50')
  })

  it('refuses fractions of a cent', () => {
    expect(() => formatCents(1.5)).toThrow('Amounts are whole cents, got 1.5.')
  })
})
