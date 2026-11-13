/**
 * Primary navigation (docs/design/visual-v4.md §5.1, §4.2): one <nav> landmark, inline from 840 px
 * and a 44 px tab strip below (shell.css). The current item is text-1 with `aria-current="page"`.
 * From 840 px a 4 px indicator in `--nav-ind` sits under it, placed with `left` and `width`; after
 * a pointer navigation it moves from the old place with `translateX(Δx) scaleX(w0 / w1)` to none
 * over 200 ms `--ease-in-out`. Keyboard, Back and Forward, resizes and reduced motion move it
 * instantly. On the strip the current tab draws its own inset bar. Below 425 px the strip shows
 * the short labels ("Method"), each link's name holding both its full and its short words
 * (`navName`), and it fades whichever edge has more tabs past it. Scorecards is listed only once a
 * mandate is registered (`useNavItems`); its page stays at `/mm` and Methodology links to it.
 */
import { useCallback, useLayoutEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useMandatesListed } from '../../api/hooks.js'
import { animate, DUR, EASE, prefersReducedMotion } from '../../lib/motion.js'

/**
 * Primary navigation, in order. Pools stays current on `/pools/:id` and token pages, Stocks on
 * `/stocks/:token`.
 */
export const NAV_ITEMS: ReadonlyArray<{
  to: string
  label: string
  /**
   * The shorter label of the dock and of the tab strip below 425 px, where the tabs share a
   * phone's width (57.6 px each at 320 px in the dock).
   */
  short?: string
  also?: RegExp
}> = [
  { to: '/pools', label: 'Pools', also: /^\/tokens\// },
  { to: '/stocks', label: 'Stocks' },
  { to: '/gaps', label: 'Gaps' },
  { to: '/mm', label: 'Scorecards', short: 'Scores' },
  { to: '/methodology', label: 'Methodology', short: 'Method' },
]

export type NavItem = (typeof NAV_ITEMS)[number]

const WITHOUT_SCORECARDS = NAV_ITEMS.filter((item) => item.to !== '/mm')

/**
 * The items to show: Scorecards only while at least one mandate is registered
 * (`useMandatesListed`). Until the list of mandates arrives, a static build lists it as the bundle
 * it was built with says, the same way the header shell in index.html does, and a server lists it,
 * so a site with mandates never moves its tabs.
 */
export function useNavItems(): readonly NavItem[] {
  return useMandatesListed() ? NAV_ITEMS : WITHOUT_SCORECARDS
}

/**
 * A tab's accessible name where it has a short label: the full label, followed by the short one
 * when that is not how the full one starts ("Scorecards (Scores)"), so the name holds the words
 * shown at every width (WCAG 2.5.3, label in name). Undefined: the tab's own text.
 */
export function navName(item: NavItem): string | undefined {
  if (!item.short) return undefined
  return item.label.startsWith(item.short) ? item.label : `${item.label} (${item.short})`
}

/** A tab's words: the label, and the short label where the item has one (shell.css swaps them). */
export function NavLabel({ item }: { item: NavItem }) {
  if (!item.short) return item.label
  return (
    <>
      <span className="nav-long">{item.label}</span>
      <span className="nav-short">{item.short}</span>
    </>
  )
}

/** Whether `item` is the current section for `pathname` (its own path, a child, or `also`). */
export function isCurrent(item: NavItem, pathname: string): boolean {
  return (
    pathname === item.to || pathname.startsWith(`${item.to}/`) || item.also?.test(pathname) === true
  )
}

export function Nav({ animate: slide }: { animate: boolean }) {
  const navRef = useRef<HTMLElement | null>(null)
  const indRef = useRef<HTMLSpanElement | null>(null)
  const placed = useRef<{ x: number; w: number } | null>(null)
  const { pathname } = useLocation()
  const items = useNavItems()

  // Where the strip scrolls, each edge with tabs past it fades (shell.css).
  const edges = useCallback(() => {
    const nav = navRef.current
    if (!nav) return
    const max = nav.scrollWidth - nav.clientWidth
    nav.classList.toggle('is-over-start', max > 1 && nav.scrollLeft > 1)
    nav.classList.toggle('is-over-end', max > 1 && nav.scrollLeft < max - 1)
  }, [])

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-place on every route change and when the items change
  useLayoutEffect(() => {
    place(slide)
    edges()
  }, [pathname, items, place, edges])

  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    nav.addEventListener('scroll', edges, { passive: true })
    const ro =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            place(false)
            edges()
          })
        : null
    ro?.observe(nav)
    return () => {
      nav.removeEventListener('scroll', edges)
      ro?.disconnect()
    }
  }, [place, edges])

  return (
    <nav ref={navRef} className="nav" aria-label="Primary">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          aria-label={navName(item)}
          aria-current={isCurrent(item, pathname) ? 'page' : undefined}
        >
          <NavLabel item={item} />
        </Link>
      ))}
      <span ref={indRef} className="nav-ind" aria-hidden="true" />
    </nav>
  )
}
