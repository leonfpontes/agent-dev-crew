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

// promotions
{
  describe('multi-buy promotions', () => {
    it('Apples 3 for 2: every third unit of APL-GALA-1KG is free', async () => {
      const res = await api().order('cus_ada', [['APL-GALA-1KG', 7]])
      expect(res.status).toBe(201)
      expect(res.body).toMatchObject({
        subtotalCents: 3150,
        discountCents: 900,
        promotions: [{ name: 'Apples 3 for 2', discountCents: 900 }],
        taxCents: 180,
        totalCents: 2430,
      })
    })

    it('applies nothing under three apples', async () => {
      const res = await api().order('cus_ada', [['APL-GALA-1KG', 2]])
      expect(res.body).toMatchObject({
        subtotalCents: 900,
        discountCents: 0,
        promotions: [],
        taxCents: 72,
        totalCents: 972,
      })
    })

    it('Coffee and milk: $1.50 off each pair; no Big basket when the pairs bring the subtotal under $50.00', async () => {
      const res = await api().order('cus_ben', [
        ['COF-BEAN-500', 3],
        ['MLK-OAT-1L', 2],
      ])
      expect(res.body).toMatchObject({
        subtotalCents: 5195,
        discountCents: 300,
        promotions: [{ name: 'Coffee and milk', discountCents: 300 }],
        taxCents: 392,
        totalCents: 5287,
      })
    })

    it('Big basket: $5.00 off at $50.00 or more after the other promotions, once per customer per New York day', async () => {
      const a = api()
      const big = await a.order('cus_ada', [['COF-BEAN-500', 4]])
      expect(big.body).toMatchObject({
        subtotalCents: 5996,
        discountCents: 500,
        promotions: [{ name: 'Big basket', discountCents: 500 }],
        taxCents: 440,
        totalCents: 5936,
      })
      a.at('2026-11-21T03:00:00Z') // still 2026-11-20 in New York
      const again = await a.order('cus_ada', [['COF-BEAN-500', 4]])
      expect(again.body).toMatchObject({ discountCents: 0, promotions: [], taxCents: 480, totalCents: 6476 })
      expect((await a.order('cus_ben', [['COF-BEAN-500', 4]])).body.discountCents).toBe(500)
      a.at('2026-11-21T06:00:00Z') // 2026-11-21 in New York
      expect((await a.order('cus_ada', [['COF-BEAN-500', 4]])).body.promotions).toEqual([
        { name: 'Big basket', discountCents: 500 },
      ])
    })

    it('applies all three in order, Big basket last', async () => {
      const res = await api().order('cus_ada', [
        ['APL-GALA-1KG', 9],
        ['MLK-OAT-1L', 1],
        ['COF-BEAN-500', 3],
      ])
      expect(res.body).toMatchObject({
        subtotalCents: 8896,
        discountCents: 2000,
        promotions: [
          { name: 'Apples 3 for 2', discountCents: 1350 },
          { name: 'Coffee and milk', discountCents: 150 },
          { name: 'Big basket', discountCents: 500 },
        ],
        taxCents: 552,
        totalCents: 7448,
      })
    })

    it('lists both promotions in the order of the request, whatever the order of the lines', async () => {
      const res = await api().order('cus_cleo', [
        ['COF-BEAN-500', 1],
        ['MLK-OAT-1L', 1],
        ['APL-GALA-1KG', 3],
      ])
      expect(res.body).toMatchObject({
        subtotalCents: 3198,
        discountCents: 600,
        promotions: [
          { name: 'Apples 3 for 2', discountCents: 450 },
          { name: 'Coffee and milk', discountCents: 150 },
        ],
        taxCents: 208,
        totalCents: 2806,
      })
    })

    it('rounds the tax once for the whole order, also without a promotion', async () => {
      const res = await api().order('cus_ada', [
        ['MLK-OAT-1L', 2],
        ['TOM-HEIR-500', 1],
      ])
      expect(res.body).toMatchObject({
        subtotalCents: 1218,
        discountCents: 0,
        taxCents: 97,
        totalCents: 1315,
      })
    })

    it('prints one receipt line per promotion right after the Subtotal, and the daily total uses the new totals', async () => {
      const a = api()
      const placed = await a.order('cus_ben', [
        ['COF-BEAN-500', 1],
        ['MLK-OAT-1L', 1],
        ['APL-GALA-1KG', 3],
      ])
      const lines = (await a.get(`/orders/${placed.body.id}/receipt`)).text.split('\n')
      const at = lines.indexOf('Subtotal  $31.98')
      expect(at).toBeGreaterThan(0)
      expect(lines.slice(at, at + 5)).toEqual([
        'Subtotal  $31.98',
        'Apples 3 for 2  -$4.50',
        'Coffee and milk  -$1.50',
        'Tax  $2.08',
        'Total  $28.06',
      ])
      const plain = await a.order('cus_ada', [['COF-BEAN-500', 1]])
      const plainLines = (await a.get(`/orders/${plain.body.id}/receipt`)).text.split('\n')
      const s = plainLines.indexOf('Subtotal  $14.99')
      expect(plainLines.slice(s, s + 3)).toEqual(['Subtotal  $14.99', 'Tax  $1.20', 'Total  $16.19'])
      expect((await a.get('/reports/daily-total?date=2026-11-20')).body.totalCents).toBe(2806 + 1619)
    })
  })
}

// price-changes
{
  const APL = 'APL-GALA-1KG'
  const setPrice = (a: ReturnType<typeof api>, sku: string, unitCents: unknown) =>
    a.post(`/products/${sku}/price`, { unitCents })

  describe('price changes', () => {
    it('changes a price and keeps its history; the same price again records nothing', async () => {
      const a = api()
      expect(await setPrice(a, APL, 500)).toMatchObject({
        status: 200,
        body: { sku: APL, name: 'Gala apples, 1 kg', unitCents: 500, stock: 40 },
      })
      a.tick(3600)
      await setPrice(a, APL, 480)
      a.tick(60)
      expect((await setPrice(a, APL, 480)).status).toBe(200)
      expect((await a.get(`/products/${APL}/prices`)).body).toEqual({
        sku: APL,
        history: [
          { unitCents: 450, from: null },
          { unitCents: 500, from: '2026-11-20T10:00:00.000Z' },
          { unitCents: 480, from: '2026-11-20T11:00:00.000Z' },
        ],
      })
    })

    it("shows a cart at today's prices", async () => {
      const a = api()
      const cartId = await a.cart('cus_ada', [[APL, 2]])
      await setPrice(a, APL, 500)
      expect((await a.get(`/carts/${cartId}`)).body.lines).toEqual([
        { sku: APL, name: 'Gala apples, 1 kg', unitCents: 500, quantity: 2, lineCents: 1000 },
      ])
    })

    it("prices every line at today's price when items are added after a change", async () => {
      const a = api()
      const cartId = await a.cart('cus_ada', [[APL, 1]])
      await setPrice(a, APL, 480)
      const more = await a.post(`/carts/${cartId}/items`, { sku: APL, quantity: 1 })
      expect(more.body.lines).toEqual([
        { sku: APL, name: 'Gala apples, 1 kg', unitCents: 480, quantity: 2, lineCents: 960 },
      ])
      await setPrice(a, APL, 400)
      const other = await a.post(`/carts/${cartId}/items`, { sku: 'MLK-OAT-1L', quantity: 1 })
      expect(other.body.lines).toEqual([
        { sku: APL, name: 'Gala apples, 1 kg', unitCents: 400, quantity: 2, lineCents: 800 },
        { sku: 'MLK-OAT-1L', name: 'Oat milk, 1 l', unitCents: 349, quantity: 1, lineCents: 349 },
      ])
    })

    it('places an order at the prices of that moment, even for items added before the change', async () => {
      const a = api()
      const cartId = await a.cart('cus_ada', [
        [APL, 2],
        ['BRD-SOUR-800', 1],
      ])
      await setPrice(a, APL, 500)
      const placed = await a.post('/orders', { cartId })
      expect(placed.body).toMatchObject({ subtotalCents: 1625, taxCents: 130, totalCents: 1755 })
      expect(placed.body.lines[0]).toEqual({
        sku: APL,
        name: 'Gala apples, 1 kg',
        unitCents: 500,
        quantity: 2,
        lineCents: 1000,
      })
    })

    it('never changes an order already placed: not the order, its receipt or the daily total', async () => {
      const a = api()
      const placed = await a.order('cus_ada', [[APL, 2]])
      await setPrice(a, APL, 999)
      expect((await a.get(`/orders/${placed.body.id}`)).body).toEqual(placed.body)
      const receipt = (await a.get(`/orders/${placed.body.id}/receipt`)).text.split('\n')
      expect(receipt).toContain('2 × Gala apples, 1 kg  $9.00')
      expect(receipt).toContain('Total  $9.72')
      expect((await a.get('/reports/daily-total?date=2026-11-20')).body.totalCents).toBe(972)
    })

    it('refuses a price that is not a whole number above 0 (400) and an unknown product (404)', async () => {
      const a = api()
      for (const unitCents of [0, -5, 1.5, '500', undefined]) {
        expect(await setPrice(a, APL, unitCents), String(unitCents)).toMatchObject({
          status: 400,
          body: { error: 'unitCents must be a whole number above 0' },
        })
      }
      expect((await a.get(`/products/${APL}/prices`)).body.history).toHaveLength(1)
      expect(await setPrice(a, 'XYZ-NOPE-1', 500)).toMatchObject({
        status: 404,
        body: { error: 'Product not found' },
      })
      expect(await a.get('/products/XYZ-NOPE-1/prices')).toMatchObject({
        status: 404,
        body: { error: 'Product not found' },
      })
    })

    it('schedules a price with a future from: carts and new orders switch at that time on their own', async () => {
      const a = api()
      expect(
        await a.post(`/products/${APL}/price`, { unitCents: 500, from: '2026-11-21T00:00:00Z' }),
      ).toMatchObject({
        status: 200,
        body: { sku: APL, unitCents: 450 },
      })
      const cartId = await a.cart('cus_ada', [[APL, 1]])
      expect((await a.get(`/carts/${cartId}`)).body.lines[0]).toMatchObject({
        unitCents: 450,
        lineCents: 450,
      })
      a.at('2026-11-20T23:59:59Z')
      expect((await a.order('cus_ben', [[APL, 1]])).body.subtotalCents).toBe(450)
      a.at('2026-11-21T00:00:00Z')
      expect((await a.get(`/carts/${cartId}`)).body.lines[0]).toMatchObject({
        unitCents: 500,
        lineCents: 500,
      })
      expect((await a.post('/orders', { cartId })).body.subtotalCents).toBe(500)
      expect((await a.get(`/products/${APL}/prices`)).body.history).toEqual([
        { unitCents: 450, from: null },
        { unitCents: 500, from: '2026-11-21T00:00:00.000Z' },
      ])
    })

    it('orders the history by from, replaces a schedule with the same from, starts a past from now, and refuses a bad from', async () => {
      const a = api()
      const schedule = (unitCents: number, from: string) =>
        a.post(`/products/${APL}/price`, { unitCents, from })
      await schedule(520, '2026-11-22T00:00:00Z')
      await schedule(480, '2026-11-21T00:00:00Z')
      await schedule(490, '2026-11-21T00:00:00.000Z')
      expect((await a.get(`/products/${APL}/prices`)).body.history).toEqual([
        { unitCents: 450, from: null },
        { unitCents: 490, from: '2026-11-21T00:00:00.000Z' },
        { unitCents: 520, from: '2026-11-22T00:00:00.000Z' },
      ])
      const cartId = await a.cart('cus_ada', [[APL, 2]])
      a.at('2026-11-21T12:00:00Z')
      expect((await a.get(`/carts/${cartId}`)).body.lines[0].lineCents).toBe(980)
      a.at('2026-11-22T08:00:00Z')
      expect((await a.get(`/carts/${cartId}`)).body.lines[0].lineCents).toBe(1040)

      expect((await schedule(530, '2026-11-01T00:00:00Z')).body.unitCents).toBe(530)
      expect((await a.get(`/products/${APL}/prices`)).body.history.at(-1)).toEqual({
        unitCents: 530,
        from: '2026-11-22T08:00:00.000Z',
      })
      expect(await schedule(540, 'tomorrow')).toMatchObject({
        status: 400,
        body: { error: 'from must be an ISO 8601 time' },
      })
    })
  })
}

// together
{
  describe('promotions at the prices of the moment', () => {
    it('frees the third apple at the price in force when the order is placed', async () => {
      const a = api()
      await a.post('/products/APL-GALA-1KG/price', { unitCents: 500, from: '2026-11-21T00:00:00Z' })
      const cartId = await a.cart('cus_ada', [['APL-GALA-1KG', 3]])
      a.at('2026-11-21T09:00:00Z')
      const placed = await a.post('/orders', { cartId })
      expect(placed.body).toMatchObject({
        subtotalCents: 1500,
        discountCents: 500,
        promotions: [{ name: 'Apples 3 for 2', discountCents: 500 }],
        taxCents: 80,
        totalCents: 1080,
      })
      const lines = (await a.get(`/orders/${placed.body.id}/receipt`)).text.split('\n')
      expect(lines).toContain('3 × Gala apples, 1 kg  $15.00')
      expect(lines).toContain('Apples 3 for 2  -$5.00')
    })

    it('measures Big basket on the prices of the moment, so a price change can make an order qualify', async () => {
      const a = api()
      expect((await a.order('cus_ada', [['COF-BEAN-500', 3]])).body).toMatchObject({
        subtotalCents: 4497,
        promotions: [],
        totalCents: 4857,
      })
      await a.post('/products/COF-BEAN-500/price', { unitCents: 1700 })
      expect((await a.order('cus_ben', [['COF-BEAN-500', 3]])).body).toMatchObject({
        subtotalCents: 5100,
        discountCents: 500,
        promotions: [{ name: 'Big basket', discountCents: 500 }],
        taxCents: 368,
        totalCents: 4968,
      })
    })
  })
}
