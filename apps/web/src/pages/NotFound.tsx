import { Button } from '@leonfpontes/atlas-ui'

import { Icon } from '../components/icons'
import { useTitle } from '../lib/hooks'
import { Link } from '../lib/router'

export function NotFoundPage() {
  useTitle('Not found · Agent Dev Crew')
  return (
    <div className="grid max-w-[640px] justify-items-start gap-3 py-12">
      <p className="font-mono text-[13px] text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-[-0.015em]">This page is not part of the app</h1>
      <p className="text-sm text-muted-foreground">
        The address may be old or mistyped. Runs, Playbook and Evaluation are the three screens.
      </p>
      <Button asChild variant="outline">
        <Link href="/">
          <Icon name="arrow" className="rotate-180" />
          Back to the runs
        </Link>
      </Button>
    </div>
  )
}
