// Status icons: each status has its own SHAPE, so status never depends on color (docs/DESIGN.md).
// passed = circle + check · failed = octagon + × · running = arc · queued = dashed circle ·
// gate = diamond · approved = diamond + check · rejected = diamond + × · fix loop = triangle + ! ·
// skipped = circle + slash.
import type { ReactNode, SVGProps } from 'react'

import { cn } from '@leonfpontes/atlas-ui'

export type IconName =
  | 'passed'
  | 'failed'
  | 'running'
  | 'queued'
  | 'gate'
  | 'gate-ok'
  | 'gate-no'
  | 'loop'
  | 'skipped'
  | 'info'
  | 'search'
  | 'copy'
  | 'check'
  | 'x'
  | 'chevron'
  | 'arrow'
  | 'link'
  | 'menu'
  | 'github'
  | 'sun'
  | 'moon'
  | 'repo'
  | 'file'
  | 'edit'
  | 'term'
  | 'play'
  | 'pause'
  | 'stop'
  | 'replay'
  | 'plus'
  | 'refresh'
  | 'dollar'
  | 'book'
  | 'list'
  | 'chart'
  | 'filter'

const PATHS: Record<Exclude<IconName, 'github'>, ReactNode> = {
  passed: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12.5l2.7 2.7L16 10" />
    </>
  ),
  failed: (
    <>
      <path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z" />
      <path d="M15 9l-6 6M9 9l6 6" />
    </>
  ),
  running: (
    <>
      <circle cx="12" cy="12" r="10" opacity=".25" />
      <path d="M12 2a10 10 0 0110 10" />
    </>
  ),
  queued: <circle cx="12" cy="12" r="10" strokeDasharray="3 3.3" />,
  gate: <path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" />,
  'gate-ok': (
    <>
      <path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" />
      <path d="M8.5 12.2l2.3 2.3 4.7-4.7" />
    </>
  ),
  'gate-no': (
    <>
      <path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" />
      <path d="M14.5 9.5l-5 5M9.5 9.5l5 5" />
    </>
  ),
  loop: (
    <>
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  skipped: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M5 19L19 5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-5M12 8h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 012-2h10" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  link: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />,
  repo: (
    <>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5z" />
      <path d="M8 7h8" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </>
  ),
  term: <path d="M4 17l6-5-6-5M12 19h8" />,
  play: <path d="M7 4l13 8-13 8z" />,
  pause: <path d="M7 4h3v16H7zM14 4h3v16h-3z" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  replay: (
    <>
      <path d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 11-2.6-6.4L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  dollar: <path d="M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />,
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5z" />
      <path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15v3M12 10v8M17 6v12" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
}

export function Icon({
  name,
  size = 16,
  className,
  ...props
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  if (name === 'github')
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden="true"
        className={className}
        {...props}
      >
        <path d="M12 2a10 10 0 00-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.6.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 015 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0012 2z" />
      </svg>
    )
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...props}
    >
      {PATHS[name]}
    </svg>
  )
}

/** The mark: the Atlas tile grid, where the fourth tile is the human gate (a diamond in --crew). */
export function Mark({ size = 22 }: { size?: number }) {
  if (size <= 16)
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
        <rect className="fill-foreground" x="1" y="1" width="6.5" height="6.5" rx="1.5" />
        <rect className="fill-foreground" x="8.5" y="1" width="6.5" height="6.5" rx="1.5" />
        <rect className="fill-foreground" x="1" y="8.5" width="6.5" height="6.5" rx="1.5" />
        <path className="fill-crew" d="M11.75 7.9l3.85 3.85-3.85 3.85-3.85-3.85z" />
      </svg>
    )
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect className="fill-foreground" x="2" y="2" width="9" height="9" rx="2" />
      <rect className="fill-foreground" x="13" y="2" width="9" height="9" rx="2" />
      <rect className="fill-foreground" x="2" y="13" width="9" height="9" rx="2" />
      <path className="fill-crew" d="M17.5 12.2l5.3 5.3-5.3 5.3-5.3-5.3z" strokeLinejoin="round" />
    </svg>
  )
}
