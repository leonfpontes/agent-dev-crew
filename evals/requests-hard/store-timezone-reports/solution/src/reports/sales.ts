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
