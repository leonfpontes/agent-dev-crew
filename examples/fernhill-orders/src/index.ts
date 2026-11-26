// Fernhill Market is a made-up store. This package is the repository the crew works on: a small
// orders API (carts, orders, receipts and a daily report) with its tests in tests/.
export { createApp, type App, type AppOptions } from './app.js'
export { CUSTOMERS, PRODUCTS } from './data.js'
export { createDb, type Db, type DbSeed } from './db.js'
export { formatCents, TAX_RATE_PERCENT, taxOf, totalsOf, type Totals } from './money.js'
export { dailyTotal } from './reports/daily-total.js'
export { receipt } from './routes/orders.js'
export {
  ORDER_STATUSES,
  type Cart,
  type Customer,
  type Line,
  type Order,
  type OrderStatus,
  type Product,
} from './types.js'
