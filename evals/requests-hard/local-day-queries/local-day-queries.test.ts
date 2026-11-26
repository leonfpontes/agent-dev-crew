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

// store-timezone-reports
{
  const ERROR = 'from and to must be real dates (YYYY-MM-DD), from <= to, at most 31 days'

  /** Places one order at a UTC instant: APL-GALA-1KG is 486 with tax, BRD-SOUR-800 675, EGG-FREE-12 647. */
  async function placeAt(a: ReturnType<typeof api>, iso: string, sku: string) {
    a.at(iso)
    const res = await a.order('cus_ada', [[sku, 1]])
    expect(res.status).toBe(201)
  }

  const daily = async (a: ReturnType<typeof api>, date: string) =>
    (await a.get(`/reports/daily-total?date=${date}`)).body.totalCents

  describe('reports in the store time zone (America/New_York)', () => {
    it('counts an order in the New York day it was placed, not the UTC day', async () => {
      const a = api()
      await placeAt(a, '2026-11-20T03:30:00Z', 'APL-GALA-1KG') // 2026-11-19 22:30 in New York
      await placeAt(a, '2026-11-20T10:00:00Z', 'BRD-SOUR-800')
      expect(await daily(a, '2026-11-19')).toBe(486)
      expect(await daily(a, '2026-11-20')).toBe(675)
    })

    it('follows daylight saving time: UTC-5 before 2026-03-08 02:00 local, UTC-4 after', async () => {
      const a = api()
      await placeAt(a, '2026-03-08T04:30:00Z', 'APL-GALA-1KG') // 2026-03-07 23:30 EST
      await placeAt(a, '2026-03-08T06:30:00Z', 'BRD-SOUR-800') // 2026-03-08 01:30 EST
      await placeAt(a, '2026-03-09T04:30:00Z', 'EGG-FREE-12') // 2026-03-09 00:30 EDT
      expect(await daily(a, '2026-03-07')).toBe(486)
      expect(await daily(a, '2026-03-08')).toBe(675)
      expect(await daily(a, '2026-03-09')).toBe(647)
    })

    it('reports sales per local day over a range, with empty days and the total', async () => {
      const a = api()
      await placeAt(a, '2026-11-18T15:00:00Z', 'APL-GALA-1KG')
      await placeAt(a, '2026-11-20T10:00:00Z', 'BRD-SOUR-800')
      await placeAt(a, '2026-11-21T04:59:00Z', 'EGG-FREE-12') // 2026-11-20 23:59 EST
      const res = await a.get('/reports/sales?from=2026-11-18&to=2026-11-21')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        from: '2026-11-18',
        to: '2026-11-21',
        days: [
          { date: '2026-11-18', orders: 1, totalCents: 486 },
          { date: '2026-11-19', orders: 0, totalCents: 0 },
          { date: '2026-11-20', orders: 2, totalCents: 1322 },
          { date: '2026-11-21', orders: 0, totalCents: 0 },
        ],
        totalCents: 1808,
      })
    })

    it('gives the 25-hour day when daylight saving time ends (2026-11-01) all of its orders', async () => {
      const a = api()
      await placeAt(a, '2026-11-01T03:30:00Z', 'APL-GALA-1KG') // 2026-10-31 23:30 EDT
      await placeAt(a, '2026-11-01T04:30:00Z', 'BRD-SOUR-800') // 2026-11-01 00:30 EDT
      await placeAt(a, '2026-11-02T04:30:00Z', 'EGG-FREE-12') // 2026-11-01 23:30 EST
      await placeAt(a, '2026-11-02T05:30:00Z', 'APL-GALA-1KG') // 2026-11-02 00:30 EST
      const res = await a.get('/reports/sales?from=2026-10-31&to=2026-11-02')
      expect(res.body.days).toEqual([
        { date: '2026-10-31', orders: 1, totalCents: 486 },
        { date: '2026-11-01', orders: 2, totalCents: 1322 },
        { date: '2026-11-02', orders: 1, totalCents: 486 },
      ])
      expect(res.body.totalCents).toBe(2294)
    })

    it('accepts up to 31 days and refuses a bad range with 400', async () => {
      const a = api()
      const month = await a.get('/reports/sales?from=2026-01-01&to=2026-01-31')
      expect(month.status).toBe(200)
      expect(month.body.days).toHaveLength(31)
      for (const query of [
        'from=2026-01-01&to=2026-02-01',
        'from=2026-11-21&to=2026-11-20',
        'from=2026-02-27&to=2026-02-30',
        'from=2026-11-01',
        'from=2026-1-05&to=2026-01-10',
      ]) {
        expect(await a.get(`/reports/sales?${query}`), query).toMatchObject({
          status: 400,
          body: { error: ERROR },
        })
      }
    })

    it('refuses a daily-total date that does not exist, and takes a leap day', async () => {
      const a = api()
      for (const date of ['2026-02-30', '2027-02-29', '2026-13-01'])
        expect(await a.get(`/reports/daily-total?date=${date}`), date).toMatchObject({
          status: 400,
          body: { error: 'date must be YYYY-MM-DD' },
        })
      expect(await a.get('/reports/daily-total?date=2028-02-29')).toMatchObject({
        status: 200,
        body: { date: '2028-02-29', totalCents: 0 },
      })
    })

    it('groups by weeks starting on Monday with by=week, counting only the orders inside the range', async () => {
      const a = api()
      await placeAt(a, '2026-11-17T15:00:00Z', 'APL-GALA-1KG') // Tuesday, before the range
      await placeAt(a, '2026-11-18T15:00:00Z', 'APL-GALA-1KG') // Wednesday
      await placeAt(a, '2026-11-20T10:00:00Z', 'BRD-SOUR-800')
      await placeAt(a, '2026-11-23T04:30:00Z', 'EGG-FREE-12') // Sunday 2026-11-22 23:30 in New York
      await placeAt(a, '2026-11-24T15:00:00Z', 'BRD-SOUR-800') // Tuesday
      const res = await a.get('/reports/sales?from=2026-11-18&to=2026-11-24&by=week')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        from: '2026-11-18',
        to: '2026-11-24',
        days: [
          { date: '2026-11-16', orders: 3, totalCents: 1808 },
          { date: '2026-11-23', orders: 1, totalCents: 675 },
        ],
        totalCents: 2483,
      })
    })

    it('puts a Sunday-night order in its New York week across the end of daylight saving time, and refuses another by', async () => {
      const a = api()
      await placeAt(a, '2026-11-02T04:30:00Z', 'APL-GALA-1KG') // Sunday 2026-11-01 23:30 EST
      await placeAt(a, '2026-11-02T05:30:00Z', 'BRD-SOUR-800') // Monday 2026-11-02 00:30 EST
      const res = await a.get('/reports/sales?from=2026-10-28&to=2026-11-03&by=week')
      expect(res.body.days).toEqual([
        { date: '2026-10-26', orders: 1, totalCents: 486 },
        { date: '2026-11-02', orders: 1, totalCents: 675 },
      ])
      expect((await a.get('/reports/sales?from=2026-10-28&to=2026-11-03&by=day')).body.days).toHaveLength(7)
      expect(await a.get('/reports/sales?from=2026-10-28&to=2026-11-03&by=month')).toMatchObject({
        status: 400,
        body: { error: 'by must be day or week' },
      })
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
  describe('order queries on the store calendar', () => {
    it('filters from and to by the New York day, across the end of daylight saving time, like the reports', async () => {
      const a = api()
      const at = async (iso: string, sku: string) => {
        a.at(iso)
        return (await a.order('cus_ada', [[sku, 1]])).body.id as string
      }
      const late = await at('2026-11-20T03:30:00Z', 'APL-GALA-1KG') // 2026-11-19 22:30 in New York
      const day = await at('2026-11-20T15:00:00Z', 'BRD-SOUR-800')
      const fallBack = await at('2026-11-02T04:30:00Z', 'EGG-FREE-12') // 2026-11-01 23:30 EST
      const list = async (query: string) =>
        (await a.get(`/orders?${query}`)).body.items.map((o: { id: string }) => o.id)
      expect(await list('from=2026-11-19&to=2026-11-19')).toEqual([late])
      expect(await list('from=2026-11-20')).toEqual([day])
      expect(await list('to=2026-11-01')).toEqual([fallBack])
      expect((await a.get('/reports/sales?from=2026-11-19&to=2026-11-20')).body.days).toEqual([
        { date: '2026-11-19', orders: 1, totalCents: 486 },
        { date: '2026-11-20', orders: 1, totalCents: 675 },
      ])
    })
  })
}
