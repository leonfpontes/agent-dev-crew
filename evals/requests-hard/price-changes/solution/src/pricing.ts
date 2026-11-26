// Today's prices: carts and new orders always use the catalog price of the moment.
import type { Db } from './db.js'
import type { Line } from './types.js'

export async function priced(db: Db, lines: Line[]): Promise<Line[]> {
  return Promise.all(
    lines.map(async (line) => {
      const unitCents = (await db.products.find(line.sku))?.unitCents ?? line.unitCents
      return { ...line, unitCents, lineCents: unitCents * line.quantity }
    }),
  )
}
