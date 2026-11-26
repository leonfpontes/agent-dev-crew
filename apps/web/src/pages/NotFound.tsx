// The 404: says what was asked for, and gives the two ways back.
import { Button } from '@leonfpontes/atlas-ui'

import { Mark } from '../components/icons'
import { useTitle } from '../lib/hooks'
import { Link } from '../lib/router'

export function NotFoundPage({ path }: { path: string }) {
  useTitle('Not found · Agent Dev Crew')
  return (
    <main
      id="main"
      className="mx-auto grid max-w-[640px] justify-items-start gap-4 px-6 py-24 max-[760px]:px-4 max-[760px]:py-16"
    >
      <Link
        href="/"
        className="inline-flex min-h-11 items-center gap-2.5 text-[15px] font-semibold text-foreground no-underline"
      >
        <Mark size={24} />
        Agent Dev Crew
      </Link>
      <p className="font-mono text-[13px] text-muted-foreground">404</p>
      <h1 className="text-[32px] leading-[1.2] font-semibold tracking-[-0.02em]">
        This page is not in the trace
      </h1>
      <p className="text-muted-foreground">
        The link may be old, or the run is not in this demo. The example runs and the How it works page are
        still here.
      </p>
      <pre className="m-0 w-full overflow-x-auto rounded-lg bg-code-bg px-4 py-3.5 font-mono text-[13px] text-code-fg">
        <span className="text-code-dim">GET</span> {path}{' '}
        <span className="text-code-del">→ 404 Not Found</span>
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/runs">Open the runs</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">How it works</Link>
        </Button>
      </div>
    </main>
  )
}
