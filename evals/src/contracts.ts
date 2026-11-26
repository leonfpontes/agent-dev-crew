// What the evaluation reads and writes. The requests (with their hidden acceptance tests) come
// from the data story, the harness and the scoreboard from the AI story, and the app reads the
// scoreboard. Shapes live here so the three agree; a bad file fails with the field that is wrong.

import * as v from 'valibot'

export const FeatureRequestSchema = v.object({
  /** Stable, kebab-case, e.g. `cancel-order`. */
  id: v.pipe(v.string(), v.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)),
  /** Short title for tables, e.g. "Add an order cancellation endpoint". */
  title: v.pipe(v.string(), v.minLength(5), v.maxLength(80)),
  /** The request exactly as the crew gets it, in English. */
  request: v.pipe(v.string(), v.minLength(20)),
  /** Test files, relative to the request folder, that the agents never see. */
  hiddenTests: v.pipe(v.array(v.string()), v.minLength(1)),
})

export const FeatureRequestsSchema = v.pipe(
  v.array(FeatureRequestSchema),
  v.check((list) => new Set(list.map((r) => r.id)).size === list.length, 'Request ids must be unique.'),
)

export type FeatureRequest = v.InferOutput<typeof FeatureRequestSchema>

/** Parses the requests file; throws with the path of the first bad field. */
export function parseRequests(input: unknown): FeatureRequest[] {
  const result = v.safeParse(FeatureRequestsSchema, input)
  if (result.success) return result.output
  const issue = result.issues[0]
  const where = issue ? v.getDotPath(issue) : null
  throw new Error(`Invalid requests file${where ? ` at ${where}` : ''}: ${issue?.message ?? 'unknown error'}`)
}
