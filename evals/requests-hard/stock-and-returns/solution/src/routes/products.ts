// Products: the catalog with the stock left.
import type { Context } from '../context.js'
import { json, type Router } from '../http.js'

export function productRoutes(router: Router, { db }: Context): void {
  router.get('/products', async () => json({ items: await db.products.list() }))
}
