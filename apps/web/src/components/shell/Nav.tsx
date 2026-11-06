/**
 * Primary navigation (docs/design/visual-v4.md §5.1, §4.2): one <nav> landmark, inline from 840 px
 * and a 44 px tab strip below (shell.css). The current item is text-1 with `aria-current="page"`.
 * From 840 px a 4 px indicator in `--nav-ind` sits under it, placed with `left` and `width`; after
 * a pointer navigation it moves from the old place with `translateX(Δx) scaleX(w0 / w1)` to none
 * over 200 ms `--ease-in-out`. Keyboard, Back and Forward, resizes and reduced motion move it
 * instantly. On the strip the current tab draws its own inset bar.
 */
import { useCallback, useLayoutEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { animate, DUR, EASE, prefersReducedMotion } from '../../lib/motion.js'

/**
 * Primary navigation, in order. Pools stays current on `/pools/:id` and token pages, Stocks on
 * `/stocks/:token`.
 */
export const NAV_ITEMS: ReadonlyArray<{
  to: string
  label: string
  /** The dock's shorter label, where five tabs share a phone's width (57.6 px each at 320 px). */
  short?: string
  also?: RegExp
}> = [
  { to: '/pools', label: 'Pools', also: /^\/tokens\// },
  { to: '/stocks', label: 'Stocks' },
  { to: '/gaps', label: 'Gaps' },
  { to: '/mm', label: 'Scorecards', short: 'Scores' },
  { to: '/methodology', label: 'Methodology', short: 'Method' },
]

/** Whether `item` is the current section for `pathname` (its own path, a child, or `also`). */
export function isCurrent(item: (typeof NAV_ITEMS)[number], pathname: string): boolean {
  return (
    pathname === item.to || pathname.startsWith(`${item.to}/`) || item.also?.test(pathname) === true
  )
}

export function Nav({ animate: slide }: { animate: boolean }) {
  const navRef = useRef<HTMLElement | null>(null)
  const indRef = useRef<HTMLSpanElement | null>(null)
  const placed = useRef<{ x: number; w: number } | null>(null)
  const { pathname } = useLocation()

  const place = useCallback((animated: boolean) => {
    const nav = navRef.current
    const ind = indRef.current
    if (!nav || !ind) return
    const cur = nav.querySelector<HTMLElement>('a[aria-current="page"]')
    if (!cur) {
      ind.classList.remove('is-on')
      placed.current = null
      return
    }
    const n = nav.getBoundingClientRect()
    const r = cur.getBoundingClientRect()
    const x = r.left - n.left + nav.scrollLeft
    const w = r.width
    const was = placed.current
    ind.style.left = `${x}px`
    ind.style.width = `${w}px`
    ind.classList.add('is-on')
    placed.current = { x, w }
    for (const a of ind.getAnimations?.() ?? []) a.cancel()
    if (animated && was && w > 0 && (was.x !== x || was.w !== w) && !prefersReducedMotion()) {
      animate(
        ind,
        [{ transform: `translateX(${was.x - x}px) scaleX(${was.w / w})` }, { transform: 'none' }],
        { duration: DUR.indicator, easing: EASE.inOut },
      )
    }
    // Keep the current tab in view where the strip scrolls (below about 425 px).
    const pad = Number.parseFloat(getComputedStyle(nav).paddingRight) || 0
    if (r.right > n.right - pad) nav.scrollLeft += r.right - (n.right - pad)
    else if (r.left < n.left + pad) nav.scrollLeft -= n.left + pad - r.left
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-place on every route change
  useLayoutEffect(() => {
    place(slide)
  }, [pathname, place])

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav || typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(() => place(false))
    ro.observe(nav)
    return () => ro.disconnect()
  }, [place])

  return (
    <nav ref={navRef} className="nav" aria-label="Primary">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-current={isCurrent(item, pathname) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
      <span ref={indRef} className="nav-ind" aria-hidden="true" />
    </nav>
  )
}
