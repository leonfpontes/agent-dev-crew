// Products: price changes, now or scheduled, with the history of each price.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'
import { historyOf, priceAt, setPrice } from '../pricing.js'

export function productRoutes(router: Router, { db, now }: Context): void {
  router.post('/products/:sku/price', async (req, { sku }) => {
    const product = await db.products.find(sku as string)
    if (!product) return fail(404, 'Product not found')
    const body = (await readJson(req)) as { unitCents?: unknown; from?: unknown } | undefined
    const unitCents = body?.unitCents
    if (typeof unitCents !== 'number' || !Number.isInteger(unitCents) || unitCents < 1)
      return fail(400, 'unitCents must be a whole number above 0')
    let from: Date | undefined
    if (body?.from !== undefined) {
      from = typeof body.from === 'string' ? new Date(body.from) : undefined
      if (!from || Number.isNaN(from.getTime())) return fail(400, 'from must be an ISO 8601 time')
    }
    const at = now()
    setPrice(db, product, unitCents, from, at)
    return json({ ...product, unitCents: priceAt(db, product, at) })
  })

  router.get('/products/:sku/prices', async (_req, { sku }) => {
    const product = await db.products.find(sku as string)
    if (!product) return fail(404, 'Product not found')
    return json({ sku: product.sku, history: historyOf(db, product) })
  })
}
