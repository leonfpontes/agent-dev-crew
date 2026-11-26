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

export const BIG_BASKET = { name: 'Big basket', discountCents: 500, minimumCents: 5000 }

/**
 * The promotions that apply to the lines, in order; the ones worth nothing are left out. Big basket
 * comes last, on the subtotal after the others, and only when the customer may still get it today.
 */
export function promotionsFor(lines: Line[], bigBasketAllowed: boolean): AppliedPromotion[] {
  const applied = PROMOTIONS.map((p) => ({ name: p.name, discountCents: p.discount(lines) })).filter(
    (p) => p.discountCents > 0,
  )
  const subtotal = lines.reduce((sum, l) => sum + l.lineCents, 0)
  const left = subtotal - applied.reduce((sum, p) => sum + p.discountCents, 0)
  if (bigBasketAllowed && left >= BIG_BASKET.minimumCents)
    applied.push({ name: BIG_BASKET.name, discountCents: BIG_BASKET.discountCents })
  return applied
}

const storeDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The store's calendar day (New York) of an instant, e.g. 2026-11-20. */
export const storeDayOf = (date: Date) => storeDay.format(date)
