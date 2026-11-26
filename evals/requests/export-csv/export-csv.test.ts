import { describe, expect, it } from 'vitest'

import { createApp, createDb, type AppOptions } from '../src/index.js'

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

describe('export orders as CSV', () => {
  it('answers text/csv with the header row', async () => {
    const res = await api().get('/orders.csv')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.text.split('\r\n')[0]).toBe('id,customer,status,created_at,subtotal,tax,total')
  })

  it('writes one row per order, oldest first', async () => {
    const a = api()
    await a.order('cus_ada', [
      ['APL-GALA-1KG', 2],
      ['BRD-SOUR-800', 1],
    ])
    a.tick(60)
    await a.order('cus_ben', [['MLK-OAT-1L', 1]])
    const rows = (await a.get('/orders.csv')).text.split('\r\n')
    expect(rows.slice(1)).toEqual([
      'ord_0001,Ada Brightwater,pending,2026-11-20T10:00:00.000Z,15.25,1.22,16.47',
      'ord_0002,Ben Okafor,pending,2026-11-20T10:01:00.000Z,3.49,0.28,3.77',
      '',
    ])
  })

  it('writes amounts as dollars with two decimals and no symbol', async () => {
    const a = api()
    await a.order('cus_cleo', [['APL-GALA-1KG', 1]])
    expect((await a.get('/orders.csv')).text).toContain(',4.50,0.36,4.86\r\n')
  })

  it('quotes fields with a comma or a quote, doubling the quotes', async () => {
    const db = createDb({
      customers: [{ id: 'cus_dot', name: 'Dot "DJ" Lane, Jr', email: 'dot@example.com' }],
    })
    const a = api({ db })
    await a.order('cus_dot', [['APL-GALA-1KG', 1]])
    expect((await a.get('/orders.csv')).text.split('\r\n')[1]).toBe(
      'ord_0001,"Dot ""DJ"" Lane, Jr",pending,2026-11-20T10:00:00.000Z,4.50,0.36,4.86',
    )
  })

  it('answers only the header when there are no orders', async () => {
    expect((await api().get('/orders.csv')).text).toBe('id,customer,status,created_at,subtotal,tax,total\r\n')
  })
})
