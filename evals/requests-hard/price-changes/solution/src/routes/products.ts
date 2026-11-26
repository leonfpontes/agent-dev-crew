// Products: price changes, with the history of each price.
import type { Context } from '../context.js'
import { fail, json, readJson, type Router } from '../http.js'

interface PriceEntry {
  unitCents: number
  from: string | null
}

export function productRoutes(router: Router, { db, now }: Context): void {
  const history = new Map<string, PriceEntry[]>()
  const historyOf = (sku: string, catalogCents: number) =>
    history.get(sku) ?? [{ unitCents: catalogCents, from: null }]

  router.post('/products/:sku/price', async (req, { sku }) => {
    const product = await db.products.find(sku as string)
    if (!product) return fail(404, 'Product not found')
    const body = (await readJson(req)) as { unitCents?: unknown } | undefined
    const unitCents = body?.unitCents
    if (typeof unitCents !== 'number' || !Number.isInteger(unitCents) || unitCents < 1)
      return fail(400, 'unitCents must be a whole number above 0')
    if (unitCents === product.unitCents) return json(product)
    history.set(product.sku, [
      ...historyOf(product.sku, product.unitCents),
      { unitCents, from: now().toISOString() },
    ])
    return json(await db.products.update(product.sku, { unitCents }))
  })

  router.get('/products/:sku/prices', async (_req, { sku }) => {
    const product = await db.products.find(sku as string)
    if (!product) return fail(404, 'Product not found')
    return json({ sku: product.sku, history: historyOf(product.sku, product.unitCents) })
  })
}
