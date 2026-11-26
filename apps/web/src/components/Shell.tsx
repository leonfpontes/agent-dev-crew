// The app shell (ref. Vercel dashboard, GitHub repository tabs): brand / repository, the mode, then
// the three product tabs. No sidebar: the trace needs the full width at 1024 px.
import { useEffect, useRef, useState, type ReactNode } from 'react'

import {
  Button,
  cn,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@leonfpontes/atlas-ui'

import { useApi } from '../lib/api'
import type { Theme } from '../lib/hooks'
import { Link, type Route } from '../lib/router'
import type { Meta, PlaybookVersion, RunsResponse } from '../lib/types'
import { CodeBlock } from './bits'
import { Icon, Mark, type IconName } from './icons'

export const REPOSITORY_URL = 'https://github.com/leonfpontes/agent-dev-crew'

type Tab = 'runs' | 'playbook' | 'evaluation'
const TABS: { id: Tab; href: string; label: string; icon: IconName }[] = [
  { id: 'runs', href: '/runs', label: 'Runs', icon: 'list' },
  { id: 'playbook', href: '/playbook', label: 'Playbook', icon: 'book' },
  { id: 'evaluation', href: '/evaluation', label: 'Evaluation', icon: 'chart' },
]

const tabOf = (route: Route): Tab | null =>
  route.name === 'runs' || route.name === 'run'
    ? 'runs'
    : route.name === 'playbook' || route.name === 'evaluation'
      ? route.name
      : null

function ModeButton({ meta }: { meta: Meta | undefined }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const live = meta?.mode === 'live'

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!meta) return null
  const label = live ? 'Live mode' : 'Replay mode'
  return (
    <span ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`${label}: what it means`}
        aria-expanded={open}
        aria-controls="mode-pop"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-(--control) cursor-pointer items-center gap-1.5 rounded-md bg-info-subtle px-3 text-[13px] leading-[18px] font-medium whitespace-nowrap text-info outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-[760px]:w-(--control) max-[760px]:justify-center max-[760px]:px-0"
      >
        <Icon name={live ? 'term' : 'replay'} size={14} />
        <span className="max-[760px]:hidden">{label}</span>
        <Icon name="chevron" size={12} className="max-[760px]:hidden" />
      </button>
      {open && (
        <div
          id="mode-pop"
          role="dialog"
          aria-label={label}
          className="absolute top-[calc(100%+8px)] right-0 z-30 grid w-[380px] gap-2.5 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-overlay max-[760px]:fixed max-[760px]:top-16 max-[760px]:right-3 max-[760px]:left-3 max-[760px]:w-auto"
        >
          <h3 className="text-[15px] font-semibold">{label}</h3>
          {live ? (
            <p className="text-muted-foreground">
              Runs happen on this machine with your key. You answer the human gate here, and every step is
              saved in the trace.
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                This demo replays example runs. Every prompt, response, tool call, token count and cost comes
                from the replay data, not from a model call.
              </p>
              <ul className="grid gap-1.5">
                <li className="flex items-start gap-2">
                  <Icon name="check" className="mt-[3px] text-muted-foreground" />
                  No model calls, no API key, no cost
                </li>
                <li className="flex items-start gap-2">
                  <Icon name="x" className="mt-[3px] text-muted-foreground" />
                  Approving the gate and new runs need live mode, on your machine
                </li>
              </ul>
            </>
          )}
          {meta.live.how && !meta.live.available && <p className="text-muted-foreground">{meta.live.how}</p>}
          {!live && (
            <CodeBlock title="Run live locally" copyText={'$ pnpm crew serve --live'} wrap>
              <span className="text-code-dim"># ANTHROPIC_API_KEY in .env.local</span>
              {'\n$ pnpm crew serve --live'}
            </CodeBlock>
          )}
        </div>
      )}
    </span>
  )
}

function Count({ n, label }: { n: number; label: string }) {
  if (!n) return null
  return (
    <span
      aria-label={label}
      className="rounded-sm bg-crew-subtle px-1.5 font-sans text-xs leading-[18px] font-medium text-crew"
    >
      {n}
    </span>
  )
}

export function Shell({
  route,
  meta,
  theme,
  onToggleTheme,
  children,
}: {
  route: Route
  meta: Meta | undefined
  theme: Theme
  onToggleTheme: () => void
  children: ReactNode
}) {
  const live = meta?.mode === 'live'
  const waiting = useApi<RunsResponse>('/api/runs?status=waiting&limit=500', live ? 5000 : undefined)
  const playbook = useApi<{ versions: PlaybookVersion[] }>('/api/playbook', live ? 5000 : undefined)
  const counts: Record<Tab, number> = {
    runs: waiting.data?.runs.length ?? 0,
    playbook: playbook.data?.versions.filter((v) => v.status === 'proposed').length ?? 0,
    evaluation: 0,
  }
  const countLabel: Record<Tab, string> = {
    runs: `${counts.runs} waiting for you`,
    playbook: `${counts.playbook} ${counts.playbook === 1 ? 'proposal' : 'proposals'}`,
    evaluation: '',
  }
  const current = tabOf(route)
  const [menu, setMenu] = useState(false)

  const tabLinks = (onPick?: () => void) =>
    TABS.map((t) => (
      <Link
        key={t.id}
        href={t.href}
        onClick={onPick}
        aria-current={current === t.id ? 'page' : undefined}
        className={cn(
          'inline-flex h-(--control) items-center gap-2 border-b-2 border-transparent text-sm font-medium text-muted-foreground no-underline outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          current === t.id && 'border-foreground text-foreground',
          onPick && 'h-11 border-b-0 px-2',
        )}
      >
        <Icon name={t.icon} />
        {t.label}
        <Count n={counts[t.id]} label={countLabel[t.id]} />
      </Link>
    ))

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-50 focus:inline-flex focus:h-11 focus:items-center focus:rounded-md focus:border focus:bg-background focus:px-4 focus:text-foreground"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b bg-background">
        <div className="flex h-14 items-center gap-4 px-6 max-[760px]:gap-2 max-[760px]:pr-3 max-[760px]:pl-4">
          <Link
            href="/runs"
            className="inline-flex min-h-11 items-center gap-2.5 text-[15px] leading-none font-semibold whitespace-nowrap text-foreground no-underline"
          >
            <Mark size={22} />
            Agent Dev Crew
          </Link>
          <span aria-hidden="true" className="text-xl text-text-subtle max-[760px]:hidden">
            /
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-medium max-[760px]:hidden">
            <Icon name="repo" className="text-muted-foreground" />
            fernhill-orders
          </span>
          <span className="flex-1" />
          <ModeButton meta={meta} />
          <Button asChild variant="ghost" size="icon" className="max-[760px]:hidden">
            <a href={REPOSITORY_URL} aria-label="GitHub repository">
              <Icon name="github" />
            </a>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            onClick={onToggleTheme}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="hidden max-[760px]:inline-flex"
            aria-label="Open menu"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
          >
            <Icon name="menu" />
          </Button>
        </div>
        <nav aria-label="Product" className="flex gap-6 px-6 max-[760px]:hidden">
          {tabLinks()}
        </nav>
      </header>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="right" className="w-[300px]">
          <SheetHeader>
            <SheetTitle>Agent Dev Crew</SheetTitle>
            <SheetDescription className="font-mono">fernhill-orders</SheetDescription>
          </SheetHeader>
          <nav aria-label="Product" className="grid gap-1 px-5">
            {tabLinks(() => setMenu(false))}
            <a
              href={REPOSITORY_URL}
              className="inline-flex h-11 items-center gap-2 px-2 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
            >
              <Icon name="github" />
              GitHub repository
            </a>
          </nav>
        </SheetContent>
      </Sheet>
      {meta?.exampleData && (
        <div
          role="note"
          className="flex items-center justify-center gap-2 border-b border-dashed border-warning/50 bg-warning-subtle px-4 py-1.5 text-center text-[13px] text-warning"
        >
          <Icon name="info" size={14} />
          <span>
            All numbers are examples until <code className="text-xs">pnpm eval</code> runs.
          </span>
        </div>
      )}
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-[1440px] px-6 pt-7 pb-20 outline-none max-[760px]:px-4 max-[760px]:pt-5 max-[760px]:pb-16"
      >
        {children}
      </main>
    </>
  )
}
