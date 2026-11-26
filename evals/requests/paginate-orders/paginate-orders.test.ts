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

async function withOrders(count: number) {
  const a = api()
  for (let i = 0; i < count; i++) {
    a.tick(1)
    await a.order('cus_ada', [['APL-GALA-1KG', 1]])
  }
  return a
}

describe('paginate GET /orders', () => {
  it('returns 20 orders by default, with the cursor of the next page', async () => {
    const a = await withOrders(25)
    const res = await a.get('/orders')
    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(20)
    expect(res.body.items[0].id).toBe('ord_0001')
    expect(res.body.nextCursor).toBe('ord_0021')
  })

  it('honours limit', async () => {
    const a = await withOrders(5)
    const res = await a.get('/orders?limit=2')
    expect(res.body.items.map((o: { id: string }) => o.id)).toEqual(['ord_0001', 'ord_0002'])
    expect(res.body.nextCursor).toBe('ord_0003')
  })

  it('continues from the cursor', async () => {
    const a = await withOrders(5)
    const res = await a.get('/orders?limit=2&cursor=ord_0003')
    expect(res.body.items.map((o: { id: string }) => o.id)).toEqual(['ord_0003', 'ord_0004'])
  })

  it('answers nextCursor null on the last page', async () => {
    const a = await withOrders(3)
    expect((await a.get('/orders?limit=2&cursor=ord_0003')).body).toMatchObject({ nextCursor: null })
    expect((await a.get('/orders?limit=10')).body.nextCursor).toBeNull()
  })

  it('answers 400 for a limit outside 1 to 100 or a cursor that is not an order', async () => {
    const a = await withOrders(2)
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'cursor=ord_9999']) {
      expect((await a.get(`/orders?${query}`)).status, query).toBe(400)
    }
  })
})
