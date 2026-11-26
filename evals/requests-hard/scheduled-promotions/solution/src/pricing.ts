// Prices over time: the catalog price, then every change, each starting at its `from`. Carts and
// new orders use the price of the moment; a scheduled price starts on its own when its time comes.
import type { Db } from './db.js'
import type { Line, Product } from './types.js'

export interface PriceEntry {
  unitCents: number
  /** ISO time the price starts; null for the catalog price. */
  from: string | null
}

const schedules = new WeakMap<Db, Map<string, PriceEntry[]>>()

function entriesOf(db: Db, product: Product): PriceEntry[] {
  let byProduct = schedules.get(db)
  if (!byProduct) schedules.set(db, (byProduct = new Map()))
  let entries = byProduct.get(product.sku)
  if (!entries) byProduct.set(product.sku, (entries = [{ unitCents: product.unitCents, from: null }]))
  return entries
}

/** Every price of a product, in order of `from`, the catalog price first. */
export function historyOf(db: Db, product: Product): PriceEntry[] {
  return entriesOf(db, product).map((e) => ({ ...e }))
}

/** The price of a product at a time: the last entry that has started. */
export function priceAt(db: Db, product: Product, at: Date): number {
  const started = entriesOf(db, product).filter((e) => e.from === null || Date.parse(e.from) <= at.getTime())
  return started.at(-1)!.unitCents
}

/** Adds a price from `from` (now when it isn't in the future); a price with the same from replaces it. */
export function setPrice(
  db: Db,
  product: Product,
  unitCents: number,
  from: Date | undefined,
  now: Date,
): void {
  const start = from && from.getTime() > now.getTime() ? from : now
  if (start === now && priceAt(db, product, now) === unitCents) return
  const iso = start.toISOString()
  const entries = entriesOf(db, product).filter((e) => e.from !== iso)
  entries.push({ unitCents, from: iso })
  entries.sort((a, b) => (a.from === null ? -1 : b.from === null ? 1 : a.from.localeCompare(b.from)))
  schedules.get(db)!.set(product.sku, entries)
}

/** Lines at the prices of a moment. */
export async function priced(db: Db, lines: Line[], at: Date): Promise<Line[]> {
  return Promise.all(
    lines.map(async (line) => {
      const product = await db.products.find(line.sku)
      const unitCents = product ? priceAt(db, product, at) : line.unitCents
      return { ...line, unitCents, lineCents: unitCents * line.quantity }
    }),
  )
}
