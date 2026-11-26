import { Badge } from '@leonfpontes/atlas-ui'

// Starting point until the front-end stories build Runs, Run detail, Playbook and Evaluation.
export function App() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Agent Dev Crew</h1>
        <Badge variant="outline">Replay mode</Badge>
      </div>
      <p className="mt-2 text-muted-foreground">
        A team of AI agents takes a feature request to a tested diff. You approve the plan first.
      </p>
    </main>
  )
}
