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

// split-shipments
{
  const APL = 'APL-GALA-1KG'
  const BRD = 'BRD-SOUR-800'
  const LINES_ERROR = 'lines must be a non-empty list of { sku, quantity }'

  async function paidOrder(a = api()) {
    const placed = await a.order('cus_ada', [
      [APL, 3],
      [BRD, 2],
    ])
    await a.post(`/orders/${placed.body.id}/pay`)
    return { a, id: placed.body.id as string }
  }

  describe('ship an order in parts', () => {
    it('starts every order with nothing shipped and no shipments, and keeps its lines', async () => {
      const placed = await api().order('cus_ada', [
        [APL, 3],
        [BRD, 2],
      ])
      expect(placed.body).toMatchObject({ shipped: { [APL]: 0, [BRD]: 0 }, shipments: [], status: 'pending' })
      expect(placed.body.lines).toHaveLength(2)
    })

    it('records shipments: partially_shipped while units are left, shipped once every unit has gone', async () => {
      const { a, id } = await paidOrder()
      const first = await a.post(`/orders/${id}/shipments`, { lines: [{ sku: APL, quantity: 1 }] })
      expect(first.status).toBe(201)
      expect(first.body).toMatchObject({
        status: 'partially_shipped',
        shipped: { [APL]: 1, [BRD]: 0 },
        shipments: [{ id: 'shp_1', lines: [{ sku: APL, quantity: 1 }], at: '2026-11-20T10:00:00.000Z' }],
      })
      a.tick(3600)
      const second = await a.post(`/orders/${id}/shipments`, {
        lines: [
          { sku: APL, quantity: 2 },
          { sku: BRD, quantity: 2 },
        ],
      })
      expect(second.status).toBe(201)
      expect(second.body.status).toBe('shipped')
      expect(second.body.shipped).toEqual({ [APL]: 3, [BRD]: 2 })
      expect(second.body.shipments[1]).toEqual({
        id: 'shp_2',
        lines: [
          { sku: APL, quantity: 2 },
          { sku: BRD, quantity: 2 },
        ],
        at: '2026-11-20T11:00:00.000Z',
      })
      expect((await a.get(`/orders/${id}`)).body).toEqual(second.body)
    })

    it('ships everything left with /ship, as one shipment of the lines that still have units', async () => {
      const { a, id } = await paidOrder()
      await a.post(`/orders/${id}/shipments`, { lines: [{ sku: APL, quantity: 3 }] })
      const rest = await a.post(`/orders/${id}/ship`)
      expect(rest.status).toBe(200)
      expect(rest.body).toMatchObject({ status: 'shipped', shipped: { [APL]: 3, [BRD]: 2 } })
      expect(rest.body.shipments.map((s: { id: string }) => s.id)).toEqual(['shp_1', 'shp_2'])
      expect(rest.body.shipments[1].lines).toEqual([{ sku: BRD, quantity: 2 }])

      const other = await paidOrder(a)
      const whole = await a.post(`/orders/${other.id}/ship`)
      expect(whole.body.shipments).toEqual([
        {
          id: 'shp_1',
          lines: [
            { sku: APL, quantity: 3 },
            { sku: BRD, quantity: 2 },
          ],
          at: '2026-11-20T10:00:00.000Z',
        },
      ])
    })

    it('takes shipments only for paid or partially shipped orders', async () => {
      const a = api()
      const pending = await a.order('cus_ben', [[APL, 1]])
      expect(
        await a.post(`/orders/${pending.body.id}/shipments`, { lines: [{ sku: APL, quantity: 1 }] }),
      ).toMatchObject({
        status: 409,
        body: { error: 'A pending order cannot be shipped' },
      })
      const { id } = await paidOrder(a)
      await a.post(`/orders/${id}/ship`)
      expect(await a.post(`/orders/${id}/shipments`, { lines: [{ sku: APL, quantity: 1 }] })).toMatchObject({
        status: 409,
        body: { error: 'A shipped order cannot be shipped' },
      })
      expect(await a.post(`/orders/${id}/ship`)).toMatchObject({
        status: 409,
        body: { error: 'A shipped order cannot be shipped' },
      })
      expect(
        await a.post('/orders/ord_9999/shipments', { lines: [{ sku: APL, quantity: 1 }] }),
      ).toMatchObject({
        status: 404,
        body: { error: 'Order not found' },
      })
    })

    it('refuses lines that are not a non-empty list of distinct { sku, quantity } (400) and records nothing', async () => {
      const { a, id } = await paidOrder()
      for (const body of [
        {},
        { lines: [] },
        { lines: 'APL-GALA-1KG' },
        { lines: [{ sku: APL, quantity: 0 }] },
        { lines: [{ sku: APL, quantity: 1.5 }] },
        { lines: [{ quantity: 1 }] },
        {
          lines: [
            { sku: APL, quantity: 1 },
            { sku: APL, quantity: 1 },
          ],
        },
      ]) {
        expect(await a.post(`/orders/${id}/shipments`, body), JSON.stringify(body)).toMatchObject({
          status: 400,
          body: { error: LINES_ERROR },
        })
      }
      expect((await a.get(`/orders/${id}`)).body).toMatchObject({ status: 'paid', shipments: [] })
    })

    it('refuses a SKU not in the order or more than is left to ship (422) and records nothing', async () => {
      const { a, id } = await paidOrder()
      const tryShip = (lines: { sku: string; quantity: number }[]) =>
        a.post(`/orders/${id}/shipments`, { lines })
      expect(
        await tryShip([
          { sku: APL, quantity: 1 },
          { sku: 'TOM-HEIR-500', quantity: 1 },
        ]),
      ).toMatchObject({ status: 422, body: { error: 'Cannot ship 1 of TOM-HEIR-500' } })
      expect(
        await tryShip([
          { sku: APL, quantity: 2 },
          { sku: BRD, quantity: 3 },
        ]),
      ).toMatchObject({ status: 422, body: { error: 'Cannot ship 3 of BRD-SOUR-800' } })
      expect((await tryShip([{ sku: APL, quantity: 2 }])).status).toBe(201)
      expect(await tryShip([{ sku: APL, quantity: 2 }])).toMatchObject({
        status: 422,
        body: { error: 'Cannot ship 2 of APL-GALA-1KG' },
      })
      const order = (await a.get(`/orders/${id}`)).body
      expect(order.shipped).toEqual({ [APL]: 2, [BRD]: 0 })
      expect(order.shipments).toHaveLength(1)
      expect(await a.post(`/orders/${id}/pay`)).toMatchObject({
        status: 409,
        body: { error: 'A partially_shipped order cannot be paid' },
      })
    })

    it('never ships more than ordered when shipments for the same order arrive at the same time', async () => {
      const { a, id } = await paidOrder()
      const ship = (sku: string, quantity: number) =>
        a.post(`/orders/${id}/shipments`, { lines: [{ sku, quantity }] })
      const raced = await Promise.all([ship(APL, 2), ship(APL, 2), ship(BRD, 1)])
      expect(raced.map((r) => r.status)).toEqual([201, 422, 201])
      expect(raced[1]!.body).toEqual({ error: 'Cannot ship 2 of APL-GALA-1KG' })
      const order = (await a.get(`/orders/${id}`)).body
      expect(order.shipped).toEqual({ [APL]: 2, [BRD]: 1 })
      expect(order.shipments.map((s: { id: string }) => s.id)).toEqual(['shp_1', 'shp_2'])

      const [rest, late] = await Promise.all([a.post(`/orders/${id}/ship`), ship(APL, 1)])
      expect(rest.body).toMatchObject({ status: 'shipped', shipped: { [APL]: 3, [BRD]: 2 } })
      expect(late).toMatchObject({ status: 409, body: { error: 'A shipped order cannot be shipped' } })
    })
  })
}

// returns
{
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
}

// together
{
  const giveBack = (a: ReturnType<typeof api>, id: string, lines: [string, number][]) =>
    a.post(`/orders/${id}/returns`, { lines: lines.map(([sku, quantity]) => ({ sku, quantity })) })

  describe('shipments and returns together', () => {
    it('takes back only units that have shipped, also while the order is partially shipped', async () => {
      const a = api()
      const placed = await a.order('cus_ada', [
        ['APL-GALA-1KG', 3],
        ['BRD-SOUR-800', 2],
      ])
      const id = placed.body.id as string
      expect(placed.body).toMatchObject({ subtotalCents: 2600, taxCents: 208, totalCents: 2808 })
      await a.post(`/orders/${id}/pay`)
      await a.post(`/orders/${id}/shipments`, { lines: [{ sku: 'APL-GALA-1KG', quantity: 2 }] })
      const first = await giveBack(a, id, [['APL-GALA-1KG', 1]])
      expect(first).toMatchObject({ status: 201, body: { status: 'partially_shipped', refundedCents: 486 } })
      expect(await giveBack(a, id, [['BRD-SOUR-800', 1]])).toMatchObject({
        status: 422,
        body: { error: 'Cannot return 1 of BRD-SOUR-800' },
      })
      expect(await giveBack(a, id, [['APL-GALA-1KG', 2]])).toMatchObject({
        status: 422,
        body: { error: 'Cannot return 2 of APL-GALA-1KG' },
      })
      expect((await a.get(`/orders/${id}`)).body.returns).toHaveLength(1)
    })

    it('ships the rest after a return, and the last return closes the total and marks the order returned', async () => {
      const a = api()
      const placed = await a.order('cus_ada', [
        ['APL-GALA-1KG', 3],
        ['BRD-SOUR-800', 2],
      ])
      const id = placed.body.id as string
      await a.post(`/orders/${id}/pay`)
      await a.post(`/orders/${id}/shipments`, { lines: [{ sku: 'APL-GALA-1KG', quantity: 1 }] })
      await giveBack(a, id, [['APL-GALA-1KG', 1]])
      const rest = await a.post(`/orders/${id}/ship`)
      expect(rest.body).toMatchObject({
        status: 'shipped',
        shipped: { 'APL-GALA-1KG': 3, 'BRD-SOUR-800': 2 },
      })
      expect(rest.body.shipments[1].lines).toEqual([
        { sku: 'APL-GALA-1KG', quantity: 2 },
        { sku: 'BRD-SOUR-800', quantity: 2 },
      ])
      const last = await giveBack(a, id, [
        ['APL-GALA-1KG', 2],
        ['BRD-SOUR-800', 2],
      ])
      expect(last.body).toMatchObject({ status: 'returned', refundedCents: 2808 })
      expect(last.body.returns.map((r: { refundCents: number }) => r.refundCents)).toEqual([486, 2322])
      expect(
        await a.post(`/orders/${id}/shipments`, { lines: [{ sku: 'APL-GALA-1KG', quantity: 1 }] }),
      ).toMatchObject({
        status: 409,
        body: { error: 'A returned order cannot be shipped' },
      })
    })
  })
}
