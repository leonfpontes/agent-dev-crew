import { localDay } from '../time.js'
import type { Order } from '../types.js'

/** Sales of one local day of the store (YYYY-MM-DD), in cents. */
export function dailyTotal(orders: Order[], day: string): number {
  return orders.filter((o) => localDay(o.createdAt) === day).reduce((sum, o) => sum + o.totalCents, 0)
}
