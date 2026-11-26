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

describe('cancel an order', () => {
  it('cancels a pending order: 200, and the order now reads "cancelled"', async () => {
    const a = api()
    const placed = await a.order('cus_ada', [['APL-GALA-1KG', 1]])
    const res = await a.post(`/orders/${placed.body.id}/cancel`)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: placed.body.id, status: 'cancelled' })
    expect((await a.get(`/orders/${placed.body.id}`)).body.status).toBe('cancelled')
  })

  it('cancels a paid order', async () => {
    const a = api()
    const placed = await a.order('cus_ada', [['APL-GALA-1KG', 1]])
    await a.post(`/orders/${placed.body.id}/pay`)
    expect((await a.post(`/orders/${placed.body.id}/cancel`)).body.status).toBe('cancelled')
  })

  it('refuses to cancel a shipped order with 409', async () => {
    const a = api()
    const placed = await a.order('cus_ada', [['APL-GALA-1KG', 1]])
    await a.post(`/orders/${placed.body.id}/pay`)
    await a.post(`/orders/${placed.body.id}/ship`)
    expect((await a.post(`/orders/${placed.body.id}/cancel`)).status).toBe(409)
    expect((await a.get(`/orders/${placed.body.id}`)).body.status).toBe('shipped')
  })

  it('answers 404 for an unknown order', async () => {
    expect((await api().post('/orders/ord_9999/cancel')).status).toBe(404)
  })

  it('refuses to cancel twice, or to pay or ship a cancelled order', async () => {
    const a = api()
    const placed = await a.order('cus_ada', [['APL-GALA-1KG', 1]])
    expect((await a.post(`/orders/${placed.body.id}/cancel`)).status).toBe(200)
    expect((await a.post(`/orders/${placed.body.id}/cancel`)).status).toBe(409)
    expect((await a.post(`/orders/${placed.body.id}/pay`)).status).toBe(409)
    expect((await a.post(`/orders/${placed.body.id}/ship`)).status).toBe(409)
  })

  it('keeps cancelled orders out of the daily total', async () => {
    const a = api()
    await a.order('cus_ada', [['BRD-SOUR-800', 4]]) // 2500 + 200 tax
    const other = await a.order('cus_ben', [['MLK-OAT-1L', 1]])
    await a.post(`/orders/${other.body.id}/cancel`)
    expect((await a.get('/reports/daily-total?date=2026-11-20')).body.totalCents).toBe(2700)
  })
})
