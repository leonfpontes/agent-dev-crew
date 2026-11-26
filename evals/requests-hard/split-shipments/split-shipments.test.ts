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

const APL = 'APL-GALA-1KG'
const BRD = 'BRD-SOUR-800'
const LINES_ERROR = 'lines must be a non-empty list of { sku, quantity }'

async function paidOrder(a = api()) {
  const placed = await a.order('cus_ada', [
    [APL, 3],
    [BRD, 2],
  ])
  await a.post(`/orders/${placed.body.id}/pay`)
  return { a, id: placed.body.id as string }
}

describe('ship an order in parts', () => {
  it('starts every order with nothing shipped and no shipments, and keeps its lines', async () => {
    const placed = await api().order('cus_ada', [
      [APL, 3],
      [BRD, 2],
    ])
    expect(placed.body).toMatchObject({ shipped: { [APL]: 0, [BRD]: 0 }, shipments: [], status: 'pending' })
    expect(placed.body.lines).toHaveLength(2)
  })

  it('records shipments: partially_shipped while units are left, shipped once every unit has gone', async () => {
    const { a, id } = await paidOrder()
    const first = await a.post(`/orders/${id}/shipments`, { lines: [{ sku: APL, quantity: 1 }] })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({
      status: 'partially_shipped',
      shipped: { [APL]: 1, [BRD]: 0 },
      shipments: [{ id: 'shp_1', lines: [{ sku: APL, quantity: 1 }], at: '2026-11-20T10:00:00.000Z' }],
    })
    a.tick(3600)
    const second = await a.post(`/orders/${id}/shipments`, {
      lines: [
        { sku: APL, quantity: 2 },
        { sku: BRD, quantity: 2 },
      ],
    })
    expect(second.status).toBe(201)
    expect(second.body.status).toBe('shipped')
    expect(second.body.shipped).toEqual({ [APL]: 3, [BRD]: 2 })
    expect(second.body.shipments[1]).toEqual({
      id: 'shp_2',
      lines: [
        { sku: APL, quantity: 2 },
        { sku: BRD, quantity: 2 },
      ],
      at: '2026-11-20T11:00:00.000Z',
    })
    expect((await a.get(`/orders/${id}`)).body).toEqual(second.body)
  })

  it('ships everything left with /ship, as one shipment of the lines that still have units', async () => {
    const { a, id } = await paidOrder()
    await a.post(`/orders/${id}/shipments`, { lines: [{ sku: APL, quantity: 3 }] })
    const rest = await a.post(`/orders/${id}/ship`)
    expect(rest.status).toBe(200)
    expect(rest.body).toMatchObject({ status: 'shipped', shipped: { [APL]: 3, [BRD]: 2 } })
    expect(rest.body.shipments.map((s: { id: string }) => s.id)).toEqual(['shp_1', 'shp_2'])
    expect(rest.body.shipments[1].lines).toEqual([{ sku: BRD, quantity: 2 }])

    const other = await paidOrder(a)
    const whole = await a.post(`/orders/${other.id}/ship`)
    expect(whole.body.shipments).toEqual([
      {
        id: 'shp_1',
        lines: [
          { sku: APL, quantity: 3 },
          { sku: BRD, quantity: 2 },
        ],
        at: '2026-11-20T10:00:00.000Z',
      },
    ])
  })

  it('takes shipments only for paid or partially shipped orders', async () => {
    const a = api()
    const pending = await a.order('cus_ben', [[APL, 1]])
    expect(
      await a.post(`/orders/${pending.body.id}/shipments`, { lines: [{ sku: APL, quantity: 1 }] }),
    ).toMatchObject({
      status: 409,
      body: { error: 'A pending order cannot be shipped' },
    })
    const { id } = await paidOrder(a)
    await a.post(`/orders/${id}/ship`)
    expect(await a.post(`/orders/${id}/shipments`, { lines: [{ sku: APL, quantity: 1 }] })).toMatchObject({
      status: 409,
      body: { error: 'A shipped order cannot be shipped' },
    })
    expect(await a.post(`/orders/${id}/ship`)).toMatchObject({
      status: 409,
      body: { error: 'A shipped order cannot be shipped' },
    })
    expect(await a.post('/orders/ord_9999/shipments', { lines: [{ sku: APL, quantity: 1 }] })).toMatchObject({
      status: 404,
      body: { error: 'Order not found' },
    })
  })

  it('refuses lines that are not a non-empty list of distinct { sku, quantity } (400) and records nothing', async () => {
    const { a, id } = await paidOrder()
    for (const body of [
      {},
      { lines: [] },
      { lines: 'APL-GALA-1KG' },
      { lines: [{ sku: APL, quantity: 0 }] },
      { lines: [{ sku: APL, quantity: 1.5 }] },
      { lines: [{ quantity: 1 }] },
      {
        lines: [
          { sku: APL, quantity: 1 },
          { sku: APL, quantity: 1 },
        ],
      },
    ]) {
      expect(await a.post(`/orders/${id}/shipments`, body), JSON.stringify(body)).toMatchObject({
        status: 400,
        body: { error: LINES_ERROR },
      })
    }
    expect((await a.get(`/orders/${id}`)).body).toMatchObject({ status: 'paid', shipments: [] })
  })

  it('refuses a SKU not in the order or more than is left to ship (422) and records nothing', async () => {
    const { a, id } = await paidOrder()
    const tryShip = (lines: { sku: string; quantity: number }[]) =>
      a.post(`/orders/${id}/shipments`, { lines })
    expect(
      await tryShip([
        { sku: APL, quantity: 1 },
        { sku: 'TOM-HEIR-500', quantity: 1 },
      ]),
    ).toMatchObject({ status: 422, body: { error: 'Cannot ship 1 of TOM-HEIR-500' } })
    expect(
      await tryShip([
        { sku: APL, quantity: 2 },
        { sku: BRD, quantity: 3 },
      ]),
    ).toMatchObject({ status: 422, body: { error: 'Cannot ship 3 of BRD-SOUR-800' } })
    expect((await tryShip([{ sku: APL, quantity: 2 }])).status).toBe(201)
    expect(await tryShip([{ sku: APL, quantity: 2 }])).toMatchObject({
      status: 422,
      body: { error: 'Cannot ship 2 of APL-GALA-1KG' },
    })
    const order = (await a.get(`/orders/${id}`)).body
    expect(order.shipped).toEqual({ [APL]: 2, [BRD]: 0 })
    expect(order.shipments).toHaveLength(1)
    expect(await a.post(`/orders/${id}/pay`)).toMatchObject({
      status: 409,
      body: { error: 'A partially_shipped order cannot be paid' },
    })
  })

  it('never ships more than ordered when shipments for the same order arrive at the same time', async () => {
    const { a, id } = await paidOrder()
    const ship = (sku: string, quantity: number) =>
      a.post(`/orders/${id}/shipments`, { lines: [{ sku, quantity }] })
    const raced = await Promise.all([ship(APL, 2), ship(APL, 2), ship(BRD, 1)])
    expect(raced.map((r) => r.status)).toEqual([201, 422, 201])
    expect(raced[1]!.body).toEqual({ error: 'Cannot ship 2 of APL-GALA-1KG' })
    const order = (await a.get(`/orders/${id}`)).body
    expect(order.shipped).toEqual({ [APL]: 2, [BRD]: 1 })
    expect(order.shipments.map((s: { id: string }) => s.id)).toEqual(['shp_1', 'shp_2'])

    const [rest, late] = await Promise.all([a.post(`/orders/${id}/ship`), ship(APL, 1)])
    expect(rest.body).toMatchObject({ status: 'shipped', shipped: { [APL]: 3, [BRD]: 2 } })
    expect(late).toMatchObject({ status: 409, body: { error: 'A shipped order cannot be shipped' } })
  })
})
