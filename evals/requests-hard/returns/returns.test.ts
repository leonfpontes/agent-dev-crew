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

const TOM = 'TOM-HEIR-500'
const APL = 'APL-GALA-1KG'
const DAY = 24 * 3600
const LINES_ERROR = 'lines must be a non-empty list of { sku, quantity }'

/** A shipped order of 3 tomatoes and 2 bags of apples: subtotal 2460, tax 197, total 2657. */
async function shippedOrder(a = api()) {
  const placed = await a.order('cus_ada', [
    [TOM, 3],
    [APL, 2],
  ])
  const id = placed.body.id as string
  await a.post(`/orders/${id}/pay`)
  await a.post(`/orders/${id}/ship`)
  return { a, id }
}

const giveBack = (a: ReturnType<typeof api>, id: string, lines: [string, number][]) =>
  a.post(`/orders/${id}/returns`, { lines: lines.map(([sku, quantity]) => ({ sku, quantity })) })

describe('returns', () => {
  it('refunds a return with its share of the tax, and lists it on the order', async () => {
    const { a, id } = await shippedOrder()
    expect((await a.get(`/orders/${id}`)).body).toMatchObject({
      subtotalCents: 2460,
      taxCents: 197,
      totalCents: 2657,
    })
    expect((await a.get(`/orders/${id}`)).body).toMatchObject({ returns: [], refundedCents: 0 })
    a.tick(3600)
    const res = await giveBack(a, id, [[TOM, 1]])
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      status: 'shipped',
      refundedCents: 562,
      returns: [
        {
          id: 'ret_1',
          lines: [{ sku: TOM, quantity: 1 }],
          refundCents: 562,
          feeCents: 0,
          at: '2026-11-20T11:00:00.000Z',
        },
      ],
    })
  })

  it('makes the last return refund what is left, so the refunds add up to the total without fees, and marks the order returned', async () => {
    const { a, id } = await shippedOrder()
    const refunds: number[] = []
    for (const lines of [[[TOM, 1]], [[APL, 2]], [[TOM, 1]], [[TOM, 1]]] as [string, number][][]) {
      const res = await giveBack(a, id, lines)
      expect(res.status).toBe(201)
      refunds.push(res.body.returns.at(-1).refundCents)
    }
    expect(refunds).toEqual([562, 972, 562, 561])
    const order = (await a.get(`/orders/${id}`)).body
    expect(order).toMatchObject({ status: 'returned', refundedCents: 2657 })
    expect(order.returns.map((r: { id: string }) => r.id)).toEqual(['ret_1', 'ret_2', 'ret_3', 'ret_4'])
    expect(await giveBack(a, id, [[TOM, 1]])).toMatchObject({
      status: 409,
      body: { error: 'A returned order cannot be returned' },
    })
  })

  it('puts the returned units back into stock', async () => {
    const { a, id } = await shippedOrder()
    await giveBack(a, id, [
      [TOM, 2],
      [APL, 1],
    ])
    expect((await a.app.db.products.find(TOM))?.stock).toBe(22)
    expect((await a.app.db.products.find(APL))?.stock).toBe(41)
  })

  it('takes returns for less than 30 days after the order was placed', async () => {
    const a = api()
    const late = await shippedOrder(a)
    const onTime = await shippedOrder(a)
    a.tick(30 * DAY - 1)
    expect((await giveBack(a, onTime.id, [[TOM, 1]])).status).toBe(201)
    a.tick(1)
    expect(await giveBack(a, late.id, [[TOM, 1]])).toMatchObject({
      status: 409,
      body: { error: 'The return window has closed' },
    })
  })

  it('takes returns only for shipped orders', async () => {
    const a = api()
    const pending = await a.order('cus_ben', [[TOM, 1]])
    expect(await giveBack(a, pending.body.id, [[TOM, 1]])).toMatchObject({
      status: 409,
      body: { error: 'A pending order cannot be returned' },
    })
    await a.post(`/orders/${pending.body.id}/pay`)
    a.tick(31 * DAY)
    expect(await giveBack(a, pending.body.id, [[TOM, 1]])).toMatchObject({
      status: 409,
      body: { error: 'A paid order cannot be returned' },
    })
    expect(await giveBack(a, 'ord_9999', [[TOM, 1]])).toMatchObject({
      status: 404,
      body: { error: 'Order not found' },
    })
  })

  it('refuses bad lines (400), SKUs not in the order and more than is left to return (422), recording nothing', async () => {
    const { a, id } = await shippedOrder()
    for (const body of [
      {},
      { lines: [] },
      { lines: [{ sku: TOM, quantity: 0 }] },
      { lines: [{ sku: TOM }] },
    ]) {
      expect(await a.post(`/orders/${id}/returns`, body), JSON.stringify(body)).toMatchObject({
        status: 400,
        body: { error: LINES_ERROR },
      })
    }
    expect(
      await giveBack(a, id, [
        [TOM, 1],
        [TOM, 1],
      ]),
    ).toMatchObject({ status: 400, body: { error: LINES_ERROR } })
    expect(
      await giveBack(a, id, [
        [TOM, 1],
        ['EGG-FREE-12', 1],
      ]),
    ).toMatchObject({ status: 422, body: { error: 'Cannot return 1 of EGG-FREE-12' } })
    expect((await giveBack(a, id, [[TOM, 2]])).status).toBe(201)
    expect(await giveBack(a, id, [[TOM, 2]])).toMatchObject({
      status: 422,
      body: { error: 'Cannot return 2 of TOM-HEIR-500' },
    })
    const order = (await a.get(`/orders/${id}`)).body
    expect(order.returns).toHaveLength(1)
    expect((await a.app.db.products.find(TOM))?.stock).toBe(22)
    expect((await a.app.db.products.find('EGG-FREE-12'))?.stock).toBe(30)
  })

  it('keeps a 10% restocking fee from 14 days on, and the last return refunds what is left minus its fee', async () => {
    const { a, id } = await shippedOrder()
    a.tick(14 * DAY)
    const steps: [number, number][] = []
    for (const lines of [[[TOM, 1]], [[APL, 2]], [[TOM, 2]]] as [string, number][][]) {
      const res = await giveBack(a, id, lines)
      expect(res.status).toBe(201)
      const last = res.body.returns.at(-1)
      steps.push([last.refundCents, last.feeCents])
    }
    expect(steps).toEqual([
      [510, 52],
      [882, 90],
      [1019, 104],
    ])
    expect((await a.get(`/orders/${id}`)).body).toMatchObject({ status: 'returned', refundedCents: 2411 })
  })

  it('charges no fee until exactly 14 days after the order', async () => {
    const { a, id } = await shippedOrder()
    a.tick(14 * DAY - 1)
    expect((await giveBack(a, id, [[TOM, 1]])).body.returns[0]).toMatchObject({
      refundCents: 562,
      feeCents: 0,
    })
    a.tick(1)
    expect((await giveBack(a, id, [[TOM, 1]])).body.returns[1]).toMatchObject({
      refundCents: 510,
      feeCents: 52,
    })
  })
})
