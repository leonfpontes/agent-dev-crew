// Orders: placed from a cart, then paid and shipped.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'
import { formatCents, totalsOf } from '../money.js'
import type { Order } from '../types.js'

const WINDOW_MS = 60_000
const MAX_ORDERS = 5

export function orderRoutes(router: Router, { db, now }: Context): void {
  const placedAt = new Map<string, number[]>()
  router.get('/orders', async () => {
    const orders = await db.orders.list()
    return json({
      items: orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    })
  })

  router.get('/orders/:id', async (_req, { id }) => {
    const order = await db.orders.find(id as string)
    return order ? json(order) : fail(404, 'Order not found')
  })

  router.post('/orders', async (req) => {
    const body = (await readJson(req)) as { cartId?: unknown } | undefined
    if (typeof body?.cartId !== 'string') return fail(400, 'cartId is required')
    const cart = await db.carts.find(body.cartId)
    if (!cart) return fail(404, 'Cart not found')
    if (cart.lines.length === 0) return fail(422, 'The cart is empty')
    const at = now().getTime()
    const recent = (placedAt.get(cart.customerId) ?? []).filter((t) => t > at - WINDOW_MS)
    if (recent.length >= MAX_ORDERS) {
      const wait = Math.ceil(((recent[0] as number) + WINDOW_MS - at) / 1000)
      return fail(429, 'Too many orders', { 'retry-after': String(wait) })
    }
    placedAt.set(cart.customerId, [...recent, at])
    const order = await db.orders.insert({
      customerId: cart.customerId,
      lines: cart.lines,
      ...totalsOf(cart.lines),
      status: 'pending',
      createdAt: now().toISOString(),
    })
    await db.carts.update(cart.id, { lines: [] })
    return json(order, 201)
  })

  router.post('/orders/:id/pay', async (_req, { id }) => {
    const order = await db.orders.find(id as string)
    if (!order) return fail(404, 'Order not found')
    if (order.status !== 'pending') return fail(409, `A ${order.status} order cannot be paid`)
    return json(await db.orders.update(order.id, { status: 'paid' }))
  })

  router.post('/orders/:id/ship', async (_req, { id }) => {
    const order = await db.orders.find(id as string)
    if (!order) return fail(404, 'Order not found')
    if (order.status !== 'paid') return fail(409, `A ${order.status} order cannot be shipped`)
    return json(await db.orders.update(order.id, { status: 'shipped' }))
  })

  router.get('/orders/:id/receipt', async (_req, { id }) => {
    const order = await db.orders.find(id as string)
    if (!order) return fail(404, 'Order not found')
    const customer = await db.customers.find(order.customerId)
    return new Response(receipt(order, customer?.name ?? order.customerId), {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  })
}

/** The plain-text receipt: one line per item, then the totals. */
export function receipt(order: Order, customerName: string): string {
  return [
    'Fernhill Market',
    `Order ${order.id}`,
    `Customer: ${customerName}`,
    '',
    ...order.lines.map((l) => `${l.quantity} × ${l.name}  ${formatCents(l.lineCents)}`),
    '',
    `Subtotal  ${formatCents(order.subtotalCents)}`,
    `Tax  ${formatCents(order.taxCents)}`,
    `Total  ${formatCents(order.totalCents)}`,
    '',
  ].join('\n')
}
