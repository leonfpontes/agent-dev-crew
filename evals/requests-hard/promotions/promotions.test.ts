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
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.fetch(
      new Request(`http://fernhill.test${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    const text = await res.text()
    return { status: res.status, headers: res.headers, text, body: parse(text) }
  }
  const get = (path: string) => call('GET', path)
  const post = (path: string, body: unknown = {}, headers: Record<string, string> = {}) =>
    call('POST', path, body, headers)
  const cart = async (customerId: string, items: [string, number][]) => {
    const created = await post('/carts', { customerId })
    for (const [sku, quantity] of items) await post(`/carts/${created.body.id}/items`, { sku, quantity })
    return created.body.id as string
  }
  const order = async (customerId: string, items: [string, number][], extra: object = {}) =>
    post('/orders', { cartId: await cart(customerId, items), ...extra })
  const at = (iso: string) => {
    now = new Date(iso)
  }
  const tick = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000)
  }
  return { app, get, post, call, cart, order, at, tick }
}

describe('multi-buy promotions', () => {
  it('Apples 3 for 2: every third unit of APL-GALA-1KG is free', async () => {
    const res = await api().order('cus_ada', [['APL-GALA-1KG', 7]])
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      subtotalCents: 3150,
      discountCents: 900,
      promotions: [{ name: 'Apples 3 for 2', discountCents: 900 }],
      taxCents: 180,
      totalCents: 2430,
    })
  })

  it('applies nothing under three apples', async () => {
    const res = await api().order('cus_ada', [['APL-GALA-1KG', 2]])
    expect(res.body).toMatchObject({
      subtotalCents: 900,
      discountCents: 0,
      promotions: [],
      taxCents: 72,
      totalCents: 972,
    })
  })

  it('Coffee and milk: $1.50 off each pair of one bag of coffee and one oat milk', async () => {
    const res = await api().order('cus_ben', [
      ['COF-BEAN-500', 3],
      ['MLK-OAT-1L', 2],
    ])
    expect(res.body).toMatchObject({
      subtotalCents: 5195,
      discountCents: 300,
      promotions: [{ name: 'Coffee and milk', discountCents: 300 }],
      taxCents: 392,
      totalCents: 5287,
    })
  })

  it('lists both promotions in the order of the request, whatever the order of the lines', async () => {
    const res = await api().order('cus_cleo', [
      ['COF-BEAN-500', 1],
      ['MLK-OAT-1L', 1],
      ['APL-GALA-1KG', 3],
    ])
    expect(res.body).toMatchObject({
      subtotalCents: 3198,
      discountCents: 600,
      promotions: [
        { name: 'Apples 3 for 2', discountCents: 450 },
        { name: 'Coffee and milk', discountCents: 150 },
      ],
      taxCents: 208,
      totalCents: 2806,
    })
  })

  it('rounds the tax once for the whole order, also without a promotion', async () => {
    const res = await api().order('cus_ada', [
      ['MLK-OAT-1L', 2],
      ['TOM-HEIR-500', 1],
    ])
    expect(res.body).toMatchObject({ subtotalCents: 1218, discountCents: 0, taxCents: 97, totalCents: 1315 })
  })

  it('prints one receipt line per promotion right after the Subtotal, and the daily total uses the new totals', async () => {
    const a = api()
    const placed = await a.order('cus_ben', [
      ['COF-BEAN-500', 1],
      ['MLK-OAT-1L', 1],
      ['APL-GALA-1KG', 3],
    ])
    const lines = (await a.get(`/orders/${placed.body.id}/receipt`)).text.split('\n')
    const at = lines.indexOf('Subtotal  $31.98')
    expect(at).toBeGreaterThan(0)
    expect(lines.slice(at, at + 5)).toEqual([
      'Subtotal  $31.98',
      'Apples 3 for 2  -$4.50',
      'Coffee and milk  -$1.50',
      'Tax  $2.08',
      'Total  $28.06',
    ])
    const plain = await a.order('cus_ada', [['COF-BEAN-500', 1]])
    const plainLines = (await a.get(`/orders/${plain.body.id}/receipt`)).text.split('\n')
    const s = plainLines.indexOf('Subtotal  $14.99')
    expect(plainLines.slice(s, s + 3)).toEqual(['Subtotal  $14.99', 'Tax  $1.20', 'Total  $16.19'])
    expect((await a.get('/reports/daily-total?date=2026-11-20')).body.totalCents).toBe(2806 + 1619)
  })
})
