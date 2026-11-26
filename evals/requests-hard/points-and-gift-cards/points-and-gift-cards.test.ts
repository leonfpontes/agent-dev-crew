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

// loyalty-points
{
  const pointsOf = async (a: ReturnType<typeof api>, customerId = 'cus_ada') =>
    (await a.get(`/customers/${customerId}`)).body.points

  /** Places and pays an order of COF-BEAN-500 ($14.99 each) to give the customer points. */
  async function earn(a: ReturnType<typeof api>, bags: number, customerId = 'cus_ada') {
    const placed = await a.order(customerId, [['COF-BEAN-500', bags]])
    await a.post(`/orders/${placed.body.id}/pay`)
  }

  describe('loyalty points', () => {
    it('shows a customer with 0 points to start with, and 404 for an unknown one', async () => {
      const a = api()
      expect(await a.get('/customers/cus_ada')).toMatchObject({
        status: 200,
        body: {
          id: 'cus_ada',
          name: 'Ada Brightwater',
          email: 'ada@example.com',
          points: 0,
          lifetimePoints: 0,
          tier: 'standard',
        },
      })
      expect(await a.get('/customers/cus_nobody')).toMatchObject({
        status: 404,
        body: { error: 'Customer not found' },
      })
    })

    it('earns 1 point per whole dollar before tax, when the order is paid and not before', async () => {
      const a = api()
      const placed = await a.order('cus_ada', [['COF-BEAN-500', 1]])
      expect(await pointsOf(a)).toBe(0)
      await a.post(`/orders/${placed.body.id}/pay`)
      expect(await pointsOf(a)).toBe(14)
      expect(await pointsOf(a, 'cus_ben')).toBe(0)
    })

    it('redeems points as a discount when the order is placed, and earns on what is left', async () => {
      const a = api()
      await earn(a, 10) // $149.90: 149 points
      expect(await pointsOf(a)).toBe(149)
      const placed = await a.order('cus_ada', [['APL-GALA-1KG', 2]], { redeemPoints: 100 })
      expect(placed.status).toBe(201)
      expect(placed.body).toMatchObject({
        subtotalCents: 900,
        pointsRedeemed: 100,
        discountCents: 100,
        taxCents: 64,
        totalCents: 864,
      })
      expect(await pointsOf(a)).toBe(49)
      await a.post(`/orders/${placed.body.id}/pay`)
      expect(await pointsOf(a)).toBe(57)
    })

    it('refuses points that are not a whole multiple of 100 within the balance (422), changing nothing', async () => {
      const a = api()
      await earn(a, 10)
      const cartId = await a.cart('cus_ada', [['APL-GALA-1KG', 2]])
      for (const redeemPoints of [150, 200, -100, 1.5]) {
        expect(await a.post('/orders', { cartId, redeemPoints }), String(redeemPoints)).toMatchObject({
          status: 422,
          body: { error: `Cannot redeem ${redeemPoints} points` },
        })
      }
      expect((await a.get('/orders')).body.items).toHaveLength(1)
      expect((await a.get(`/carts/${cartId}`)).body.lines).toHaveLength(1)
      expect(await pointsOf(a)).toBe(149)
    })

    it('refuses more points than the subtotal, and takes 0 as no points', async () => {
      const a = api()
      await earn(a, 30) // $449.70: 449 points
      expect(await a.order('cus_ada', [['MLK-OAT-1L', 1]], { redeemPoints: 400 })).toMatchObject({
        status: 422,
        body: { error: 'Cannot redeem 400 points' },
      })
      const placed = await a.order('cus_ada', [['MLK-OAT-1L', 1]], { redeemPoints: 300 })
      expect(placed.body).toMatchObject({
        subtotalCents: 349,
        discountCents: 300,
        taxCents: 4,
        totalCents: 53,
      })
      expect(await pointsOf(a)).toBe(149)
      const none = await a.order('cus_ada', [['MLK-OAT-1L', 1]], { redeemPoints: 0 })
      expect(none.body).toMatchObject({ pointsRedeemed: 0, discountCents: 0, totalCents: 377 })
    })

    it('rounds the tax once per order, and prints the points on the receipt right after the Subtotal', async () => {
      const a = api()
      const plain = await a.order('cus_ben', [
        ['MLK-OAT-1L', 2],
        ['TOM-HEIR-500', 1],
      ])
      expect(plain.body).toMatchObject({
        pointsRedeemed: 0,
        discountCents: 0,
        taxCents: 97,
        totalCents: 1315,
      })
      const plainLines = (await a.get(`/orders/${plain.body.id}/receipt`)).text.split('\n')
      const p = plainLines.indexOf('Subtotal  $12.18')
      expect(plainLines.slice(p, p + 3)).toEqual(['Subtotal  $12.18', 'Tax  $0.97', 'Total  $13.15'])

      await earn(a, 10)
      const placed = await a.order('cus_ada', [['APL-GALA-1KG', 2]], { redeemPoints: 100 })
      const lines = (await a.get(`/orders/${placed.body.id}/receipt`)).text.split('\n')
      const s = lines.indexOf('Subtotal  $9.00')
      expect(s).toBeGreaterThan(0)
      expect(lines.slice(s, s + 4)).toEqual([
        'Subtotal  $9.00',
        'Points  -$1.00',
        'Tax  $0.64',
        'Total  $8.64',
      ])
    })

    it('gives redeemed points back on cancel and takes back what a paid order earned, never below 0', async () => {
      const a = api()
      const earner = await a.order('cus_ada', [['COF-BEAN-500', 10]])
      await a.post(`/orders/${earner.body.id}/pay`)
      expect((await a.get(`/orders/${earner.body.id}`)).body.pointsEarned).toBe(149)
      const redeemer = await a.order('cus_ada', [['APL-GALA-1KG', 2]], { redeemPoints: 100 })
      expect(redeemer.body.pointsEarned).toBe(0)
      expect(await pointsOf(a)).toBe(49)
      expect(await a.post(`/orders/${earner.body.id}/cancel`)).toMatchObject({
        status: 200,
        body: { id: earner.body.id, status: 'cancelled' },
      })
      expect(await pointsOf(a)).toBe(0)
      expect((await a.post(`/orders/${redeemer.body.id}/cancel`)).body.status).toBe('cancelled')
      expect(await pointsOf(a)).toBe(100)
      expect(await a.post(`/orders/${redeemer.body.id}/cancel`)).toMatchObject({
        status: 409,
        body: { error: 'A cancelled order cannot be cancelled' },
      })
      const shipped = await a.order('cus_ben', [['MLK-OAT-1L', 1]])
      await a.post(`/orders/${shipped.body.id}/pay`)
      await a.post(`/orders/${shipped.body.id}/ship`)
      expect(await a.post(`/orders/${shipped.body.id}/cancel`)).toMatchObject({
        status: 409,
        body: { error: 'A shipped order cannot be cancelled' },
      })
      expect(await a.post('/orders/ord_9999/cancel')).toMatchObject({
        status: 404,
        body: { error: 'Order not found' },
      })
    })

    it('makes a customer gold from 500 lifetime points: 2 points per dollar from the next payment on', async () => {
      const a = api()
      await earn(a, 34) // $509.66: 509 points at the standard rate, even though it crosses 500
      expect((await a.get('/customers/cus_ada')).body).toMatchObject({
        points: 509,
        lifetimePoints: 509,
        tier: 'gold',
      })
      await a.order('cus_ada', [['APL-GALA-1KG', 1]], { redeemPoints: 400 }) // lifetime unchanged
      expect((await a.get('/customers/cus_ada')).body).toMatchObject({
        points: 109,
        lifetimePoints: 509,
        tier: 'gold',
      })
      await earn(a, 1) // $14.99: 28 points as gold
      expect((await a.get('/customers/cus_ada')).body).toMatchObject({ points: 137, lifetimePoints: 537 })
      expect((await a.get('/customers/cus_ben')).body.tier).toBe('standard')
    })
  })
}

// gift-cards
{
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
}

// together
{
  const points = async (a: ReturnType<typeof api>) => (await a.get('/customers/cus_ada')).body.points
  const card = async (a: ReturnType<typeof api>, amountCents: number) =>
    (await a.post('/gift-cards', { amountCents })).body.code as string
  /** Ada pays for 10 bags of coffee ($149.90): 149 points. */
  const earn149 = async (a: ReturnType<typeof api>) => {
    const placed = await a.order('cus_ada', [['COF-BEAN-500', 10]])
    await a.post(`/orders/${placed.body.id}/pay`)
  }

  describe('points and gift cards together', () => {
    it('earns the points when a gift card pays the whole order at placement', async () => {
      const a = api()
      const code = await card(a, 5000)
      const placed = await a.order('cus_ada', [['COF-BEAN-500', 1]], { giftCard: code })
      expect(placed.body).toMatchObject({ status: 'paid', amountDueCents: 0, pointsEarned: 14 })
      expect(await points(a)).toBe(14)
      expect((await a.post(`/orders/${placed.body.id}/pay`)).status).toBe(409)
      expect(await points(a)).toBe(14)
    })

    it('takes the points off first and the gift card pays from what is left; a cancel gives both back', async () => {
      const a = api()
      await earn149(a)
      const code = await card(a, 500)
      const placed = await a.order('cus_ada', [['APL-GALA-1KG', 2]], { redeemPoints: 100, giftCard: code })
      expect(placed.body).toMatchObject({
        subtotalCents: 900,
        discountCents: 100,
        taxCents: 64,
        totalCents: 864,
        giftCardCents: 500,
        amountDueCents: 364,
        status: 'pending',
        pointsEarned: 0,
      })
      expect(await points(a)).toBe(49)
      expect((await a.get(`/gift-cards/${code}`)).body.balanceCents).toBe(0)
      expect((await a.post(`/orders/${placed.body.id}/cancel`)).body.status).toBe('cancelled')
      expect(await points(a)).toBe(149)
      expect((await a.get(`/gift-cards/${code}`)).body.balanceCents).toBe(500)
    })

    it('checks the points before the gift card and moves nothing when either is refused', async () => {
      const a = api()
      await earn149(a)
      const code = await card(a, 1000)
      const cartId = await a.cart('cus_ada', [['APL-GALA-1KG', 2]])
      expect(await a.post('/orders', { cartId, redeemPoints: 150, giftCard: 'GC-0099' })).toMatchObject({
        status: 422,
        body: { error: 'Cannot redeem 150 points' },
      })
      expect(await a.post('/orders', { cartId, redeemPoints: 100, giftCard: 'GC-0099' })).toMatchObject({
        status: 404,
        body: { error: 'Gift card not found' },
      })
      expect(await points(a)).toBe(149)
      expect((await a.get(`/gift-cards/${code}`)).body.balanceCents).toBe(1000)
      expect((await a.get(`/carts/${cartId}`)).body.lines).toHaveLength(1)
    })
  })
}
