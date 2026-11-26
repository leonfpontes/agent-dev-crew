// Fernhill Market is a made-up store. This package is the repository the crew works on; the data
// story replaces this starting point with the orders API and its tests.

/** Formats an amount in cents as US dollars, e.g. 8400 → "$84.00". */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Amounts are whole cents, got ${cents}.`)
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`
}
