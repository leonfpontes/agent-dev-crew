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

async function threeOrders() {
  const a = api()
  for (const customer of ['cus_ada', 'cus_ben', 'cus_cleo']) {
    await a.order(customer, [['APL-GALA-1KG', 1]])
    a.tick(1)
  }
  return a
}
const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((o) => o.id)

describe('search orders by customer', () => {
  it('finds orders by part of the customer name', async () => {
    expect(ids(await (await threeOrders()).get('/orders?customer=okafor'))).toEqual(['ord_0002'])
  })

  it('finds orders by part of the email', async () => {
    expect(ids(await (await threeOrders()).get('/orders?customer=example.org'))).toEqual(['ord_0003'])
  })

  it('ignores case', async () => {
    expect(ids(await (await threeOrders()).get('/orders?customer=ADA'))).toEqual(['ord_0001'])
  })

  it('answers an empty list when nothing matches', async () => {
    const res = await (await threeOrders()).get('/orders?customer=zed')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [] })
  })

  it('returns every order without the parameter or with an empty one', async () => {
    const a = await threeOrders()
    expect(ids(await a.get('/orders?customer='))).toEqual(['ord_0001', 'ord_0002', 'ord_0003'])
    expect(ids(await a.get('/orders'))).toEqual(['ord_0001', 'ord_0002', 'ord_0003'])
  })
})
