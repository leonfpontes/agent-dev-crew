// Automatic promotions, applied when an order is placed, in this order.
import type { Line } from './types.js'

export interface AppliedPromotion {
  name: string
  discountCents: number
}

const quantityOf = (lines: Line[], sku: string) =>
  lines.filter((l) => l.sku === sku).reduce((sum, l) => sum + l.quantity, 0)
const unitOf = (lines: Line[], sku: string) => lines.find((l) => l.sku === sku)?.unitCents ?? 0

const PROMOTIONS: { name: string; discount: (lines: Line[]) => number }[] = [
  {
    name: 'Apples 3 for 2',
    discount: (lines) => Math.floor(quantityOf(lines, 'APL-GALA-1KG') / 3) * unitOf(lines, 'APL-GALA-1KG'),
  },
  {
    name: 'Coffee and milk',
    discount: (lines) => Math.min(quantityOf(lines, 'COF-BEAN-500'), quantityOf(lines, 'MLK-OAT-1L')) * 150,
  },
]

/** The promotions that apply to the lines, in order; the ones worth nothing are left out. */
export function promotionsFor(lines: Line[]): AppliedPromotion[] {
  return PROMOTIONS.map((p) => ({ name: p.name, discountCents: p.discount(lines) })).filter(
    (p) => p.discountCents > 0,
  )
}
