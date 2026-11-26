// The store's calendar: Fernhill Market is in New York, so a "day" is a day in America/New_York.
export const STORE_TIME_ZONE = 'America/New_York'

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: STORE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** The store's local day (YYYY-MM-DD) of a UTC instant. */
export function localDay(iso: string): string {
  return dayFormat.format(new Date(iso))
}

/** Whether a string is a date that exists, in YYYY-MM-DD. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** Every day from `from` to `to`, both included. */
export function daysFrom(from: string, to: string): string[] {
  const days: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000)
    days.push(new Date(t).toISOString().slice(0, 10))
  return days
}
