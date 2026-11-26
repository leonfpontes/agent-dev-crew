import { describe, expect, it } from 'vitest'

import { parseRequests } from './index.js'

// Example data, not the real requests (those come with the data story).
const example = {
  id: 'cancel-order',
  title: 'Add an order cancellation endpoint',
  request: 'Customers can cancel an order while it is still pending; refund the full amount.',
  hiddenTests: ['cancel-order.test.ts'],
}

describe('parseRequests', () => {
  it('accepts well-formed requests', () => {
    expect(parseRequests([example])).toEqual([example])
  })

  it('names the field that is wrong', () => {
    expect(() => parseRequests([{ ...example, id: 'Cancel Order' }])).toThrow(/at 0\.id/)
    expect(() => parseRequests([{ ...example, hiddenTests: [] }])).toThrow(/at 0\.hiddenTests/)
  })

  it('rejects duplicate ids', () => {
    expect(() => parseRequests([example, example])).toThrow('Request ids must be unique.')
  })
})
