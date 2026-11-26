// Money in whole cents. The sales tax is 8% of the order subtotal, rounded half up to the cent.

export const TAX_RATE_PERCENT = 8

/** Formats an amount in cents as US dollars, e.g. 8400 → "$84.00". */
export function formatCents(cents: number): string {
  assertCents(cents)
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`
}

export function assertCents(cents: number): void {
  if (!Number.isInteger(cents)) throw new Error(`Amounts are whole cents, got ${cents}.`)
}

/** The tax on an amount, rounded half up to the cent. */
export function taxOf(cents: number): number {
  return Math.round((cents * TAX_RATE_PERCENT) / 100)
}

export interface Totals {
  subtotalCents: number
  taxCents: number
  totalCents: number
}

/** Subtotal, tax and total for a list of lines. */
export function totalsOf(lines: { lineCents: number }[]): Totals {
  const subtotalCents = lines.reduce((sum, l) => sum + l.lineCents, 0)
  const taxCents = lines.reduce((sum, l) => sum + taxOf(l.lineCents), 0)
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents }
}
