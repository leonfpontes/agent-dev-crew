// A client for the app in a test: no server, no port, a fixed clock.
import { createApp, type AppOptions } from '../src/index.js'

export const NOW = new Date('2026-11-20T10:00:00Z')

export function client(options: AppOptions = {}) {
  let clock = options.now?.() ?? NOW
  const app = createApp({ ...options, now: () => clock })
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`http://fernhill.test${path}`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
    const text = await res.text()
    const type = res.headers.get('content-type') ?? ''
    return {
      status: res.status,
      headers: res.headers,
      text,
      body: type.includes('json') ? JSON.parse(text) : text,
    }
  }
  return {
    app,
    get: (path: string) => call('GET', path),
    post: (path: string, body?: unknown) => call('POST', path, body ?? {}),
    setNow: (date: Date) => {
      clock = date
    },
    /** Creates a cart for the customer, adds the items and places the order. */
    async order(customerId: string, items: [sku: string, quantity: number][]) {
      const cart = await call('POST', '/carts', { customerId })
      for (const [sku, quantity] of items)
        await call('POST', `/carts/${cart.body.id}/items`, { sku, quantity })
      return call('POST', '/orders', { cartId: cart.body.id })
    },
  }
}
