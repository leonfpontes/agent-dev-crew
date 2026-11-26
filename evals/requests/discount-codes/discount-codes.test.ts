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

describe('discount codes at checkout', () => {
  it('FRESH10 takes 10% off the subtotal, and tax is charged after the discount', async () => {
    const res = await api().order(
      'cus_ada',
      [
        ['APL-GALA-1KG', 2],
        ['BRD-SOUR-800', 1],
      ],
      { code: 'FRESH10' },
    )
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      subtotalCents: 1525,
      discountCode: 'FRESH10',
      discountCents: 153,
      taxCents: 110,
      totalCents: 1482,
    })
  })

  it('reads codes without minding the case', async () => {
    const res = await api().order(
      'cus_ada',
      [
        ['APL-GALA-1KG', 2],
        ['BRD-SOUR-800', 1],
      ],
      { code: 'fresh10' },
    )
    expect(res.body).toMatchObject({ discountCode: 'FRESH10', discountCents: 153 })
  })

  it('FIVEOFF takes $5.00 off a subtotal over $25.00', async () => {
    const res = await api().order('cus_ben', [['COF-BEAN-500', 2]], { code: 'FIVEOFF' })
    expect(res.body).toMatchObject({
      subtotalCents: 2998,
      discountCents: 500,
      taxCents: 200,
      totalCents: 2698,
    })
  })

  it('FIVEOFF works at exactly $25.00', async () => {
    const res = await api().order('cus_ben', [['BRD-SOUR-800', 4]], { code: 'FIVEOFF' })
    expect(res.body).toMatchObject({
      subtotalCents: 2500,
      discountCents: 500,
      taxCents: 160,
      totalCents: 2160,
    })
  })

  it('refuses FIVEOFF under $25.00 with 422', async () => {
    const res = await api().order('cus_ben', [['APL-GALA-1KG', 1]], { code: 'FIVEOFF' })
    expect(res.status).toBe(422)
    expect(res.body).toEqual({ error: 'FIVEOFF needs a subtotal of $25.00' })
  })

  it('refuses an unknown code with 400', async () => {
    const res = await api().order('cus_ben', [['APL-GALA-1KG', 1]], { code: 'FREE100' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: 'Unknown discount code' })
  })

  it('orders without a code show no discount and keep their totals', async () => {
    const res = await api().order('cus_ada', [
      ['APL-GALA-1KG', 2],
      ['BRD-SOUR-800', 1],
    ])
    expect(res.body).toMatchObject({
      discountCode: null,
      discountCents: 0,
      subtotalCents: 1525,
      taxCents: 122,
      totalCents: 1647,
    })
  })
})
