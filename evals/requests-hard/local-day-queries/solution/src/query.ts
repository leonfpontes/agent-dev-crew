// GET /orders query: filters, sort and paging, checked in a fixed order so the error names the
// first invalid parameter.
import { localDay } from './time.js'
import { ORDER_STATUSES, type Order, type OrderStatus } from './types.js'

export interface OrderQuery {
  status?: OrderStatus
  customer?: string
  from?: string
  to?: string
  minTotal?: number
  /** Sort keys in order, each with its direction. */
  sort: { key: SortKey; direction: 1 | -1 }[]
  limit: number
  offset: number
}

const KNOWN = ['status', 'customer', 'from', 'to', 'minTotal', 'sort', 'limit', 'offset']
const SORT_KEYS = ['createdAt', 'total', 'status'] as const
type SortKey = (typeof SORT_KEYS)[number]

/** A comma-separated list of distinct keys, each optionally with a leading "-". */
function parseSort(value: string): OrderQuery['sort'] | undefined {
  const sort: OrderQuery['sort'] = []
  for (const part of value.split(',')) {
    const key = part.replace(/^-/, '') as SortKey
    if (!SORT_KEYS.includes(key) || sort.some((s) => s.key === key)) return undefined
    sort.push({ key, direction: part.startsWith('-') ? -1 : 1 })
  }
  return sort
}

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
  const sort = parseSort(get('sort') ?? 'createdAt')
  if (!sort) return { invalid: 'sort' }
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
      // from and to are days of the store's calendar (New York), like the reports.
      (q.from === undefined || localDay(o.createdAt) >= q.from) &&
      (q.to === undefined || localDay(o.createdAt) <= q.to) &&
      (q.minTotal === undefined || o.totalCents >= q.minTotal),
  )
  const compare = (key: SortKey, a: Order, b: Order) =>
    key === 'total'
      ? a.totalCents - b.totalCents
      : key === 'status'
        ? ORDER_STATUSES.indexOf(a.status) - ORDER_STATUSES.indexOf(b.status)
        : a.createdAt.localeCompare(b.createdAt)
  matching.sort((a, b) => {
    for (const { key, direction } of q.sort) {
      const by = compare(key, a, b) * direction
      if (by !== 0) return by
    }
    return a.id.localeCompare(b.id)
  })
  return {
    items: matching.slice(q.offset, q.offset + q.limit),
    total: matching.length,
    limit: q.limit,
    offset: q.offset,
  }
}
