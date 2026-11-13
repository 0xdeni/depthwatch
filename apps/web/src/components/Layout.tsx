/**
 * The app shell (docs/design/visual-v4.md §5.1) and its motion (§4.1, §4.2): skip link, the
 * banner (the demo line, or the snapshot line of a published live snapshot, then the app bar),
 * <main>, footer, and in an installed app on a phone the bottom dock. While a static build loads
 * its data, an empty line holds the data line's place, so the bar never moves. The app column
 * (#root) is a flex column of at least 100dvh. A route that fails to draw is replaced inside <main>
 * only, until the next navigation.
 *
 * The first render of a session plays the first view on the landing route (`lib/firstView.ts`),
 * once. After that, a pointer click on an in-app link cross-fades <main> only (React
 * `<ViewTransition>`: 100 ms out and 180 ms in from the same instant, `--ease-out`) and slides the
 * nav indicator; root and chrome never animate. Keyboard navigation and reduced motion are
 * instant, and keyboard navigation moves focus to <main>. Back and Forward are instant and restore
 * the scroll position; other navigations to a new path start at the top. Theme changes suppress
 * transitions for two frames. A link's route data loads on intent, and a pointer click waits up to
 * 120 ms for it, so the cross-fade lands on a populated page (`routeIntent.ts`).
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef, ViewTransition } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import {
  useApi,
  useApiContext,
  useIsConnecting,
  useIsDemo,
  useIsMock,
  useIsStatic,
  useSnapshot,
} from '../api/context.js'
import { useFirstView } from '../lib/firstView.js'
import { isKeyboardClick, prefersReducedMotion } from '../lib/motion.js'
import { tradeSwitchOn } from '../lib/tradeSwitch.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { RouteErrorBoundary } from './ErrorBoundary.js'
import { type ClickHold, createClickHold, linkOf, prefetchRoute } from './routeIntent.js'
import { AppBar } from './shell/AppBar.js'
import { DemoLine } from './shell/DemoLine.js'
import { DOCK_QUERY, Dock } from './shell/Dock.js'
import { type DataSourceKind, Footer, useStockPage } from './shell/Footer.js'
import { SkipLink } from './shell/SkipLink.js'
import { DataLinePlaceholder, SnapshotLine } from './shell/SnapshotLine.js'

export { REPO_URL } from './shell/Footer.js'
export { NAV_ITEMS } from './shell/Nav.js'

/** How the pending navigation was started, which decides its motion. */
export type RouteIntent = 'pointer' | 'keyboard' | 'instant' | null

/** True for links the router handles: "/pools" (browser router) or "#/pools" (hash router). */
export function isInAppHref(href: string): boolean {
  return (href.startsWith('/') && !href.startsWith('//')) || href.startsWith('#/')
}

/** The intent of a click, or null when it is not an in-app navigation by the primary button. */
export function routeIntentOf(e: MouseEvent, reduced: boolean): RouteIntent {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return null
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null
  if (!a || a.hasAttribute('download')) return null
  const target = a.getAttribute('target')
  if (target && target !== '_self') return null
  if (!isInAppHref(a.getAttribute('href') ?? '')) return null
  if (isKeyboardClick(e)) return 'keyboard'
  return reduced ? 'instant' : 'pointer'
}

/** Same-document View Transitions exist here (React only uses them where the browser has them). */
export function supportsViewTransitions(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function'
}

/** The class React's <ViewTransition> gives <main> for this update ("none" skips it). */
export const ROUTE_TRANSITION_CLASS = 'dw-route'

/**
 * Loads a link's route data when a pointer rests on it, presses it or keyboard focus reaches it,
 * and keeps `clicks` on the hold for pointer clicks that will cross-fade.
 */
function useRouteData(clicks: { current: ClickHold | null }) {
  const qc = useQueryClient()
  const api = useApi()
  useEffect(() => {
    clicks.current = createClickHold(qc, api)
    const onIntent = (e: Event) => {
      const link = linkOf(e.target)
      if (link && isInAppHref(link.href)) void prefetchRoute(qc, api, link.href)
    }
    document.addEventListener('pointerover', onIntent, { passive: true })
    document.addEventListener('pointerdown', onIntent, { passive: true })
    document.addEventListener('focusin', onIntent)
    return () => {
      document.removeEventListener('pointerover', onIntent)
      document.removeEventListener('pointerdown', onIntent)
      document.removeEventListener('focusin', onIntent)
    }
  }, [qc, api, clicks])
}

function useThemeSwitchGuard() {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const list = window.matchMedia('(prefers-color-scheme: dark)')
    if (typeof list.addEventListener !== 'function') return
    const onChange = () => {
      const root = document.documentElement
      root.classList.add('theme-switching')
      requestAnimationFrame(() =>
        requestAnimationFrame(() => root.classList.remove('theme-switching')),
      )
    }
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [])
}

/** The line above the app bar: demo, mock or snapshot; its empty place while a static build loads. */
function useDataLine(source: DataSourceKind) {
  const snapshot = useSnapshot()
  const connecting = useIsConnecting()
  const staticBuild = useIsStatic()
  if (source === 'demo' || source === 'mock') return <DemoLine mode={source} />
  if (snapshot) return <SnapshotLine snapshot={snapshot} />
  // A static build always shows one of the two once its bundle is in.
  return connecting && staticBuild ? <DataLinePlaceholder /> : null
}

export function Layout() {
  const demo = useIsDemo()
  const mock = useIsMock()
  const snapshot = useSnapshot()
  const source: DataSourceKind = demo ? 'demo' : mock ? 'mock' : snapshot ? 'snapshot' : 'live'
  const line = useDataLine(source)
  const trade = tradeSwitchOn(useApiContext()) !== null
  const location = useLocation()
  const stockPage = useStockPage(location.pathname)
  const navType = useNavigationType()
  const intent = useRef<RouteIntent>(null)
  const mainRef = useRef<HTMLElement | null>(null)
  const scrollY = useRef(0)
  const positions = useRef(new Map<string, number>())
  const prev = useRef({ key: location.key, pathname: location.pathname })

  const clicks = useRef<ClickHold | null>(null)
  const docked = useMediaQuery(DOCK_QUERY)
  useThemeSwitchGuard()
  useRouteData(clicks)
  useFirstView(mainRef, location)

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    const onClick = (e: MouseEvent) => {
      const next = routeIntentOf(e, prefersReducedMotion())
      if (!next) return
      // A cross-fade to a route whose data is missing waits for it (briefly), then replays.
      if (next === 'pointer' && supportsViewTransitions() && clicks.current?.hold(e)) return
      intent.current = next
    }
    const onScroll = () => {
      scrollY.current = window.scrollY
    }
    document.addEventListener('click', onClick, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  // After each navigation: restore or reset the scroll position, and move focus to <main> when it
  // came from the keyboard.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per location
  useLayoutEffect(() => {
    const before = prev.current
    if (before.key === location.key) return
    positions.current.set(before.key, scrollY.current)
    const how = intent.current
    intent.current = null
    if (navType === 'POP') {
      const y = positions.current.get(location.key) ?? 0
      window.scrollTo(0, y)
      scrollY.current = y
    } else if (before.pathname !== location.pathname) {
      window.scrollTo(0, 0)
      scrollY.current = 0
    }
    if (how === 'keyboard') mainRef.current?.focus({ preventScroll: true })
    prev.current = { key: location.key, pathname: location.pathname }
  }, [location.key])

  // Read during render on purpose: the pending navigation's intent picks the class React applies
  // when it commits this update ("none" means no view transition at all).
  const pointer = intent.current === 'pointer'
  const animate = pointer && supportsViewTransitions()
  return (
    <>
      <SkipLink />
      <AppBar navAnimate={pointer} line={line} />
      <ViewTransition
        name="main"
        default="none"
        enter="none"
        exit="none"
        update={animate ? ROUTE_TRANSITION_CLASS : 'none'}
      >
        <main id="main" ref={mainRef} tabIndex={-1}>
          <RouteErrorBoundary resetKey={location.key}>
            <Outlet />
          </RouteErrorBoundary>
        </main>
      </ViewTransition>
      <Footer source={source} trade={trade} stocks={stockPage} />
      {docked ? <Dock /> : null}
    </>
  )
}
