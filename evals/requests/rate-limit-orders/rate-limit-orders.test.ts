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

async function fiveOrders(a: ReturnType<typeof api>, customerId = 'cus_ada') {
  for (let i = 0; i < 5; i++) {
    expect((await a.order(customerId, [['APL-GALA-1KG', 1]])).status).toBe(201)
    a.tick(1)
  }
}

describe('rate-limit POST /orders', () => {
  it('accepts 5 orders a minute and answers the 6th with 429', async () => {
    const a = api()
    await fiveOrders(a)
    const res = await a.order('cus_ada', [['APL-GALA-1KG', 1]])
    expect(res.status).toBe(429)
    expect(res.body).toEqual({ error: 'Too many orders' })
  })

  it('says in Retry-After how many seconds to wait', async () => {
    const a = api()
    await fiveOrders(a) // at +0 s … +4 s; now +5 s
    const res = await a.order('cus_ada', [['APL-GALA-1KG', 1]])
    expect(res.headers.get('retry-after')).toBe('55')
  })

  it('counts each customer on their own', async () => {
    const a = api()
    await fiveOrders(a, 'cus_ada')
    expect((await a.order('cus_ben', [['APL-GALA-1KG', 1]])).status).toBe(201)
  })

  it('lets orders through again once the oldest one is 60 seconds old', async () => {
    const a = api()
    await fiveOrders(a)
    a.tick(55) // +60 s: the order at +0 s leaves the window
    expect((await a.order('cus_ada', [['APL-GALA-1KG', 1]])).status).toBe(201)
  })

  it('does not count refused requests', async () => {
    const a = api()
    await fiveOrders(a)
    expect((await a.order('cus_ada', [['APL-GALA-1KG', 1]])).status).toBe(429)
    a.tick(55)
    expect((await a.order('cus_ada', [['APL-GALA-1KG', 1]])).status).toBe(201)
    expect((await a.order('cus_ada', [['APL-GALA-1KG', 1]])).status).toBe(429)
  })

  it('does not limit other routes', async () => {
    const a = api()
    await fiveOrders(a)
    for (let i = 0; i < 10; i++) expect((await a.get('/orders')).status).toBe(200)
  })
})
