import { describe, expect, it } from 'vitest'

import { formatCents } from '../src/index.js'
import { client, NOW } from './helpers.js'

describe('orders', () => {
  it('places an order from a cart, with the totals and the status pending', async () => {
    const api = client()
    const res = await api.order('cus_ada', [
      ['APL-GALA-1KG', 2],
      ['BRD-SOUR-800', 1],
    ])
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      id: 'ord_0001',
      customerId: 'cus_ada',
      subtotalCents: 1525,
      taxCents: 122,
      totalCents: 1647,
      status: 'pending',
      createdAt: NOW.toISOString(),
    })
    expect(res.body.lines).toEqual([
      { sku: 'APL-GALA-1KG', name: 'Gala apples, 1 kg', unitCents: 450, quantity: 2, lineCents: 900 },
      { sku: 'BRD-SOUR-800', name: 'Sourdough loaf, 800 g', unitCents: 625, quantity: 1, lineCents: 625 },
    ])
  })

  it('empties the cart once the order is placed', async () => {
    const api = client()
    const cart = await api.post('/carts', { customerId: 'cus_ben' })
    await api.post(`/carts/${cart.body.id}/items`, { sku: 'EGG-FREE-12', quantity: 1 })
    await api.post('/orders', { cartId: cart.body.id })
    expect((await api.get(`/carts/${cart.body.id}`)).body.lines).toEqual([])
  })

  it('refuses an empty cart with 422', async () => {
    const api = client()
    const cart = await api.post('/carts', { customerId: 'cus_ben' })
    expect(await api.post('/orders', { cartId: cart.body.id })).toMatchObject({
      status: 422,
      body: { error: 'The cart is empty' },
    })
  })

  it('answers 404 for a cart that does not exist', async () => {
    expect((await client().post('/orders', { cartId: 'cart_9999' })).status).toBe(404)
  })

  it('answers 400 without a cartId', async () => {
    expect(await client().post('/orders', {})).toMatchObject({
      status: 400,
      body: { error: 'cartId is required' },
    })
  })

  it('lists orders oldest first', async () => {
    const api = client()
    await api.order('cus_ada', [['MLK-OAT-1L', 1]])
    api.setNow(new Date('2026-11-20T09:00:00Z'))
    await api.order('cus_ben', [['EGG-FREE-12', 1]])
    const list = await api.get('/orders')
    expect(list.status).toBe(200)
    expect(list.body.items.map((o: { id: string }) => o.id)).toEqual(['ord_0002', 'ord_0001'])
  })

  it('finds one order, and answers 404 for an unknown id', async () => {
    const api = client()
    const placed = await api.order('cus_cleo', [['COF-BEAN-500', 1]])
    expect((await api.get(`/orders/${placed.body.id}`)).body).toEqual(placed.body)
    expect(await api.get('/orders/ord_9999')).toMatchObject({
      status: 404,
      body: { error: 'Order not found' },
    })
  })

  it('takes payment once', async () => {
    const api = client()
    const placed = await api.order('cus_ada', [['TOM-HEIR-500', 1]])
    expect((await api.post(`/orders/${placed.body.id}/pay`)).body.status).toBe('paid')
    expect(await api.post(`/orders/${placed.body.id}/pay`)).toMatchObject({
      status: 409,
      body: { error: 'A paid order cannot be paid' },
    })
  })

  it('ships only paid orders', async () => {
    const api = client()
    const placed = await api.order('cus_ada', [['TOM-HEIR-500', 1]])
    expect((await api.post(`/orders/${placed.body.id}/ship`)).status).toBe(409)
    await api.post(`/orders/${placed.body.id}/pay`)
    expect((await api.post(`/orders/${placed.body.id}/ship`)).body.status).toBe('shipped')
  })

  it('prints a plain-text receipt with every line and the totals', async () => {
    const api = client()
    const placed = await api.order('cus_ben', [
      ['BRD-SOUR-800', 1],
      ['EGG-FREE-12', 1],
    ])
    const res = await api.get(`/orders/${placed.body.id}/receipt`)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(res.text).toBe(
      [
        'Fernhill Market',
        'Order ord_0001',
        'Customer: Ben Okafor',
        '',
        '1 × Sourdough loaf, 800 g  $6.25',
        '1 × Free-range eggs, 12  $5.99',
        '',
        'Subtotal  $12.24',
        'Tax  $0.98',
        'Total  $13.22',
        '',
      ].join('\n'),
    )
  })

  it('formats cents as dollars and refuses fractions of a cent', () => {
    expect(formatCents(8400)).toBe('$84.00')
    expect(formatCents(-1950)).toBe('-$19.50')
    expect(() => formatCents(1.5)).toThrow('Amounts are whole cents, got 1.5.')
  })
})
