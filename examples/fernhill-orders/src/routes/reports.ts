import type { Context } from '../context.js'
import { fail, json, type Router } from '../http.js'
import { dailyTotal } from '../reports/daily-total.js'

export function reportRoutes(router: Router, { db }: Context): void {
  router.get('/reports/daily-total', async (_req, _params, url) => {
    const day = url.searchParams.get('date') ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail(400, 'date must be YYYY-MM-DD')
    return json({ date: day, totalCents: dailyTotal(await db.orders.list(), day) })
  })
}
