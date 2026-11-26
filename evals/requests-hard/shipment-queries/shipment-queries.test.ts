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

// order-query
{
  /**
   * Six orders: 1 ada 972 paid (11-18), 2 ben 1619 pending and 3 ada 675 shipped (both 11-19 12:00),
   * 4 cleo 2227 pending (11-20), 5 ada 1619 paid (11-21), 6 ben 377 pending (11-22).
   */
  async function sixOrders() {
    const a = api()
    const place = async (iso: string, customerId: string, sku: string, quantity: number, then: string[]) => {
      a.at(iso)
      const placed = await a.order(customerId, [[sku, quantity]])
      for (const step of then) await a.post(`/orders/${placed.body.id}/${step}`)
    }
    await place('2026-11-18T09:00:00Z', 'cus_ada', 'APL-GALA-1KG', 2, ['pay'])
    await place('2026-11-19T12:00:00Z', 'cus_ben', 'COF-BEAN-500', 1, [])
    await place('2026-11-19T12:00:00Z', 'cus_ada', 'BRD-SOUR-800', 1, ['pay', 'ship'])
    await place('2026-11-20T08:00:00Z', 'cus_cleo', 'CHS-CHED-200', 2, [])
    await place('2026-11-21T10:00:00Z', 'cus_ada', 'COF-BEAN-500', 1, ['pay'])
    await place('2026-11-22T10:00:00Z', 'cus_ben', 'MLK-OAT-1L', 1, [])
    return a
  }

  const ids = async (a: ReturnType<typeof api>, query: string) => {
    const res = await a.get(`/orders${query}`)
    expect(res.status, `${query}: ${res.text}`).toBe(200)
    return res.body.items.map((o: { id: string }) => Number(o.id.slice(4)))
  }

  describe('query the orders', () => {
    it('answers every order oldest first, ties by id, with the total, the limit and the offset', async () => {
      const a = await sixOrders()
      const res = await a.get('/orders')
      expect(res.body).toMatchObject({ total: 6, limit: 20, offset: 0 })
      expect(await ids(a, '')).toEqual([1, 2, 3, 4, 5, 6])
      expect(res.body.items[3]).toMatchObject({ customerId: 'cus_cleo', totalCents: 2227 })
    })

    it('combines status, customer, from and to (UTC dates, both included) and minTotal', async () => {
      const a = await sixOrders()
      expect(await ids(a, '?status=pending&customer=cus_ben')).toEqual([2, 6])
      expect(await ids(a, '?from=2026-11-19&to=2026-11-20')).toEqual([2, 3, 4])
      expect(await ids(a, '?minTotal=1619')).toEqual([2, 4, 5])
      expect(await ids(a, '?customer=cus_ada&minTotal=900&status=paid')).toEqual([1, 5])
      expect(await ids(a, '?to=2026-11-18')).toEqual([1])
    })

    it('sorts by createdAt or total, either way, and always breaks ties by id ascending', async () => {
      const a = await sixOrders()
      expect(await ids(a, '?sort=-total')).toEqual([4, 2, 5, 1, 3, 6])
      expect(await ids(a, '?sort=total')).toEqual([6, 3, 1, 2, 5, 4])
      expect(await ids(a, '?sort=-createdAt')).toEqual([6, 5, 4, 2, 3, 1])
      expect(await ids(a, '?sort=createdAt')).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('pages with limit and offset after filtering and sorting, and counts the matches before paging', async () => {
      const a = await sixOrders()
      expect((await a.get('/orders?limit=2&offset=1')).body).toMatchObject({ total: 6, limit: 2, offset: 1 })
      expect(await ids(a, '?limit=2&offset=1')).toEqual([2, 3])
      expect(await ids(a, '?sort=-total&limit=2&offset=4')).toEqual([3, 6])
      expect((await a.get('/orders?offset=10')).body).toMatchObject({ items: [], total: 6 })
      const pending = await a.get('/orders?status=pending&limit=1')
      expect(pending.body).toMatchObject({ total: 3, limit: 1, offset: 0 })
      expect(pending.body.items.map((o: { id: string }) => o.id)).toEqual(['ord_0002'])
    })

    it('refuses an invalid value with 400, naming the first invalid parameter in the order of the list', async () => {
      const a = await sixOrders()
      for (const [query, name] of [
        ['status=cancelled', 'status'],
        ['from=2026-02-30', 'from'],
        ['to=2026-11-5', 'to'],
        ['from=2026-11-20&to=2026-11-19', 'to'],
        ['minTotal=-1', 'minTotal'],
        ['minTotal=1.5', 'minTotal'],
        ['sort=price', 'sort'],
        ['limit=0', 'limit'],
        ['limit=101', 'limit'],
        ['limit=abc', 'limit'],
        ['offset=-1', 'offset'],
        ['limit=0&status=nope', 'status'],
        ['offset=-1&sort=bad&limit=0', 'sort'],
      ]) {
        expect(await a.get(`/orders?${query}`), query).toMatchObject({
          status: 400,
          body: { error: `Invalid query: ${name}` },
        })
      }
    })

    it('refuses a parameter that is not in the list, after checking the known ones', async () => {
      const a = await sixOrders()
      expect(await a.get('/orders?page=2')).toMatchObject({
        status: 400,
        body: { error: 'Invalid query: page' },
      })
      expect(await a.get('/orders?page=2&status=bad')).toMatchObject({
        status: 400,
        body: { error: 'Invalid query: status' },
      })
      expect(await ids(a, '?limit=100&offset=0&customer=cus_cleo')).toEqual([4])
    })

    it("sorts by several keys in order, with status in the order of an order's life, not alphabetically", async () => {
      const a = await sixOrders()
      expect(await ids(a, '?sort=status,-total')).toEqual([4, 2, 6, 5, 1, 3])
      expect(await ids(a, '?sort=-status,createdAt')).toEqual([3, 1, 5, 2, 4, 6])
      expect(await ids(a, '?sort=total,-createdAt')).toEqual([6, 3, 1, 5, 2, 4])
      expect(await ids(a, '?sort=status&limit=2&offset=2')).toEqual([6, 1])
      for (const sort of ['status,status', 'status,-status', '', 'status,price', 'status,,total'])
        expect(await a.get(`/orders?sort=${sort}`), sort).toMatchObject({
          status: 400,
          body: { error: 'Invalid query: sort' },
        })
    })
  })
}

// together
{
  describe('order queries and shipments together', () => {
    it('filters by partially_shipped and sorts it between paid and shipped', async () => {
      const a = api()
      const place = async (sku: string, quantity: number, steps: string[]) => {
        const placed = await a.order('cus_ada', [[sku, quantity]])
        for (const step of steps) await a.post(`/orders/${placed.body.id}/${step}`)
        a.tick(60)
        return placed.body.id as string
      }
      const shipped = await place('APL-GALA-1KG', 1, ['pay', 'ship'])
      const partial = await place('APL-GALA-1KG', 3, ['pay'])
      await a.post(`/orders/${partial}/shipments`, { lines: [{ sku: 'APL-GALA-1KG', quantity: 1 }] })
      const pending = await place('APL-GALA-1KG', 2, [])
      const paid = await place('APL-GALA-1KG', 4, ['pay'])
      const ids = async (query: string) =>
        (await a.get(`/orders?${query}`)).body.items.map((o: { id: string }) => o.id)
      expect(await ids('status=partially_shipped')).toEqual([partial])
      expect(await ids('sort=status')).toEqual([pending, paid, partial, shipped])
      expect(await ids('sort=-status,total')).toEqual([shipped, partial, paid, pending])
      await a.post(`/orders/${partial}/ship`)
      expect(await ids('status=shipped')).toEqual([shipped, partial])
      expect((await a.get('/orders?status=partially_shipped')).body).toMatchObject({ items: [], total: 0 })
    })
  })
}
