// Orders: placed from a cart, then paid and shipped.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'
import { formatCents, totalsOf } from '../money.js'
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
    const body = (await readJson(req)) as { cartId?: unknown; giftCard?: unknown } | undefined
    if (typeof body?.cartId !== 'string') return fail(400, 'cartId is required')
    const cart = await db.carts.find(body.cartId)
    if (!cart) return fail(404, 'Cart not found')
    if (cart.lines.length === 0) return fail(422, 'The cart is empty')
    const totals = totalsOf(cart.lines)
    let giftCard: string | null = null
    let giftCardCents = 0
    if (body.giftCard !== undefined && body.giftCard !== null) {
      const card = typeof body.giftCard === 'string' ? await db.giftCards.find(body.giftCard) : undefined
      if (!card) return fail(404, 'Gift card not found')
      if (card.balanceCents === 0) return fail(422, 'Gift card is empty')
      giftCard = card.code
      giftCardCents = Math.min(card.balanceCents, totals.totalCents)
      await db.giftCards.update(card.code, { balanceCents: card.balanceCents - giftCardCents })
    }
    const amountDueCents = totals.totalCents - giftCardCents
    const order = await db.orders.insert({
      customerId: cart.customerId,
      lines: cart.lines,
      ...totals,
      status: amountDueCents === 0 ? 'paid' : 'pending',
      createdAt: now().toISOString(),
      giftCard,
      giftCardCents,
      amountDueCents,
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
    ...(order.giftCard
      ? [
          `Gift card ${order.giftCard}  ${formatCents(-order.giftCardCents)}`,
          `Amount due  ${formatCents(order.amountDueCents)}`,
        ]
      : []),
    '',
  ].join('\n')
}
