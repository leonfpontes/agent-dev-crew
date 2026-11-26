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

const card = async (a: ReturnType<typeof api>, amountCents: number) =>
  (await a.post('/gift-cards', { amountCents })).body.code as string
const balanceOf = async (a: ReturnType<typeof api>, code: string) =>
  (await a.get(`/gift-cards/${code}`)).body.balanceCents

describe('gift cards', () => {
  it('creates cards with codes in order, and finds them ignoring case', async () => {
    const a = api()
    expect(await a.post('/gift-cards', { amountCents: 2000 })).toMatchObject({
      status: 201,
      body: { code: 'GC-0001', balanceCents: 2000 },
    })
    expect((await a.post('/gift-cards', { amountCents: 500 })).body.code).toBe('GC-0002')
    expect(await a.get('/gift-cards/gc-0001')).toMatchObject({
      status: 200,
      body: { code: 'GC-0001', balanceCents: 2000 },
    })
    expect(await a.get('/gift-cards/GC-0099')).toMatchObject({
      status: 404,
      body: { error: 'Gift card not found' },
    })
  })

  it('takes amounts from 500 to 50000 whole cents only', async () => {
    const a = api()
    for (const amountCents of [499, 50001, 12.5, '1000', undefined])
      expect(await a.post('/gift-cards', { amountCents }), String(amountCents)).toMatchObject({
        status: 400,
        body: { error: 'amountCents must be a whole number from 500 to 50000' },
      })
    expect((await a.post('/gift-cards', { amountCents: 500 })).status).toBe(201)
    expect((await a.post('/gift-cards', { amountCents: 50000 })).body.code).toBe('GC-0002')
  })

  it('pays part of an order without changing its totals, and leaves the rest due', async () => {
    const a = api()
    const code = await card(a, 1000)
    const placed = await a.order('cus_ada', [['COF-BEAN-500', 1]], { giftCard: code })
    expect(placed.status).toBe(201)
    expect(placed.body).toMatchObject({
      subtotalCents: 1499,
      taxCents: 120,
      totalCents: 1619,
      giftCard: 'GC-0001',
      giftCardCents: 1000,
      amountDueCents: 619,
      status: 'pending',
    })
    expect(await balanceOf(a, code)).toBe(0)
    const plain = await a.order('cus_ben', [['MLK-OAT-1L', 1]])
    expect(plain.body).toMatchObject({
      giftCard: null,
      giftCardCents: 0,
      amountDueCents: 377,
      status: 'pending',
    })
  })

  it('places an order as paid when the card covers it all, keeping the rest on the card', async () => {
    const a = api()
    await card(a, 5000)
    const placed = await a.order('cus_ada', [['APL-GALA-1KG', 2]], { giftCard: 'gc-0001' })
    expect(placed.body).toMatchObject({
      totalCents: 972,
      giftCard: 'GC-0001',
      giftCardCents: 972,
      amountDueCents: 0,
      status: 'paid',
    })
    expect(await balanceOf(a, 'GC-0001')).toBe(4028)
    expect(await a.post(`/orders/${placed.body.id}/pay`)).toMatchObject({
      status: 409,
      body: { error: 'A paid order cannot be paid' },
    })
    expect((await a.post(`/orders/${placed.body.id}/ship`)).body.status).toBe('shipped')
  })

  it('refuses an unknown card (404) and an empty one (422), changing nothing', async () => {
    const a = api()
    const code = await card(a, 1000)
    await a.order('cus_ada', [['COF-BEAN-500', 1]], { giftCard: code })
    const cartId = await a.cart('cus_ben', [['APL-GALA-1KG', 1]])
    expect(await a.post('/orders', { cartId, giftCard: 'GC-0099' })).toMatchObject({
      status: 404,
      body: { error: 'Gift card not found' },
    })
    expect(await a.post('/orders', { cartId, giftCard: code })).toMatchObject({
      status: 422,
      body: { error: 'Gift card is empty' },
    })
    expect((await a.get('/orders')).body.items).toHaveLength(1)
    expect((await a.get(`/carts/${cartId}`)).body.lines).toHaveLength(1)
    const other = await card(a, 800)
    expect(await a.post('/orders', { cartId, giftCard: 'GC-0099' })).toMatchObject({ status: 404 })
    expect(await balanceOf(a, other)).toBe(800)
  })

  it('prints the card and the amount due right after the Total line of the receipt', async () => {
    const a = api()
    const code = await card(a, 500)
    const placed = await a.order('cus_ada', [['COF-BEAN-500', 1]], { giftCard: code })
    const lines = (await a.get(`/orders/${placed.body.id}/receipt`)).text.split('\n')
    const at = lines.indexOf('Total  $16.19')
    expect(at).toBeGreaterThan(0)
    expect(lines.slice(at, at + 3)).toEqual([
      'Total  $16.19',
      'Gift card GC-0001  -$5.00',
      'Amount due  $11.19',
    ])
    const plain = await a.order('cus_ben', [['COF-BEAN-500', 1]])
    const plainLines = (await a.get(`/orders/${plain.body.id}/receipt`)).text.split('\n')
    expect(plainLines.slice(plainLines.indexOf('Total  $16.19'))).toEqual(['Total  $16.19', ''])
  })
})
