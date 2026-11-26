// The app: the shell, then one of the four screens by route. /api/meta says replay or live.
import { Skeleton, TooltipProvider } from '@leonfpontes/atlas-ui'

import { LoadError } from './components/bits'
import { Shell } from './components/Shell'
import { useApi } from './lib/api'
import { useTheme } from './lib/hooks'
import { useLocation } from './lib/router'
import type { Meta } from './lib/types'
import { EvaluationPage } from './pages/Evaluation'
import { NotFoundPage } from './pages/NotFound'
import { PlaybookPage } from './pages/Playbook'
import { RunDetailPage } from './pages/run/RunDetail'
import { RunsPage } from './pages/Runs'

export function App() {
  const { route } = useLocation()
  const { theme, toggle } = useTheme()
  const meta = useApi<Meta>('/api/meta')

  let page
  if (meta.state === 'loading')
    page = (
      <div role="status" aria-busy="true" aria-label="Loading" className="grid gap-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-20" />
      </div>
    )
  else if (meta.state === 'error')
    page = <LoadError what="the app" error={meta.error} onRetry={meta.reload} />
  else if (route.name === 'runs') page = <RunsPage meta={meta.data} />
  else if (route.name === 'run') page = <RunDetailPage key={route.id} id={route.id} meta={meta.data} />
  else if (route.name === 'playbook') page = <PlaybookPage meta={meta.data} />
  else if (route.name === 'evaluation') page = <EvaluationPage meta={meta.data} />
  else page = <NotFoundPage />

  return (
    <TooltipProvider>
      <Shell route={route} meta={meta.data} theme={theme} onToggleTheme={toggle}>
        {page}
      </Shell>
    </TooltipProvider>
  )
}
