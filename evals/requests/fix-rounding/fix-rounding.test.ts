import { describe, expect, it } from 'vitest'

import { createApp, type AppOptions } from '../src/index.js'

// Hidden acceptance test: the harness copies it into the run's copy of fernhill-orders, at
// hidden/, after the crew has finished. The agents never see it.
const START = new Date('2026-11-20T10:00:00Z')

function api(options: AppOptions = {}) {
  let now = START
  const app = createApp({ ...options, now: () => now })
  const parse = (text: string) => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`http://fernhill.test${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    const text = await res.text()
    return { status: res.status, headers: res.headers, text, body: parse(text) }
  }
  const get = (path: string) => call('GET', path)
  const post = (path: string, body: unknown = {}) => call('POST', path, body)
  const order = async (customerId: string, items: [string, number][], extra: object = {}) => {
    const cart = await post('/carts', { customerId })
    for (const [sku, quantity] of items) await post(`/carts/${cart.body.id}/items`, { sku, quantity })
    return post('/orders', { cartId: cart.body.id, ...extra })
  }
  const tick = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000)
  }
  return { get, post, order, tick }
}

describe('round the tax on the subtotal', () => {
  it('charges 8% of the subtotal, not the sum of each line', async () => {
    // lines 1040 and 1031: 83.2 + 82.48 per line would be 165; 8% of 2071 is 165.68 → 166
    const res = await api().order('cus_ada', [
      ['TOM-HEIR-500', 2],
      ['CHS-CHED-200', 1],
    ])
    expect(res.body).toMatchObject({ subtotalCents: 2071, taxCents: 166, totalCents: 2237 })
  })

  it('fixes another order that was a cent short', async () => {
    const res = await api().order('cus_ada', [
      ['CHS-CHED-200', 1],
      ['TOM-HEIR-500', 4],
    ])
    expect(res.body).toMatchObject({ subtotalCents: 3111, taxCents: 249, totalCents: 3360 })
  })

  it('keeps one-line orders as they were', async () => {
    const res = await api().order('cus_ada', [['CHS-CHED-200', 2]])
    expect(res.body).toMatchObject({ subtotalCents: 2062, taxCents: 165, totalCents: 2227 })
  })

  it('prints the fixed tax on the receipt', async () => {
    const a = api()
    const placed = await a.order('cus_ada', [
      ['TOM-HEIR-500', 2],
      ['CHS-CHED-200', 1],
    ])
    const text = (await a.get(`/orders/${placed.body.id}/receipt`)).text
    expect(text).toContain('Tax  $1.66')
    expect(text).toContain('Total  $22.37')
  })
})
