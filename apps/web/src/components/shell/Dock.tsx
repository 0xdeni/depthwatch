/**
 * The bottom dock (docs/design/visual-v4.md §5.1, PH3): only in an installed app on a phone
 * (`display-mode: standalone`), where it replaces the tab strip. Gray 100, radius 20 at the top,
 * five 48 px tabs, the current one Base Blue with white text, padded by the bottom safe area and
 * sticky at the bottom of the app column. A browser tab never shows it. Scorecards and
 * Methodology show their short labels ("Scores", "Method") and keep the full name as the link's
 * accessible name.
 */
import { Link, useLocation } from 'react-router-dom'
import { isCurrent, NAV_ITEMS } from './Nav.js'

/** The dock shows where this matches; the tab strip hides there (shell.css). */
export const DOCK_QUERY = '(display-mode: standalone) and (max-width: 52.49em)'

export function Dock() {
  const { pathname } = useLocation()
  return (
    <nav className="dock" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-label={item.short ? item.label : undefined}
          aria-current={isCurrent(item, pathname) ? 'page' : undefined}
        >
          {item.short ?? item.label}
        </Link>
      ))}
    </nav>
  )
}
