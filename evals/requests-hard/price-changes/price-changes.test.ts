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

const APL = 'APL-GALA-1KG'
const setPrice = (a: ReturnType<typeof api>, sku: string, unitCents: unknown) =>
  a.post(`/products/${sku}/price`, { unitCents })

describe('price changes', () => {
  it('changes a price and keeps its history; the same price again records nothing', async () => {
    const a = api()
    expect(await setPrice(a, APL, 500)).toMatchObject({
      status: 200,
      body: { sku: APL, name: 'Gala apples, 1 kg', unitCents: 500, stock: 40 },
    })
    a.tick(3600)
    await setPrice(a, APL, 480)
    a.tick(60)
    expect((await setPrice(a, APL, 480)).status).toBe(200)
    expect((await a.get(`/products/${APL}/prices`)).body).toEqual({
      sku: APL,
      history: [
        { unitCents: 450, from: null },
        { unitCents: 500, from: '2026-11-20T10:00:00.000Z' },
        { unitCents: 480, from: '2026-11-20T11:00:00.000Z' },
      ],
    })
  })

  it("shows a cart at today's prices", async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [[APL, 2]])
    await setPrice(a, APL, 500)
    expect((await a.get(`/carts/${cartId}`)).body.lines).toEqual([
      { sku: APL, name: 'Gala apples, 1 kg', unitCents: 500, quantity: 2, lineCents: 1000 },
    ])
  })

  it("prices every line at today's price when items are added after a change", async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [[APL, 1]])
    await setPrice(a, APL, 480)
    const more = await a.post(`/carts/${cartId}/items`, { sku: APL, quantity: 1 })
    expect(more.body.lines).toEqual([
      { sku: APL, name: 'Gala apples, 1 kg', unitCents: 480, quantity: 2, lineCents: 960 },
    ])
    await setPrice(a, APL, 400)
    const other = await a.post(`/carts/${cartId}/items`, { sku: 'MLK-OAT-1L', quantity: 1 })
    expect(other.body.lines).toEqual([
      { sku: APL, name: 'Gala apples, 1 kg', unitCents: 400, quantity: 2, lineCents: 800 },
      { sku: 'MLK-OAT-1L', name: 'Oat milk, 1 l', unitCents: 349, quantity: 1, lineCents: 349 },
    ])
  })

  it('places an order at the prices of that moment, even for items added before the change', async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [
      [APL, 2],
      ['BRD-SOUR-800', 1],
    ])
    await setPrice(a, APL, 500)
    const placed = await a.post('/orders', { cartId })
    expect(placed.body).toMatchObject({ subtotalCents: 1625, taxCents: 130, totalCents: 1755 })
    expect(placed.body.lines[0]).toEqual({
      sku: APL,
      name: 'Gala apples, 1 kg',
      unitCents: 500,
      quantity: 2,
      lineCents: 1000,
    })
  })

  it('never changes an order already placed: not the order, its receipt or the daily total', async () => {
    const a = api()
    const placed = await a.order('cus_ada', [[APL, 2]])
    await setPrice(a, APL, 999)
    expect((await a.get(`/orders/${placed.body.id}`)).body).toEqual(placed.body)
    const receipt = (await a.get(`/orders/${placed.body.id}/receipt`)).text.split('\n')
    expect(receipt).toContain('2 × Gala apples, 1 kg  $9.00')
    expect(receipt).toContain('Total  $9.72')
    expect((await a.get('/reports/daily-total?date=2026-11-20')).body.totalCents).toBe(972)
  })

  it('refuses a price that is not a whole number above 0 (400) and an unknown product (404)', async () => {
    const a = api()
    for (const unitCents of [0, -5, 1.5, '500', undefined]) {
      expect(await setPrice(a, APL, unitCents), String(unitCents)).toMatchObject({
        status: 400,
        body: { error: 'unitCents must be a whole number above 0' },
      })
    }
    expect((await a.get(`/products/${APL}/prices`)).body.history).toHaveLength(1)
    expect(await setPrice(a, 'XYZ-NOPE-1', 500)).toMatchObject({
      status: 404,
      body: { error: 'Product not found' },
    })
    expect(await a.get('/products/XYZ-NOPE-1/prices')).toMatchObject({
      status: 404,
      body: { error: 'Product not found' },
    })
  })
})
