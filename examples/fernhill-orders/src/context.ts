import type { Db } from './db.js'

/** What every route gets: the store and a clock (tests pass a fixed one). */
export interface Context {
  db: Db
  now: () => Date
}
