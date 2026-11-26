// Orders: placed from a cart, then paid and shipped.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'
import { formatCents, totalsOf } from '../money.js'
import { GOLD_FROM } from './customers.js'
import type { GiftCard, Order } from '../types.js'

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
    const body = (await readJson(req)) as
      { cartId?: unknown; redeemPoints?: unknown; giftCard?: unknown } | undefined
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
    const totals = totalsOf(cart.lines, redeem)
    // Every check passes before anything moves: points first, then the gift card.
    let card: GiftCard | undefined
    if (body.giftCard !== undefined && body.giftCard !== null) {
      card = typeof body.giftCard === 'string' ? await db.giftCards.find(body.giftCard) : undefined
      if (!card) return fail(404, 'Gift card not found')
      if (card.balanceCents === 0) return fail(422, 'Gift card is empty')
    }
    if (customer && redeem > 0) await db.customers.update(customer.id, { points: balance - redeem })
    const giftCardCents = card ? Math.min(card.balanceCents, totals.totalCents) : 0
    if (card) await db.giftCards.update(card.code, { balanceCents: card.balanceCents - giftCardCents })
    const amountDueCents = totals.totalCents - giftCardCents
    const placed = await db.orders.insert({
      customerId: cart.customerId,
      lines: cart.lines,
      ...totals,
      pointsRedeemed: redeem,
      pointsEarned: 0,
      discountCents: redeem,
      status: 'pending',
      createdAt: now().toISOString(),
      giftCard: card ? card.code : null,
      giftCardCents,
      amountDueCents,
    })
    await db.carts.update(cart.id, { lines: [] })
    // Fully paid by the gift card: the order is paid now, and its points are earned now.
    return json(amountDueCents === 0 ? await markPaid(placed) : placed, 201)
  })

  /** Marks an order paid and gives its customer the points it earns (2 per dollar for gold). */
  const markPaid = async (order: Order) => {
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
    return db.orders.update(order.id, { status: 'paid', pointsEarned })
  }

  router.post('/orders/:id/pay', async (_req, { id }) => {
    const order = await db.orders.find(id as string)
    if (!order) return fail(404, 'Order not found')
    if (order.status !== 'pending') return fail(409, `A ${order.status} order cannot be paid`)
    return json(await markPaid(order))
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
    // What the gift card paid goes back onto it.
    if (order.giftCard && order.giftCardCents > 0) {
      const card = await db.giftCards.find(order.giftCard)
      if (card)
        await db.giftCards.update(card.code, { balanceCents: card.balanceCents + order.giftCardCents })
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
    ...(order.giftCard
      ? [
          `Gift card ${order.giftCard}  ${formatCents(-order.giftCardCents)}`,
          `Amount due  ${formatCents(order.amountDueCents)}`,
        ]
      : []),
    '',
  ].join('\n')
}
