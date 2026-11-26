// GET /orders query: filters, sort and paging, checked in a fixed order so the error names the
// first invalid parameter.
import { ORDER_STATUSES, type Order, type OrderStatus } from './types.js'

export interface OrderQuery {
  status?: OrderStatus
  customer?: string
  from?: string
  to?: string
  minTotal?: number
  sort: string
  limit: number
  offset: number
}

const KNOWN = ['status', 'customer', 'from', 'to', 'minTotal', 'sort', 'limit', 'offset']
const SORTS = ['createdAt', '-createdAt', 'total', '-total']

const isDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const wholeAtLeast = (value: string, min: number) => /^\d+$/.test(value) && Number(value) >= min

/** The parsed query, or the name of the first invalid parameter. */
export function parseOrderQuery(params: URLSearchParams): OrderQuery | { invalid: string } {
  const get = (name: string) => params.get(name) ?? undefined
  const status = get('status')
  if (status !== undefined && !(ORDER_STATUSES as readonly string[]).includes(status))
    return { invalid: 'status' }
  const from = get('from')
  if (from !== undefined && !isDate(from)) return { invalid: 'from' }
  const to = get('to')
  if (to !== undefined && (!isDate(to) || (from !== undefined && to < from))) return { invalid: 'to' }
  const minTotal = get('minTotal')
  if (minTotal !== undefined && !wholeAtLeast(minTotal, 0)) return { invalid: 'minTotal' }
  const sort = get('sort') ?? 'createdAt'
  if (!SORTS.includes(sort)) return { invalid: 'sort' }
  const limit = get('limit') ?? '20'
  if (!wholeAtLeast(limit, 1) || Number(limit) > 100) return { invalid: 'limit' }
  const offset = get('offset') ?? '0'
  if (!wholeAtLeast(offset, 0)) return { invalid: 'offset' }
  const unknown = [...params.keys()].find((k) => !KNOWN.includes(k))
  if (unknown !== undefined) return { invalid: unknown }
  return {
    status: status as OrderStatus | undefined,
    customer: get('customer'),
    from,
    to,
    minTotal: minTotal === undefined ? undefined : Number(minTotal),
    sort,
    limit: Number(limit),
    offset: Number(offset),
  }
}

export function queryOrders(orders: Order[], q: OrderQuery) {
  const matching = orders.filter(
    (o) =>
      (q.status === undefined || o.status === q.status) &&
      (q.customer === undefined || o.customerId === q.customer) &&
      (q.from === undefined || o.createdAt.slice(0, 10) >= q.from) &&
      (q.to === undefined || o.createdAt.slice(0, 10) <= q.to) &&
      (q.minTotal === undefined || o.totalCents >= q.minTotal),
  )
  const direction = q.sort.startsWith('-') ? -1 : 1
  const field = q.sort.replace('-', '')
  matching.sort((a, b) => {
    const by = field === 'total' ? a.totalCents - b.totalCents : a.createdAt.localeCompare(b.createdAt)
    return by * direction || a.id.localeCompare(b.id)
  })
  return {
    items: matching.slice(q.offset, q.offset + q.limit),
    total: matching.length,
    limit: q.limit,
    offset: q.offset,
  }
}
