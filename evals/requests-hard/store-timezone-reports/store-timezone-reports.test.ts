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

const ERROR = 'from and to must be real dates (YYYY-MM-DD), from <= to, at most 31 days'

/** Places one order at a UTC instant: APL-GALA-1KG is 486 with tax, BRD-SOUR-800 675, EGG-FREE-12 647. */
async function placeAt(a: ReturnType<typeof api>, iso: string, sku: string) {
  a.at(iso)
  const res = await a.order('cus_ada', [[sku, 1]])
  expect(res.status).toBe(201)
}

const daily = async (a: ReturnType<typeof api>, date: string) =>
  (await a.get(`/reports/daily-total?date=${date}`)).body.totalCents

describe('reports in the store time zone (America/New_York)', () => {
  it('counts an order in the New York day it was placed, not the UTC day', async () => {
    const a = api()
    await placeAt(a, '2026-11-20T03:30:00Z', 'APL-GALA-1KG') // 2026-11-19 22:30 in New York
    await placeAt(a, '2026-11-20T10:00:00Z', 'BRD-SOUR-800')
    expect(await daily(a, '2026-11-19')).toBe(486)
    expect(await daily(a, '2026-11-20')).toBe(675)
  })

  it('follows daylight saving time: UTC-5 before 2026-03-08 02:00 local, UTC-4 after', async () => {
    const a = api()
    await placeAt(a, '2026-03-08T04:30:00Z', 'APL-GALA-1KG') // 2026-03-07 23:30 EST
    await placeAt(a, '2026-03-08T06:30:00Z', 'BRD-SOUR-800') // 2026-03-08 01:30 EST
    await placeAt(a, '2026-03-09T04:30:00Z', 'EGG-FREE-12') // 2026-03-09 00:30 EDT
    expect(await daily(a, '2026-03-07')).toBe(486)
    expect(await daily(a, '2026-03-08')).toBe(675)
    expect(await daily(a, '2026-03-09')).toBe(647)
  })

  it('reports sales per local day over a range, with empty days and the total', async () => {
    const a = api()
    await placeAt(a, '2026-11-18T15:00:00Z', 'APL-GALA-1KG')
    await placeAt(a, '2026-11-20T10:00:00Z', 'BRD-SOUR-800')
    await placeAt(a, '2026-11-21T04:59:00Z', 'EGG-FREE-12') // 2026-11-20 23:59 EST
    const res = await a.get('/reports/sales?from=2026-11-18&to=2026-11-21')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      from: '2026-11-18',
      to: '2026-11-21',
      days: [
        { date: '2026-11-18', orders: 1, totalCents: 486 },
        { date: '2026-11-19', orders: 0, totalCents: 0 },
        { date: '2026-11-20', orders: 2, totalCents: 1322 },
        { date: '2026-11-21', orders: 0, totalCents: 0 },
      ],
      totalCents: 1808,
    })
  })

  it('gives the 25-hour day when daylight saving time ends (2026-11-01) all of its orders', async () => {
    const a = api()
    await placeAt(a, '2026-11-01T03:30:00Z', 'APL-GALA-1KG') // 2026-10-31 23:30 EDT
    await placeAt(a, '2026-11-01T04:30:00Z', 'BRD-SOUR-800') // 2026-11-01 00:30 EDT
    await placeAt(a, '2026-11-02T04:30:00Z', 'EGG-FREE-12') // 2026-11-01 23:30 EST
    await placeAt(a, '2026-11-02T05:30:00Z', 'APL-GALA-1KG') // 2026-11-02 00:30 EST
    const res = await a.get('/reports/sales?from=2026-10-31&to=2026-11-02')
    expect(res.body.days).toEqual([
      { date: '2026-10-31', orders: 1, totalCents: 486 },
      { date: '2026-11-01', orders: 2, totalCents: 1322 },
      { date: '2026-11-02', orders: 1, totalCents: 486 },
    ])
    expect(res.body.totalCents).toBe(2294)
  })

  it('accepts up to 31 days and refuses a bad range with 400', async () => {
    const a = api()
    const month = await a.get('/reports/sales?from=2026-01-01&to=2026-01-31')
    expect(month.status).toBe(200)
    expect(month.body.days).toHaveLength(31)
    for (const query of [
      'from=2026-01-01&to=2026-02-01',
      'from=2026-11-21&to=2026-11-20',
      'from=2026-02-27&to=2026-02-30',
      'from=2026-11-01',
      'from=2026-1-05&to=2026-01-10',
    ]) {
      expect(await a.get(`/reports/sales?${query}`), query).toMatchObject({
        status: 400,
        body: { error: ERROR },
      })
    }
  })

  it('refuses a daily-total date that does not exist, and takes a leap day', async () => {
    const a = api()
    for (const date of ['2026-02-30', '2027-02-29', '2026-13-01'])
      expect(await a.get(`/reports/daily-total?date=${date}`), date).toMatchObject({
        status: 400,
        body: { error: 'date must be YYYY-MM-DD' },
      })
    expect(await a.get('/reports/daily-total?date=2028-02-29')).toMatchObject({
      status: 200,
      body: { date: '2028-02-29', totalCents: 0 },
    })
  })

  it('groups by weeks starting on Monday with by=week, counting only the orders inside the range', async () => {
    const a = api()
    await placeAt(a, '2026-11-17T15:00:00Z', 'APL-GALA-1KG') // Tuesday, before the range
    await placeAt(a, '2026-11-18T15:00:00Z', 'APL-GALA-1KG') // Wednesday
    await placeAt(a, '2026-11-20T10:00:00Z', 'BRD-SOUR-800')
    await placeAt(a, '2026-11-23T04:30:00Z', 'EGG-FREE-12') // Sunday 2026-11-22 23:30 in New York
    await placeAt(a, '2026-11-24T15:00:00Z', 'BRD-SOUR-800') // Tuesday
    const res = await a.get('/reports/sales?from=2026-11-18&to=2026-11-24&by=week')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      from: '2026-11-18',
      to: '2026-11-24',
      days: [
        { date: '2026-11-16', orders: 3, totalCents: 1808 },
        { date: '2026-11-23', orders: 1, totalCents: 675 },
      ],
      totalCents: 2483,
    })
  })

  it('puts a Sunday-night order in its New York week across the end of daylight saving time, and refuses another by', async () => {
    const a = api()
    await placeAt(a, '2026-11-02T04:30:00Z', 'APL-GALA-1KG') // Sunday 2026-11-01 23:30 EST
    await placeAt(a, '2026-11-02T05:30:00Z', 'BRD-SOUR-800') // Monday 2026-11-02 00:30 EST
    const res = await a.get('/reports/sales?from=2026-10-28&to=2026-11-03&by=week')
    expect(res.body.days).toEqual([
      { date: '2026-10-26', orders: 1, totalCents: 486 },
      { date: '2026-11-02', orders: 1, totalCents: 675 },
    ])
    expect((await a.get('/reports/sales?from=2026-10-28&to=2026-11-03&by=day')).body.days).toHaveLength(7)
    expect(await a.get('/reports/sales?from=2026-10-28&to=2026-11-03&by=month')).toMatchObject({
      status: 400,
      body: { error: 'by must be day or week' },
    })
  })
})
