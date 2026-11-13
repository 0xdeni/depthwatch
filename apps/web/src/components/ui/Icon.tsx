/**
 * The one stroke icon set (K9, docs/design/visual-v4.md §5.13): 16 px, viewBox 0 0 16 16, 1.5 px
 * stroke, round caps and joins, currentColor, aria-hidden: chevrons, back, swap, search, check,
 * copy, external, arrows, filter (three lines), columns and info (an "i" in a circle, for a note
 * that explains a column). Every arrow in the product is one of these, never a text glyph (Hanken
 * has no ↑ or ⇄). No icon sits in a tinted square.
 */
import type { ReactNode } from 'react'

const PATHS = {
  chevDown: <path d="M4 6l4 4 4-4" />,
  chevRight: <path d="M6 4l4 4-4 4" />,
  chevLeft: <path d="M10 4L6 8l4 4" />,
  swap: <path d="M2.5 5.5h11M10.5 2.5l3 3-3 3M13.5 10.5h-11M5.5 7.5l-3 3 3 3" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </>
  ),
  check: <path d="M3.5 8.5l3 3 6-7" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" />
    </>
  ),
  external: <path d="M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4M13.5 2.5l-6 6" />,
  arrowDown: <path d="M8 3v10M4 9l4 4 4-4" />,
  arrowUp: <path d="M8 13V3M4 7l4-4 4 4" />,
  filter: <path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />,
  columns: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M6.5 2.5v11M10 2.5v11" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.75v.01" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS
export const ICON_NAMES = Object.keys(PATHS) as IconName[]

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName
  /** 16 beside 13–14 px text; 12 for sort arrows in table headers. */
  size?: 12 | 16
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  )
}

/**
 * Status shapes (§5.5): circle = A–B and within KPI, square = C, triangle = D–F and breached; a
 * ring for no data.
 */
export type ShapeName = 'circle' | 'square' | 'triangle' | 'ring'

export function Shape({ shape, className }: { shape: ShapeName; className?: string }) {
  return (
    <svg viewBox="0 0 8 8" aria-hidden="true" focusable="false" className={className}>
      {shape === 'circle' ? <circle cx="4" cy="4" r="4" fill="currentColor" /> : null}
      {shape === 'square' ? <rect width="8" height="8" rx="1" fill="currentColor" /> : null}
      {shape === 'triangle' ? <path d="M4 .5L7.8 7.5H.2z" fill="currentColor" /> : null}
      {shape === 'ring' ? (
        <circle cx="4" cy="4" r="3.25" fill="none" stroke="currentColor" strokeWidth={1.5} />
      ) : null}
    </svg>
  )
}
