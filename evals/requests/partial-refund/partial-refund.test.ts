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

async function paidOrder() {
  const a = api()
  const placed = await a.order('cus_ada', [['COF-BEAN-500', 1]]) // 1499 + 120 = 1619
  await a.post(`/orders/${placed.body.id}/pay`)
  return { a, id: placed.body.id as string }
}

describe('refund part of an order', () => {
  it('refunds part of a paid order: 201 with refundedCents and the refund', async () => {
    const { a, id } = await paidOrder()
    const res = await a.post(`/orders/${id}/refunds`, { amountCents: 500 })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      id,
      refundedCents: 500,
      refunds: [{ amountCents: 500, at: '2026-11-20T10:00:00.000Z' }],
    })
  })

  it('adds up several refunds', async () => {
    const { a, id } = await paidOrder()
    await a.post(`/orders/${id}/refunds`, { amountCents: 500 })
    const res = await a.post(`/orders/${id}/refunds`, { amountCents: 1119 })
    expect(res.body.refundedCents).toBe(1619)
    expect(res.body.refunds).toHaveLength(2)
  })

  it('refuses refunds above the amount left with 422', async () => {
    const { a, id } = await paidOrder()
    await a.post(`/orders/${id}/refunds`, { amountCents: 1600 })
    const res = await a.post(`/orders/${id}/refunds`, { amountCents: 20 })
    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: 'Refund exceeds the amount left' })
  })

  it('refuses to refund a pending order with 409', async () => {
    const a = api()
    const placed = await a.order('cus_ada', [['COF-BEAN-500', 1]])
    expect((await a.post(`/orders/${placed.body.id}/refunds`, { amountCents: 100 })).status).toBe(409)
  })

  it('answers 400 for an amount that is not a whole number above 0', async () => {
    const { a, id } = await paidOrder()
    for (const amountCents of [0, -5, 1.5, '100']) {
      expect((await a.post(`/orders/${id}/refunds`, { amountCents })).status, String(amountCents)).toBe(400)
    }
  })

  it('answers 404 for an unknown order, and new orders show no refunds', async () => {
    const a = api()
    expect((await a.post('/orders/ord_9999/refunds', { amountCents: 100 })).status).toBe(404)
    const placed = await a.order('cus_ada', [['APL-GALA-1KG', 1]])
    expect(placed.body).toMatchObject({ refundedCents: 0, refunds: [] })
  })
})
