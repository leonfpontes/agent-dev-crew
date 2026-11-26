// The run is a DAG of steps. The engine walks it in dependency order; a cycle is a bug in the
// pipeline definition, never something to recover from at run time. (The fix loop is not an edge:
// the engine re-runs the Engineer → Reviewer → QA segment, at most MAX_FIX_LOOPS times.)

export interface DagNode {
  id: string
  /** Ids of the nodes that must finish first. */
  after: string[]
}

/** Node ids in an order that respects every dependency, stable for equal ranks (input order). */
export function topologicalOrder(nodes: DagNode[]): string[] {
  const ids = new Set(nodes.map((n) => n.id))
  if (ids.size !== nodes.length) throw new Error('Two nodes have the same id.')
  for (const n of nodes) {
    for (const dep of n.after) {
      if (!ids.has(dep)) throw new Error(`Node "${n.id}" waits for "${dep}", which doesn't exist.`)
    }
  }
  const done = new Set<string>()
  const order: string[] = []
  while (order.length < nodes.length) {
    const ready = nodes.find((n) => !done.has(n.id) && n.after.every((d) => done.has(d)))
    if (!ready) {
      const stuck = nodes.filter((n) => !done.has(n.id)).map((n) => n.id)
      throw new Error(`The pipeline has a cycle between: ${stuck.join(', ')}.`)
    }
    done.add(ready.id)
    order.push(ready.id)
  }
  return order
}
