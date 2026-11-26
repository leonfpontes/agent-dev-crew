// Orders: placed from a cart, then paid and shipped.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'
import { formatCents, totalsOf } from '../money.js'
import { serial } from '../serial.js'
import type { Order, ShipmentLine } from '../types.js'

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
    const body = (await readJson(req)) as { cartId?: unknown } | undefined
    if (typeof body?.cartId !== 'string') return fail(400, 'cartId is required')
    const cart = await db.carts.find(body.cartId)
    if (!cart) return fail(404, 'Cart not found')
    if (cart.lines.length === 0) return fail(422, 'The cart is empty')
    const order = await db.orders.insert({
      customerId: cart.customerId,
      lines: cart.lines,
      ...totalsOf(cart.lines),
      status: 'pending',
      createdAt: now().toISOString(),
      shipped: Object.fromEntries(cart.lines.map((l) => [l.sku, 0])),
      shipments: [],
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

  const left = (order: Order, sku: string) =>
    order.lines.filter((l) => l.sku === sku).reduce((sum, l) => sum + l.quantity, 0) -
    (order.shipped[sku] ?? 0)

  const record = async (order: Order, lines: ShipmentLine[]) => {
    const shipped = { ...order.shipped }
    for (const line of lines) shipped[line.sku] = (shipped[line.sku] ?? 0) + line.quantity
    const shipments = [
      ...order.shipments,
      { id: `shp_${order.shipments.length + 1}`, lines, at: now().toISOString() },
    ]
    const done = order.lines.every((l) => (shipped[l.sku] ?? 0) >= l.quantity)
    return db.orders.update(order.id, { shipped, shipments, status: done ? 'shipped' : 'partially_shipped' })
  }

  const shippable = (order: Order) => order.status === 'paid' || order.status === 'partially_shipped'
  // Shipments read what is left and then write it: one at a time, in the order they arrive.
  const exclusive = serial()

  router.post('/orders/:id/ship', (_req, { id }) => exclusive(() => shipRest(id as string)))

  const shipRest = async (id: string) => {
    const order = await db.orders.find(id)
    if (!order) return fail(404, 'Order not found')
    if (!shippable(order)) return fail(409, `A ${order.status} order cannot be shipped`)
    const lines = order.lines
      .map((l) => ({ sku: l.sku, quantity: left(order, l.sku) }))
      .filter((l) => l.quantity > 0)
    return json(await record(order, lines))
  }

  router.post('/orders/:id/shipments', (req, { id }) => exclusive(() => ship(req, id as string)))

  const ship = async (req: Request, id: string) => {
    const order = await db.orders.find(id)
    if (!order) return fail(404, 'Order not found')
    if (!shippable(order)) return fail(409, `A ${order.status} order cannot be shipped`)
    const body = (await readJson(req)) as { lines?: unknown } | undefined
    const lines = parseLines(body?.lines)
    if (!lines) return fail(400, 'lines must be a non-empty list of { sku, quantity }')
    for (const line of lines)
      if (line.quantity > left(order, line.sku))
        return fail(422, `Cannot ship ${line.quantity} of ${line.sku}`)
    return json(await record(order, lines), 201)
  }

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

function parseLines(value: unknown): ShipmentLine[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const lines: ShipmentLine[] = []
  for (const item of value as { sku?: unknown; quantity?: unknown }[]) {
    if (typeof item?.sku !== 'string' || item.sku === '') return undefined
    if (!Number.isInteger(item.quantity) || (item.quantity as number) < 1) return undefined
    if (lines.some((l) => l.sku === item.sku)) return undefined
    lines.push({ sku: item.sku, quantity: item.quantity as number })
  }
  return lines
}
