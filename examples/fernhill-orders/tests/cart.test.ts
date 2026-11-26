import { describe, expect, it } from 'vitest'

import { client } from './helpers.js'

describe('carts', () => {
  it('creates an empty cart for a known customer', async () => {
    const api = client()
    expect(await api.post('/carts', { customerId: 'cus_ada' })).toMatchObject({
      status: 201,
      body: { id: 'cart_0001', customerId: 'cus_ada', lines: [] },
    })
    expect((await api.post('/carts', { customerId: 'cus_nobody' })).status).toBe(404)
  })

  it('answers 400 without a customerId', async () => {
    expect((await client().post('/carts', {})).status).toBe(400)
  })

  it('adds an item at the catalog price', async () => {
    const api = client()
    const cart = await api.post('/carts', { customerId: 'cus_ada' })
    const res = await api.post(`/carts/${cart.body.id}/items`, { sku: 'MLK-OAT-1L', quantity: 3 })
    expect(res.body.lines).toEqual([
      { sku: 'MLK-OAT-1L', name: 'Oat milk, 1 l', unitCents: 349, quantity: 3, lineCents: 1047 },
    ])
  })

  it('merges the same SKU into one line', async () => {
    const api = client()
    const cart = await api.post('/carts', { customerId: 'cus_ada' })
    await api.post(`/carts/${cart.body.id}/items`, { sku: 'APL-GALA-1KG', quantity: 1 })
    const res = await api.post(`/carts/${cart.body.id}/items`, { sku: 'APL-GALA-1KG', quantity: 2 })
    expect(res.body.lines).toHaveLength(1)
    expect(res.body.lines[0]).toMatchObject({ quantity: 3, lineCents: 1350 })
  })

  it('refuses a missing SKU or a quantity below 1', async () => {
    const api = client()
    const cart = await api.post('/carts', { customerId: 'cus_ada' })
    expect((await api.post(`/carts/${cart.body.id}/items`, { quantity: 1 })).status).toBe(400)
    expect((await api.post(`/carts/${cart.body.id}/items`, { sku: 'MLK-OAT-1L', quantity: 0 })).status).toBe(
      400,
    )
    expect(
      (await api.post(`/carts/${cart.body.id}/items`, { sku: 'MLK-OAT-1L', quantity: 1.5 })).status,
    ).toBe(400)
  })

  it('answers 404 for a cart that does not exist', async () => {
    const api = client()
    expect((await api.get('/carts/cart_9999')).status).toBe(404)
    expect((await api.post('/carts/cart_9999/items', { sku: 'MLK-OAT-1L' })).status).toBe(404)
  })
})
