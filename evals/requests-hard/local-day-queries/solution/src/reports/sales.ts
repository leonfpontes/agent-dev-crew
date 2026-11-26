import { daysFrom, localDay } from '../time.js'
import type { Order } from '../types.js'

export interface SalesDay {
  date: string
  orders: number
  totalCents: number
}

/** One entry per local day of the range, with the days that had no orders. */
export function salesByDay(orders: Order[], from: string, to: string): SalesDay[] {
  const days = new Map(daysFrom(from, to).map((date) => [date, { date, orders: 0, totalCents: 0 }]))
  for (const order of orders) {
    const day = days.get(localDay(order.createdAt))
    if (!day) continue
    day.orders++
    day.totalCents += order.totalCents
  }
  return [...days.values()]
}

/** The Monday (YYYY-MM-DD) of the week a day belongs to. */
export function mondayOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`)
  const back = (new Date(t).getUTCDay() + 6) % 7
  return new Date(t - back * 86_400_000).toISOString().slice(0, 10)
}

/** The days of the range folded into weeks that start on Monday, each named by its Monday. */
export function salesByWeek(orders: Order[], from: string, to: string): SalesDay[] {
  const weeks = new Map<string, SalesDay>()
  for (const day of salesByDay(orders, from, to)) {
    const date = mondayOf(day.date)
    const week = weeks.get(date) ?? { date, orders: 0, totalCents: 0 }
    week.orders += day.orders
    week.totalCents += day.totalCents
    weeks.set(date, week)
  }
  return [...weeks.values()]
}
