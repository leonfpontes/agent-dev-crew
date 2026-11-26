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

// stock-reservations
{
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

    it('never oversells when orders race for the last units, and returns a raced cancel only once', async () => {
      const a = api()
      const carts = []
      for (const customerId of ['cus_ada', 'cus_ben', 'cus_cleo', 'cus_ada', 'cus_ben'])
        carts.push(await a.cart(customerId, [['CHS-CHED-200', 2]]))
      const placed = await Promise.all(carts.map((cartId) => a.post('/orders', { cartId })))
      expect(placed.map((r) => r.status).sort()).toEqual([201, 201, 201, 201, 409])
      expect((await stockOf(a))['CHS-CHED-200']).toBe(0)
      expect((await a.get('/orders')).body.items).toHaveLength(4)

      const id = placed.find((r) => r.status === 201)!.body.id
      const cancels = await Promise.all([a.post(`/orders/${id}/cancel`), a.post(`/orders/${id}/cancel`)])
      expect(cancels.map((r) => r.status).sort()).toEqual([200, 409])
      expect((await stockOf(a))['CHS-CHED-200']).toBe(2)
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
      expect((await a.app.db.products.find(TOM))?.stock).toBe(19)
      expect((await a.app.db.products.find(APL))?.stock).toBe(39)
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
      expect((await a.app.db.products.find(TOM))?.stock).toBe(19)
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
  const products = async (a: ReturnType<typeof api>) =>
    Object.fromEntries(
      (await a.get('/products')).body.items.map((p: { sku: string; stock: number }) => [p.sku, p.stock]),
    )
  const shipped = async (a: ReturnType<typeof api>, items: [string, number][]) => {
    const placed = await a.order('cus_ada', items)
    await a.post(`/orders/${placed.body.id}/pay`)
    await a.post(`/orders/${placed.body.id}/ship`)
    return placed.body.id as string
  }

  describe('stock and returns together', () => {
    it('sells returned units again, and keeps cancelled and returned orders apart', async () => {
      const a = api()
      const id = await shipped(a, [['CHS-CHED-200', 8]])
      expect((await products(a))['CHS-CHED-200']).toBe(0)
      expect(
        await a.post(`/orders/${id}/returns`, { lines: [{ sku: 'CHS-CHED-200', quantity: 3 }] }),
      ).toMatchObject({ status: 201 })
      expect((await products(a))['CHS-CHED-200']).toBe(3)
      expect(await a.order('cus_ben', [['CHS-CHED-200', 4]])).toMatchObject({
        status: 409,
        body: { error: 'Not enough stock for CHS-CHED-200' },
      })
      expect((await a.order('cus_ben', [['CHS-CHED-200', 3]])).status).toBe(201)
      await a.post(`/orders/${id}/returns`, { lines: [{ sku: 'CHS-CHED-200', quantity: 5 }] })
      expect(await a.post(`/orders/${id}/cancel`)).toMatchObject({
        status: 409,
        body: { error: 'A returned order cannot be cancelled' },
      })
      const gone = await a.order('cus_cleo', [['APL-GALA-1KG', 1]])
      await a.post(`/orders/${gone.body.id}/cancel`)
      expect(
        await a.post(`/orders/${gone.body.id}/returns`, { lines: [{ sku: 'APL-GALA-1KG', quantity: 1 }] }),
      ).toMatchObject({ status: 409, body: { error: 'A cancelled order cannot be returned' } })
      expect(await products(a)).toMatchObject({ 'CHS-CHED-200': 5, 'APL-GALA-1KG': 40 })
    })

    it('handles returns that race each other and racing orders one at a time, so stock stays right', async () => {
      const a = api()
      const id = await shipped(a, [['TOM-HEIR-500', 3]])
      const back = (quantity: number) =>
        a.post(`/orders/${id}/returns`, { lines: [{ sku: 'TOM-HEIR-500', quantity }] })
      const raced = await Promise.all([back(2), back(2), a.order('cus_ben', [['TOM-HEIR-500', 18]])])
      expect(raced.map((r) => r.status)).toEqual([201, 422, 201])
      expect(raced[1]!.body).toEqual({ error: 'Cannot return 2 of TOM-HEIR-500' })
      expect((await products(a))['TOM-HEIR-500']).toBe(1)
      expect((await a.get(`/orders/${id}`)).body.returns).toHaveLength(1)
    })
  })
}
