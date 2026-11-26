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

// stock-reservations
{
  const stockOf = async (a: ReturnType<typeof api>) => {
    const res = await a.get('/products')
    return Object.fromEntries(res.body.items.map((p: { sku: string; stock: number }) => [p.sku, p.stock]))
  }

  describe('reserve stock when orders are placed and cancelled', () => {
    it('lists the products with their stock, in catalog order', async () => {
      const res = await api().get('/products')
      expect(res.status).toBe(200)
      expect(res.body.items.map((p: { sku: string }) => p.sku)).toEqual([
        'APL-GALA-1KG',
        'BRD-SOUR-800',
        'EGG-FREE-12',
        'MLK-OAT-1L',
        'CHS-CHED-200',
        'COF-BEAN-500',
        'HNY-WILD-350',
        'TOM-HEIR-500',
      ])
      expect(res.body.items[0]).toEqual({
        sku: 'APL-GALA-1KG',
        name: 'Gala apples, 1 kg',
        unitCents: 450,
        stock: 40,
      })
      expect(res.body.items[6]).toMatchObject({ sku: 'HNY-WILD-350', stock: 0 })
    })

    it('takes each line out of stock when the order is placed, down to zero', async () => {
      const a = api()
      expect(
        (
          await a.order('cus_ada', [
            ['APL-GALA-1KG', 3],
            ['CHS-CHED-200', 2],
          ])
        ).status,
      ).toBe(201)
      expect(await stockOf(a)).toMatchObject({ 'APL-GALA-1KG': 37, 'CHS-CHED-200': 6, 'BRD-SOUR-800': 12 })
      expect((await a.order('cus_ben', [['APL-GALA-1KG', 37]])).status).toBe(201)
      expect((await stockOf(a))['APL-GALA-1KG']).toBe(0)
    })

    it('refuses an order with a line above the stock left (409), naming the first such line, and changes nothing', async () => {
      const a = api()
      const cartId = await a.cart('cus_ada', [
        ['APL-GALA-1KG', 2],
        ['CHS-CHED-200', 9],
        ['HNY-WILD-350', 1],
      ])
      expect(await a.post('/orders', { cartId })).toMatchObject({
        status: 409,
        body: { error: 'Not enough stock for CHS-CHED-200' },
      })
      expect((await a.get(`/carts/${cartId}`)).body.lines).toHaveLength(3)
      expect((await a.get('/orders')).body.items).toEqual([])
      expect(await stockOf(a)).toMatchObject({ 'APL-GALA-1KG': 40, 'CHS-CHED-200': 8 })

      expect((await a.order('cus_ben', [['CHS-CHED-200', 5]])).status).toBe(201)
      expect(await a.order('cus_cleo', [['CHS-CHED-200', 4]])).toMatchObject({
        status: 409,
        body: { error: 'Not enough stock for CHS-CHED-200' },
      })
      expect((await stockOf(a))['CHS-CHED-200']).toBe(3)
    })

    it('refuses a SKU that is not in the catalog (422); the first failing line in cart order decides', async () => {
      const a = api()
      const cartId = await a.cart('cus_ada', [
        ['APL-GALA-1KG', 1],
        ['XYZ-NOPE-1', 2],
        ['HNY-WILD-350', 1],
      ])
      expect(await a.post('/orders', { cartId })).toMatchObject({
        status: 422,
        body: { error: 'Unknown SKU XYZ-NOPE-1' },
      })
      expect(
        await a.order('cus_ben', [
          ['HNY-WILD-350', 1],
          ['XYZ-NOPE-1', 1],
        ]),
      ).toMatchObject({ status: 409, body: { error: 'Not enough stock for HNY-WILD-350' } })
      expect((await a.get(`/carts/${cartId}`)).body.lines).toHaveLength(3)
      expect((await a.get('/orders')).body.items).toEqual([])
      expect((await stockOf(a))['APL-GALA-1KG']).toBe(40)
    })

    it('cancels a pending or paid order and puts its quantities back; refuses shipped, cancelled and unknown orders', async () => {
      const a = api()
      const pending = await a.order('cus_ada', [['COF-BEAN-500', 4]])
      const paid = await a.order('cus_ben', [['COF-BEAN-500', 5]])
      await a.post(`/orders/${paid.body.id}/pay`)
      const shipped = await a.order('cus_cleo', [['COF-BEAN-500', 1]])
      await a.post(`/orders/${shipped.body.id}/pay`)
      await a.post(`/orders/${shipped.body.id}/ship`)
      expect((await stockOf(a))['COF-BEAN-500']).toBe(5)

      const cancelled = await a.post(`/orders/${pending.body.id}/cancel`)
      expect(cancelled).toMatchObject({ status: 200, body: { id: pending.body.id, status: 'cancelled' } })
      expect((await a.post(`/orders/${paid.body.id}/cancel`)).body.status).toBe('cancelled')
      expect((await stockOf(a))['COF-BEAN-500']).toBe(14)

      expect(await a.post(`/orders/${shipped.body.id}/cancel`)).toMatchObject({
        status: 409,
        body: { error: 'A shipped order cannot be cancelled' },
      })
      expect(await a.post(`/orders/${pending.body.id}/cancel`)).toMatchObject({
        status: 409,
        body: { error: 'A cancelled order cannot be cancelled' },
      })
      expect((await stockOf(a))['COF-BEAN-500']).toBe(14)
      expect(await a.post('/orders/ord_9999/cancel')).toMatchObject({
        status: 404,
        body: { error: 'Order not found' },
      })
    })

    it('keeps cancelled orders from being paid or shipped, and out of the daily total', async () => {
      const a = api()
      const kept = await a.order('cus_ada', [['APL-GALA-1KG', 2]]) // 900 + 72
      const gone = await a.order('cus_ben', [['BRD-SOUR-800', 1]])
      await a.post(`/orders/${gone.body.id}/cancel`)
      expect(await a.post(`/orders/${gone.body.id}/pay`)).toMatchObject({
        status: 409,
        body: { error: 'A cancelled order cannot be paid' },
      })
      expect(await a.post(`/orders/${gone.body.id}/ship`)).toMatchObject({
        status: 409,
        body: { error: 'A cancelled order cannot be shipped' },
      })
      expect(kept.body.totalCents).toBe(972)
      expect((await a.get('/reports/daily-total?date=2026-11-20')).body.totalCents).toBe(972)
    })

    it('never oversells when orders race for the last units, and returns a raced cancel only once', async () => {
      const a = api()
      const carts = []
      for (const customerId of ['cus_ada', 'cus_ben', 'cus_cleo', 'cus_ada', 'cus_ben'])
        carts.push(await a.cart(customerId, [['CHS-CHED-200', 2]]))
      const placed = await Promise.all(carts.map((cartId) => a.post('/orders', { cartId })))
      expect(placed.map((r) => r.status).sort()).toEqual([201, 201, 201, 201, 409])
      expect((await stockOf(a))['CHS-CHED-200']).toBe(0)
      expect((await a.get('/orders')).body.items).toHaveLength(4)

      const id = placed.find((r) => r.status === 201)!.body.id
      const cancels = await Promise.all([a.post(`/orders/${id}/cancel`), a.post(`/orders/${id}/cancel`)])
      expect(cancels.map((r) => r.status).sort()).toEqual([200, 409])
      expect((await stockOf(a))['CHS-CHED-200']).toBe(2)
    })
  })
}

// idempotency-keys
{
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

    it('makes a request that arrives while the first with its key is still running wait, then replay', async () => {
      const a = api()
      const cartId = await a.cart('cus_ada', [['APL-GALA-1KG', 2]])
      const [first, second] = await Promise.all([
        a.post('/orders', { cartId }, key('race')),
        a.post('/orders', { cartId }, key('race')),
      ])
      expect([first.status, second.status]).toEqual([201, 201])
      expect(second.body).toEqual(first.body)
      expect([first.headers.get('idempotent-replayed'), second.headers.get('idempotent-replayed')]).toEqual([
        null,
        'true',
      ])
      expect((await a.get('/orders')).body.items).toHaveLength(1)

      const other = await a.cart('cus_ben', [['BRD-SOUR-800', 1]])
      const mine = await a.cart('cus_cleo', [['EGG-FREE-12', 1]])
      const [won, reused] = await Promise.all([
        a.post('/orders', { cartId: mine }, key('race-2')),
        a.post('/orders', { cartId: other }, key('race-2')),
      ])
      expect(won.status).toBe(201)
      expect(reused).toMatchObject({ status: 422, body: { error: REUSED } })
      expect((await a.get('/orders')).body.items).toHaveLength(2)
    })
  })
}

// together
{
  const key = (value: string) => ({ 'Idempotency-Key': value })
  const stock = async (a: ReturnType<typeof api>, sku: string) =>
    (await a.get('/products')).body.items.find((p: { sku: string }) => p.sku === sku).stock

  describe('retries and stock together', () => {
    it('takes stock once for a retried order, and does not remember a refusal for lack of stock', async () => {
      const a = api()
      const first = await a.cart('cus_ada', [['CHS-CHED-200', 6]])
      const placed = await a.post('/orders', { cartId: first }, key('cheese-1'))
      expect(
        (await a.post('/orders', { cartId: first }, key('cheese-1'))).headers.get('idempotent-replayed'),
      ).toBe('true')
      expect(await stock(a, 'CHS-CHED-200')).toBe(2)
      const second = await a.cart('cus_ben', [['CHS-CHED-200', 5]])
      expect(await a.post('/orders', { cartId: second }, key('cheese-2'))).toMatchObject({
        status: 409,
        body: { error: 'Not enough stock for CHS-CHED-200' },
      })
      await a.post(`/orders/${placed.body.id}/cancel`)
      const retried = await a.post('/orders', { cartId: second }, key('cheese-2'))
      expect(retried.status).toBe(201)
      expect(retried.headers.get('idempotent-replayed')).toBeNull()
      expect(await stock(a, 'CHS-CHED-200')).toBe(3)
    })

    it('takes the Idempotency-Key on cancel too: a retried cancel answers 200 again and gives the stock back once', async () => {
      const a = api()
      const placed = await a.order('cus_ada', [['COF-BEAN-500', 5]])
      const id = placed.body.id as string
      const [one, two] = await Promise.all([
        a.post(`/orders/${id}/cancel`, {}, key('undo')),
        a.post(`/orders/${id}/cancel`, {}, key('undo')),
      ])
      expect([one.status, two.status]).toEqual([200, 200])
      expect(two.body).toEqual(one.body)
      expect(two.headers.get('idempotent-replayed')).toBe('true')
      expect(await stock(a, 'COF-BEAN-500')).toBe(15)
      expect(await a.post(`/orders/${id}/cancel`)).toMatchObject({
        status: 409,
        body: { error: 'A cancelled order cannot be cancelled' },
      })
    })
  })
}
