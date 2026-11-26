// Returns: units of a shipped order come back within 30 days, with a refund.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'
import type { Order, ReturnLine } from '../types.js'

const DAY_MS = 24 * 60 * 60 * 1000
const WINDOW_MS = 30 * DAY_MS
const FEE_FROM_MS = 14 * DAY_MS
const FEE_PERCENT = 10

const bought = (order: Order, sku: string) =>
  order.lines.filter((l) => l.sku === sku).reduce((sum, l) => sum + l.quantity, 0)
const returned = (order: Order, sku: string) =>
  order.returns
    .flatMap((r) => r.lines)
    .filter((l) => l.sku === sku)
    .reduce((sum, l) => sum + l.quantity, 0)

export function returnRoutes(router: Router, { db, now }: Context): void {
  router.post('/orders/:id/returns', async (req, { id }) => {
    const order = await db.orders.find(id as string)
    if (!order) return fail(404, 'Order not found')
    if (order.status !== 'shipped' && order.status !== 'partially_shipped')
      return fail(409, `A ${order.status} order cannot be returned`)
    const age = now().getTime() - Date.parse(order.createdAt)
    if (age >= WINDOW_MS) return fail(409, 'The return window has closed')
    const body = (await readJson(req)) as { lines?: unknown } | undefined
    const lines = parseLines(body?.lines)
    if (!lines) return fail(400, 'lines must be a non-empty list of { sku, quantity }')
    for (const line of lines)
      // Only units that have shipped can come back.
      if (line.quantity > (order.shipped[line.sku] ?? 0) - returned(order, line.sku))
        return fail(422, `Cannot return ${line.quantity} of ${line.sku}`)

    const unit = (sku: string) => order.lines.find((l) => l.sku === sku)?.unitCents ?? 0
    const value = lines.reduce((sum, l) => sum + unit(l.sku) * l.quantity, 0)
    const everything = order.lines.every(
      (l) =>
        returned(order, l.sku) + (lines.find((r) => r.sku === l.sku)?.quantity ?? 0) >= bought(order, l.sku),
    )
    const feeCents = age >= FEE_FROM_MS ? Math.round((value * FEE_PERCENT) / 100) : 0
    const feesSoFar = order.returns.reduce((sum, r) => sum + r.feeCents, 0)
    // The last return closes the order: refunds plus fees add up to the total.
    const refundCents = everything
      ? order.totalCents - order.refundedCents - feesSoFar - feeCents
      : value + Math.round((order.taxCents * value) / order.subtotalCents) - feeCents
    for (const line of lines) {
      const product = await db.products.find(line.sku)
      if (product) await db.products.update(line.sku, { stock: product.stock + line.quantity })
    }
    const returns = [
      ...order.returns,
      { id: `ret_${order.returns.length + 1}`, lines, refundCents, feeCents, at: now().toISOString() },
    ]
    return json(
      await db.orders.update(order.id, {
        returns,
        refundedCents: order.refundedCents + refundCents,
        status: everything ? 'returned' : order.status,
      }),
      201,
    )
  })
}

function parseLines(value: unknown): ReturnLine[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const lines: ReturnLine[] = []
  for (const item of value as { sku?: unknown; quantity?: unknown }[]) {
    if (typeof item?.sku !== 'string' || item.sku === '') return undefined
    if (!Number.isInteger(item.quantity) || (item.quantity as number) < 1) return undefined
    if (lines.some((l) => l.sku === item.sku)) return undefined
    lines.push({ sku: item.sku, quantity: item.quantity as number })
  }
  return lines
}
