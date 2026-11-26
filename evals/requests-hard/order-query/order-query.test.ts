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
})
