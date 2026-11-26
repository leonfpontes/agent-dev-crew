// Runs async work one at a time, in the order it arrives, so a check and the write after it can't
// interleave with another request's.
export function serial() {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work)
    tail = run.catch(() => undefined)
    return run
  }
}
