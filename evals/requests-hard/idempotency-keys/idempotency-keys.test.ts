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

const key = (value: string) => ({ 'Idempotency-Key': value })
const REUSED = 'Idempotency-Key reused with a different request'

describe('Idempotency-Key on POST /orders and POST /orders/:id/pay', () => {
  it('answers a retried order with the first answer, marked as replayed, and places it once', async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [['APL-GALA-1KG', 2]])
    const first = await a.post('/orders', { cartId }, key('order-1'))
    const again = await a.post('/orders', { cartId }, key('order-1'))
    expect(first.status).toBe(201)
    expect(first.headers.get('idempotent-replayed')).toBeNull()
    expect(again.status).toBe(201)
    expect(again.body).toEqual(first.body)
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect((await a.get('/orders')).body.items).toHaveLength(1)
  })

  it('compares bodies by value, whatever the key order, and refuses the key with a different body (422)', async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [['APL-GALA-1KG', 2]])
    const first = await a.post('/orders', { cartId, note: 'gift' }, key('k1'))
    const again = await a.post('/orders', { note: 'gift', cartId }, key('k1'))
    expect(again).toMatchObject({ status: 201, body: first.body })
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    const other = await a.cart('cus_ben', [['BRD-SOUR-800', 1]])
    expect(await a.post('/orders', { cartId: other }, key('k1'))).toMatchObject({
      status: 422,
      body: { error: REUSED },
    })
    expect((await a.get('/orders')).body.items).toHaveLength(1)
  })

  it('keeps keys per path, and replays a payment instead of refusing it', async () => {
    const a = api()
    const placed = await a.order('cus_ada', [['COF-BEAN-500', 1]], {})
    const cartId = await a.cart('cus_ben', [['MLK-OAT-1L', 1]])
    expect((await a.post('/orders', { cartId }, key('same'))).status).toBe(201)
    const paid = await a.post(`/orders/${placed.body.id}/pay`, {}, key('same'))
    expect(paid).toMatchObject({ status: 200, body: { id: placed.body.id, status: 'paid' } })
    expect(paid.headers.get('idempotent-replayed')).toBeNull()
    const again = await a.post(`/orders/${placed.body.id}/pay`, {}, key('same'))
    expect(again).toMatchObject({ status: 200, body: paid.body })
    expect(again.headers.get('idempotent-replayed')).toBe('true')
    expect(await a.post(`/orders/${placed.body.id}/pay`)).toMatchObject({
      status: 409,
      body: { error: 'A paid order cannot be paid' },
    })
  })

  it('does not remember an error answer, so the same key works once the problem is fixed', async () => {
    const a = api()
    const created = await a.post('/carts', { customerId: 'cus_cleo' })
    const cartId = created.body.id
    expect(await a.post('/orders', { cartId }, key('retry-me'))).toMatchObject({
      status: 422,
      body: { error: 'The cart is empty' },
    })
    await a.post(`/carts/${cartId}/items`, { sku: 'EGG-FREE-12', quantity: 1 })
    const placed = await a.post('/orders', { cartId }, key('retry-me'))
    expect(placed.status).toBe(201)
    expect(placed.headers.get('idempotent-replayed')).toBeNull()
    expect((await a.get('/orders')).body.items).toHaveLength(1)
  })

  it('forgets a key 24 hours after its first request, on the app clock', async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [['APL-GALA-1KG', 1]])
    const first = await a.post('/orders', { cartId }, key('day'))
    a.tick(24 * 3600 - 1)
    const replayed = await a.post('/orders', { cartId }, key('day'))
    expect(replayed).toMatchObject({ status: 201, body: first.body })
    a.tick(1)
    expect(await a.post('/orders', { cartId }, key('day'))).toMatchObject({
      status: 422,
      body: { error: 'The cart is empty' },
    })
  })

  it('refuses a key that is not 1 to 64 letters, digits, - or _ (400) and does nothing', async () => {
    const a = api()
    const cartId = await a.cart('cus_ada', [['APL-GALA-1KG', 1]])
    for (const value of ['', 'has space', 'a/b', 'x'.repeat(65)]) {
      expect(await a.post('/orders', { cartId }, key(value)), JSON.stringify(value)).toMatchObject({
        status: 400,
        body: { error: 'Invalid Idempotency-Key' },
      })
    }
    expect((await a.get('/orders')).body.items).toEqual([])
    expect((await a.post('/orders', { cartId }, key('Ok_key-64'))).status).toBe(201)
  })
})
