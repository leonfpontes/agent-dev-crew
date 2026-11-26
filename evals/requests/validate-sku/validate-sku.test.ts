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

describe('validate the SKU before adding to the cart', () => {
  it('answers 404 with "Unknown SKU" for a SKU that is not in the catalog', async () => {
    const a = api()
    const cart = await a.post('/carts', { customerId: 'cus_ada' })
    const res = await a.post(`/carts/${cart.body.id}/items`, { sku: 'NOPE-404', quantity: 1 })
    expect(res.status).toBe(404)
    expect(res.body).toEqual({ error: 'Unknown SKU' })
  })

  it('leaves the cart as it was after a refused item', async () => {
    const a = api()
    const cart = await a.post('/carts', { customerId: 'cus_ada' })
    await a.post(`/carts/${cart.body.id}/items`, { sku: 'MLK-OAT-1L', quantity: 1 })
    await a.post(`/carts/${cart.body.id}/items`, { sku: 'NOPE-404', quantity: 1 })
    const after = await a.get(`/carts/${cart.body.id}`)
    expect(after.body.lines.map((l: { sku: string }) => l.sku)).toEqual(['MLK-OAT-1L'])
  })

  it('answers 409 with "Not enough stock" for a SKU that is out of stock', async () => {
    const a = api()
    const cart = await a.post('/carts', { customerId: 'cus_ada' })
    const res = await a.post(`/carts/${cart.body.id}/items`, { sku: 'HNY-WILD-350', quantity: 1 })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ error: 'Not enough stock' })
  })

  it('counts what is already in the cart against the stock', async () => {
    const a = api()
    const cart = await a.post('/carts', { customerId: 'cus_ada' })
    expect((await a.post(`/carts/${cart.body.id}/items`, { sku: 'CHS-CHED-200', quantity: 5 })).status).toBe(
      200,
    )
    expect((await a.post(`/carts/${cart.body.id}/items`, { sku: 'CHS-CHED-200', quantity: 4 })).status).toBe(
      409,
    )
    expect((await a.get(`/carts/${cart.body.id}`)).body.lines[0].quantity).toBe(5)
  })
})
