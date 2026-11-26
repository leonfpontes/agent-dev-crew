import type { Context } from '../context.js'
import { fail, json, type Router } from '../http.js'
import { dailyTotal } from '../reports/daily-total.js'
import { salesByDay, salesByWeek } from '../reports/sales.js'
import { daysFrom, isRealDate } from '../time.js'

const MAX_DAYS = 31

export function reportRoutes(router: Router, { db }: Context): void {
  router.get('/reports/daily-total', async (_req, _params, url) => {
    const day = url.searchParams.get('date') ?? ''
    if (!isRealDate(day)) return fail(400, 'date must be YYYY-MM-DD')
    return json({ date: day, totalCents: dailyTotal(await db.orders.list(), day) })
  })

  router.get('/reports/sales', async (_req, _params, url) => {
    const from = url.searchParams.get('from') ?? ''
    const to = url.searchParams.get('to') ?? ''
    if (!isRealDate(from) || !isRealDate(to) || from > to || daysFrom(from, to).length > MAX_DAYS)
      return fail(400, 'from and to must be real dates (YYYY-MM-DD), from <= to, at most 31 days')
    const by = url.searchParams.get('by') ?? 'day'
    if (by !== 'day' && by !== 'week') return fail(400, 'by must be day or week')
    const days = (by === 'week' ? salesByWeek : salesByDay)(await db.orders.list(), from, to)
    return json({ from, to, days, totalCents: days.reduce((sum, d) => sum + d.totalCents, 0) })
  })
}
