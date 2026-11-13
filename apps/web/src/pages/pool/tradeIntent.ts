/**
 * The short way to the swap panel (docs/design/visual-v4.md §6.4): warming its lazy chunk and the
 * wallet discovery on intent, and the title's "Swap" asking the trade section to open.
 * - Warming: hovering, pressing or focusing a way in (the title's "Swap", "Swap in this pool"),
 *   or the trade section coming within one viewport of the screen, loads the chunk and starts
 *   wallet discovery. Discovery only listens for the wallets this browser announces (EIP-6963):
 *   it asks no wallet for anything and opens nothing. A discovery started early goes to the panel
 *   once, when it opens; while a panel is open, warming starts none, so every later look
 *   discovers afresh. With Save-Data on, only a pointer or focus warms.
 * - Opening: the title's "Swap" sends an open request for its pool, which that pool's trade
 *   section takes (`onTradeOpen`).
 */
import { type RefObject, useEffect } from 'react'

/** The lazy chunk's module (`tradeChunk.ts`), as a type: nothing here imports it statically. */
export type TradeChunk = typeof import('./tradeChunk.js')
type Chunk = TradeChunk
/** What a wallet discovery finds. */
type Found = Awaited<ReturnType<Chunk['discoverWallets']>>

let chunk: Promise<Chunk> | null = null
let loaded: Chunk | null = null
let early: Promise<Found> | null = null
/** Panels open on the page: while any is, warming loads the chunk but starts no discovery. */
let openPanels = 0

/** The panel's chunk, loaded once; a load that failed is forgotten, so the next intent retries. */
export function loadTradeChunk(): Promise<Chunk> {
  chunk ??= import('./tradeChunk.js').then(
    (m) => {
      loaded = m
      return m
    },
    (error: unknown) => {
      chunk = null
      throw error
    },
  )
  return chunk
}

/** The chunk once it has loaded (the panel then draws without a loading line), else null. */
export function loadedTradeChunk(): Chunk | null {
  return loaded
}

/**
 * Loads the chunk and starts wallet discovery; at most one early discovery waits at a time, and
 * none while a panel is open (the panel's next look would take it instead of discovering afresh).
 */
export function prefetchTrade(): void {
  loadTradeChunk().then(
    (m) => {
      if (openPanels === 0) early ??= m.discoverWallets()
    },
    // A chunk that cannot load is reported when the reader opens the panel.
    () => undefined,
  )
}

/** The panel's `discover`: the discovery started on intent, once, else a fresh one. */
export function discoverForPanel(): Promise<Found> {
  const ready = early
  early = null
  return ready ?? loadTradeChunk().then((m) => m.discoverWallets())
}

/** Marks a panel open until the returned function is called (the trade row's effect). */
export function markPanelOpen(): () => void {
  openPanels++
  return () => {
    openPanels--
  }
}

/** What the trade section hands the panel (its `deps`). */
export const PANEL_DEPS = { discover: discoverForPanel }

/** Hover, press and focus handlers that warm the panel, for a control that leads to it. */
export const WARM_ON_INTENT = {
  onPointerEnter: prefetchTrade,
  onPointerDown: prefetchTrade,
  onFocus: prefetchTrade,
} as const

/** True when the reader asked the browser to save data. */
function savesData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  return nav.connection?.saveData === true
}

/** Warms the panel once `ref`'s element comes within one viewport of the screen. */
export function useWarmNearViewport(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined' || savesData()) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        observer.disconnect()
        prefetchTrade()
      },
      { rootMargin: '100% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
}

interface OpenRequest {
  poolId: string
  /** From the keyboard (or script): no smooth scroll (§4, keyboard actions never animate). */
  instant: boolean
}

const OPEN = 'open'
const requests = new EventTarget()

/** Asks the trade section of `poolId` to come into view and open (the title's "Swap"). */
export function requestTradeOpen(poolId: string, instant: boolean): void {
  requests.dispatchEvent(new CustomEvent<OpenRequest>(OPEN, { detail: { poolId, instant } }))
}

/** Hands the open requests for `poolId` to `open`; returns the unsubscribe. */
export function onTradeOpen(poolId: string, open: (instant: boolean) => void): () => void {
  const listener = (event: Event) => {
    const { detail } = event as CustomEvent<OpenRequest>
    if (detail.poolId === poolId) open(detail.instant)
  }
  requests.addEventListener(OPEN, listener)
  return () => requests.removeEventListener(OPEN, listener)
}

/**
 * Calls `done` once the page has stopped scrolling: three still frames after it moved, six when
 * it never moved (there was nothing to scroll), and after one second at the latest.
 */
export function whenScrollSettles(done: () => void): void {
  const start = performance.now()
  let last = window.scrollY
  let moved = false
  let still = 0
  const frame = () => {
    const y = window.scrollY
    if (y !== last) {
      moved = true
      still = 0
      last = y
    } else still++
    if (still >= (moved ? 3 : 6) || performance.now() - start > 1000) done()
    else requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
