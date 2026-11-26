import type { Order } from '../types.js'

/** Sales of one UTC day (YYYY-MM-DD), in cents. */
export function dailyTotal(orders: Order[], day: string): number {
  return orders.filter((o) => o.createdAt.slice(0, 10) === day).reduce((sum, o) => sum + o.totalCents, 0)
}
