// Orders: placed from a cart, then paid and shipped.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'
import { formatCents, totalsOf } from '../money.js'
import { GOLD_FROM } from './customers.js'
import type { Order } from '../types.js'

export function orderRoutes(router: Router, { db, now }: Context): void {
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
    const body = (await readJson(req)) as { cartId?: unknown; redeemPoints?: unknown } | undefined
    if (typeof body?.cartId !== 'string') return fail(400, 'cartId is required')
    const cart = await db.carts.find(body.cartId)
    if (!cart) return fail(404, 'Cart not found')
    if (cart.lines.length === 0) return fail(422, 'The cart is empty')
    const customer = await db.customers.find(cart.customerId)
    const balance = customer?.points ?? 0
    const redeem = body.redeemPoints ?? 0
    const subtotal = totalsOf(cart.lines).subtotalCents
    if (
      typeof redeem !== 'number' ||
      !Number.isInteger(redeem) ||
      redeem < 0 ||
      redeem % 100 !== 0 ||
      redeem > balance ||
      redeem > subtotal
    )
      return fail(422, `Cannot redeem ${String(redeem)} points`)
    if (customer && redeem > 0) await db.customers.update(customer.id, { points: balance - redeem })
    const order = await db.orders.insert({
      customerId: cart.customerId,
      lines: cart.lines,
      ...totalsOf(cart.lines, redeem),
      pointsRedeemed: redeem,
      pointsEarned: 0,
      discountCents: redeem,
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
    const customer = await db.customers.find(order.customerId)
    let pointsEarned = 0
    if (customer) {
      const lifetime = customer.lifetimePoints ?? 0
      const rate = lifetime >= GOLD_FROM ? 2 : 1
      pointsEarned = rate * Math.floor((order.subtotalCents - order.discountCents) / 100)
      await db.customers.update(customer.id, {
        points: (customer.points ?? 0) + pointsEarned,
        lifetimePoints: lifetime + pointsEarned,
      })
    }
    return json(await db.orders.update(order.id, { status: 'paid', pointsEarned }))
  })

  router.post('/orders/:id/ship', async (_req, { id }) => {
    const order = await db.orders.find(id as string)
    if (!order) return fail(404, 'Order not found')
    if (order.status !== 'paid') return fail(409, `A ${order.status} order cannot be shipped`)
    return json(await db.orders.update(order.id, { status: 'shipped' }))
  })

  router.post('/orders/:id/cancel', async (_req, { id }) => {
    const order = await db.orders.find(id as string)
    if (!order) return fail(404, 'Order not found')
    if (order.status !== 'pending' && order.status !== 'paid')
      return fail(409, `A ${order.status} order cannot be cancelled`)
    const customer = await db.customers.find(order.customerId)
    if (customer) {
      const points = Math.max(0, (customer.points ?? 0) + order.pointsRedeemed - order.pointsEarned)
      await db.customers.update(customer.id, { points })
    }
    return json(await db.orders.update(order.id, { status: 'cancelled' }))
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
    ...(order.pointsRedeemed > 0 ? [`Points  ${formatCents(-order.pointsRedeemed)}`] : []),
    `Tax  ${formatCents(order.taxCents)}`,
    `Total  ${formatCents(order.totalCents)}`,
    '',
  ].join('\n')
}
