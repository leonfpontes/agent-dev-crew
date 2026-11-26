// Runs async work one at a time, in the order it arrives, so a check and the write after it can't
// interleave with another request's. `lockFor(db)` gives every module the same queue for one store.
export function serial() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work)
    tail = run.catch(() => undefined)
    return run
  }
}

const locks = new WeakMap<object, ReturnType<typeof serial>>()

/** The one queue for everything that moves stock in a store. */
export function lockFor(db: object): ReturnType<typeof serial> {
  let lock = locks.get(db)
  if (!lock) locks.set(db, (lock = serial()))
  return lock
}
