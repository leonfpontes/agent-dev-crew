// The Fernhill Market orders API as one fetch handler: `app.fetch(request)` returns a Response.
import type { Context } from './context.js'
import { createDb, type Db } from './db.js'
import { Router } from './http.js'
import { cartRoutes } from './routes/cart.js'
import { orderRoutes } from './routes/orders.js'
import { reportRoutes } from './routes/reports.js'
import { returnRoutes } from './routes/returns.js'

export interface AppOptions {
  db?: Db
  now?: () => Date
}

export interface App {
  fetch(req: Request): Promise<Response>
  db: Db
}

export function createApp(options: AppOptions = {}): App {
  const ctx: Context = { db: options.db ?? createDb(), now: options.now ?? (() => new Date()) }
  const router = new Router()
  cartRoutes(router, ctx)
  orderRoutes(router, ctx)
  reportRoutes(router, ctx)
  returnRoutes(router, ctx)
  return { fetch: (req) => router.handle(req), db: ctx.db }
}
