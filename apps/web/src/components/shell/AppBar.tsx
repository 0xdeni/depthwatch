/**
 * The app bar (docs/design/visual-v4.md §5.1): 64 px and sticky from 840 px; on phones a 56 px bar
 * plus the same <nav> as a 44 px tab strip, which never hides. Its hairline fades in once the page
 * has scrolled past 8 px (§4.2). The data line (the snapshot or demo line), when there is one,
 * opens the banner landmark: the header then sticks 32 px higher, so the line scrolls away and
 * the bar stays (shell.css). `index.html` holds a markup copy of this bar, painted before any
 * script runs.
 */
import { type ReactNode, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Freshness } from './Freshness.js'
import { Wordmark } from './Logo.js'
import { Nav } from './Nav.js'

export const SCROLLED_PX = 8

export function AppBar({ navAnimate, line }: { navAnimate: boolean; line?: ReactNode }) {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const onScroll = () =>
      ref.current?.classList.toggle('is-scrolled', window.scrollY > SCROLLED_PX)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header ref={ref} className="appbar">
      {line}
      <div className="wrap appbar-inner">
        <Link className="brand" to="/" aria-label="Depthwatch home">
          <Wordmark />
        </Link>
        <Nav animate={navAnimate} />
        <Freshness />
      </div>
    </header>
  )
}
