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

const stockOf = async (a: ReturnType<typeof api>) => {
  const res = await a.get('/products')
  return Object.fromEntries(res.body.items.map((p: { sku: string; stock: number }) => [p.sku, p.stock]))
}

describe('reserve stock when orders are placed and cancelled', () => {
  it('lists the products with their stock, in catalog order', async () => {
    const res = await api().get('/products')
    expect(res.status).toBe(200)
    expect(res.body.items.map((p: { sku: string }) => p.sku)).toEqual([
      'APL-GALA-1KG',
      'BRD-SOUR-800',
      'EGG-FREE-12',
      'MLK-OAT-1L',
      'CHS-CHED-200',
      'COF-BEAN-500',
      'HNY-WILD-350',
      'TOM-HEIR-500',
    ])
    expect(res.body.items[0]).toEqual({
      sku: 'APL-GALA-1KG',
      name: 'Gala apples, 1 kg',
      unitCents: 450,
      stock: 40,
    })
    expect(res.body.items[6]).toMatchObject({ sku: 'HNY-WILD-350', stock: 0 })
  })

  it('takes each line out of stock when the order is placed, down to zero', async () => {
    const a = api()
    expect(
      (
        await a.order('cus_ada', [
          ['APL-GALA-1KG', 3],
          ['CHS-CHED-200', 2],
        ])
      ).status,
    ).toBe(201)
    expect(await stockOf(a)).toMatchObject({ 'APL-GALA-1KG': 37, 'CHS-CHED-200': 6, 'BRD-SOUR-800': 12 })
    expect((await a.order('cus_ben', [['APL-GALA-1KG', 37]])).status).toBe(201)
    expect((await stockOf(a))['APL-GALA-1KG']).toBe(0)
  })

  it('refuses an order with a line above the stock left (409), naming the first such line, and changes nothing', async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [
      ['APL-GALA-1KG', 2],
      ['CHS-CHED-200', 9],
      ['HNY-WILD-350', 1],
    ])
    expect(await a.post('/orders', { cartId })).toMatchObject({
      status: 409,
      body: { error: 'Not enough stock for CHS-CHED-200' },
    })
    expect((await a.get(`/carts/${cartId}`)).body.lines).toHaveLength(3)
    expect((await a.get('/orders')).body.items).toEqual([])
    expect(await stockOf(a)).toMatchObject({ 'APL-GALA-1KG': 40, 'CHS-CHED-200': 8 })

    expect((await a.order('cus_ben', [['CHS-CHED-200', 5]])).status).toBe(201)
    expect(await a.order('cus_cleo', [['CHS-CHED-200', 4]])).toMatchObject({
      status: 409,
      body: { error: 'Not enough stock for CHS-CHED-200' },
    })
    expect((await stockOf(a))['CHS-CHED-200']).toBe(3)
  })

  it('refuses a SKU that is not in the catalog (422); the first failing line in cart order decides', async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [
      ['APL-GALA-1KG', 1],
      ['XYZ-NOPE-1', 2],
      ['HNY-WILD-350', 1],
    ])
    expect(await a.post('/orders', { cartId })).toMatchObject({
      status: 422,
      body: { error: 'Unknown SKU XYZ-NOPE-1' },
    })
    expect(
      await a.order('cus_ben', [
        ['HNY-WILD-350', 1],
        ['XYZ-NOPE-1', 1],
      ]),
    ).toMatchObject({ status: 409, body: { error: 'Not enough stock for HNY-WILD-350' } })
    expect((await a.get(`/carts/${cartId}`)).body.lines).toHaveLength(3)
    expect((await a.get('/orders')).body.items).toEqual([])
    expect((await stockOf(a))['APL-GALA-1KG']).toBe(40)
  })

  it('cancels a pending or paid order and puts its quantities back; refuses shipped, cancelled and unknown orders', async () => {
    const a = api()
    const pending = await a.order('cus_ada', [['COF-BEAN-500', 4]])
    const paid = await a.order('cus_ben', [['COF-BEAN-500', 5]])
    await a.post(`/orders/${paid.body.id}/pay`)
    const shipped = await a.order('cus_cleo', [['COF-BEAN-500', 1]])
    await a.post(`/orders/${shipped.body.id}/pay`)
    await a.post(`/orders/${shipped.body.id}/ship`)
    expect((await stockOf(a))['COF-BEAN-500']).toBe(5)

    const cancelled = await a.post(`/orders/${pending.body.id}/cancel`)
    expect(cancelled).toMatchObject({ status: 200, body: { id: pending.body.id, status: 'cancelled' } })
    expect((await a.post(`/orders/${paid.body.id}/cancel`)).body.status).toBe('cancelled')
    expect((await stockOf(a))['COF-BEAN-500']).toBe(14)

    expect(await a.post(`/orders/${shipped.body.id}/cancel`)).toMatchObject({
      status: 409,
      body: { error: 'A shipped order cannot be cancelled' },
    })
    expect(await a.post(`/orders/${pending.body.id}/cancel`)).toMatchObject({
      status: 409,
      body: { error: 'A cancelled order cannot be cancelled' },
    })
    expect((await stockOf(a))['COF-BEAN-500']).toBe(14)
    expect(await a.post('/orders/ord_9999/cancel')).toMatchObject({
      status: 404,
      body: { error: 'Order not found' },
    })
  })

  it('keeps cancelled orders from being paid or shipped, and out of the daily total', async () => {
    const a = api()
    const kept = await a.order('cus_ada', [['APL-GALA-1KG', 2]]) // 900 + 72
    const gone = await a.order('cus_ben', [['BRD-SOUR-800', 1]])
    await a.post(`/orders/${gone.body.id}/cancel`)
    expect(await a.post(`/orders/${gone.body.id}/pay`)).toMatchObject({
      status: 409,
      body: { error: 'A cancelled order cannot be paid' },
    })
    expect(await a.post(`/orders/${gone.body.id}/ship`)).toMatchObject({
      status: 409,
      body: { error: 'A cancelled order cannot be shipped' },
    })
    expect(kept.body.totalCents).toBe(972)
    expect((await a.get('/reports/daily-total?date=2026-11-20')).body.totalCents).toBe(972)
  })
})
