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

async function receiptLines() {
  const a = api()
  const placed = await a.order('cus_ben', [
    ['BRD-SOUR-800', 1],
    ['EGG-FREE-12', 1],
  ])
  return (await a.get(`/orders/${placed.body.id}/receipt`)).text.split('\n')
}

describe('customer email on the receipt', () => {
  it('shows the email of the customer', async () => {
    expect(await receiptLines()).toContain('Email: ben.okafor@example.com')
  })

  it('puts the email right after the customer name', async () => {
    const lines = await receiptLines()
    expect(lines[lines.indexOf('Customer: Ben Okafor') + 1]).toBe('Email: ben.okafor@example.com')
  })

  it('keeps every other line as it was', async () => {
    expect((await receiptLines()).join('\n')).toBe(
      [
        'Fernhill Market',
        'Order ord_0001',
        'Customer: Ben Okafor',
        'Email: ben.okafor@example.com',
        '',
        '1 × Sourdough loaf, 800 g  $6.25',
        '1 × Free-range eggs, 12  $5.99',
        '',
        'Subtotal  $12.24',
        'Tax  $0.98',
        'Total  $13.22',
        '',
      ].join('\n'),
    )
  })
})
