// Carts: a customer collects lines before placing an order.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'

export function cartRoutes(router: Router, { db }: Context): void {
  router.post('/carts', async (req) => {
    const body = (await readJson(req)) as { customerId?: unknown } | undefined
    if (typeof body?.customerId !== 'string') return fail(400, 'customerId is required')
    if (!(await db.customers.find(body.customerId))) return fail(404, 'Customer not found')
    return json(await db.carts.create(body.customerId), 201)
  })

  router.get('/carts/:id', async (_req, { id }) => {
    const cart = await db.carts.find(id as string)
    return cart ? json(cart) : fail(404, 'Cart not found')
  })

  router.post('/carts/:id/items', async (req, { id }) => {
    const cart = await db.carts.find(id as string)
    if (!cart) return fail(404, 'Cart not found')
    const body = (await readJson(req)) as { sku?: unknown; quantity?: unknown } | undefined
    const quantity = body?.quantity ?? 1
    if (typeof body?.sku !== 'string' || body.sku === '') return fail(400, 'sku is required')
    if (!Number.isInteger(quantity) || (quantity as number) < 1)
      return fail(400, 'quantity must be a whole number of 1 or more')

    const sku = body.sku
    const product = await db.products.find(sku)
    const unitCents = product?.unitCents ?? 0
    const existing = cart.lines.find((l) => l.sku === sku)
    const lines = existing
      ? cart.lines.map((l) =>
          l.sku === sku
            ? {
                ...l,
                quantity: l.quantity + (quantity as number),
                lineCents: l.unitCents * (l.quantity + (quantity as number)),
              }
            : l,
        )
      : [
          ...cart.lines,
          {
            sku,
            name: product?.name ?? sku,
            unitCents,
            quantity: quantity as number,
            lineCents: unitCents * (quantity as number),
          },
        ]
    return json(await db.carts.update(cart.id, { lines }))
  })
}
