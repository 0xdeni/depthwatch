/**
 * "trade in this pool" (DESIGN.md, "Dashboard (apps/web)"), the row under cost to trade when
 * `tradeGate` allows it, and the title's "Swap" that leads to it. Before the reader asks, the row
 * repeats what the snapshot measured, labelled as the snapshot's and not live, with three short
 * facts about the swap and "Swap in this pool". The panel (wallet discovery, viem, the Builder
 * Code) is a lazy chunk inside Suspense and an error boundary that asks for a reload when the chunk
 * cannot load (an old tab after a deploy); intent warms it (`tradeIntent.ts`), and once loaded it
 * draws without a loading line. Opening keeps the row's resting height, so the page below does
 * not jump while the panel loads. Focus goes to the loading line, then to the panel's first
 * heading, or to Reload when the chunk fails: the button that had it is gone. Nothing
 * wallet-related is in this file.
 */
import {
  type ComponentProps,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useApiContext } from '../../api/context.js'
import { usePool } from '../../api/hooks.js'
import type { PoolDetail } from '../../api/types.js'
import { PartErrorBoundary } from '../../components/ErrorBoundary.js'
import { Button } from '../../components/ui/Button.js'
import { Section } from '../../components/ui/Section.js'
import { full, roundTripCost, usd } from '../../lib/format.js'
import { isKeyboardClick, prefersReducedMotion } from '../../lib/motion.js'
import { tradeGate } from './tradeGate.js'
import {
  loadedTradeChunk,
  loadTradeChunk,
  onTradeOpen,
  PANEL_DEPS,
  requestTradeOpen,
  type TradeChunk,
  useWarmNearViewport,
  WARM_ON_INTENT,
  whenScrollSettles,
} from './tradeIntent.js'

const LazyPanel = lazy(() => loadTradeChunk().then((m) => ({ default: m.TradePanel })))

/** The snapshot's round trip the section quotes before any live price. */
const QUOTED_NOTIONAL_USD = 10_000

/**
 * "Snapshot of 21 Oct, 04:00 UTC, not live: a $10K round trip here cost 0.15 %, about $15 (14.8
 * bps)." from the latest snapshot: said to be the snapshot's, since the live quote follows it.
 */
export function tradeTakeaway(detail: PoolDetail): string {
  const latest = detail.latest
  const spread = latest?.spreads.find((s) => s.notionalUsd === QUOTED_NOTIONAL_USD)
  const cost = spread?.feasible ? roundTripCost(spread.spreadBps, QUOTED_NOTIONAL_USD) : null
  if (!latest || !cost)
    return `The latest snapshot measured no ${usd(QUOTED_NOTIONAL_USD)} round trip here.`
  return `Snapshot of ${full(latest.timestamp)}, not live: a ${usd(QUOTED_NOTIONAL_USD)} round trip here cost ${cost.text}.`
}

/**
 * Focus on an element as it appears (`tabIndex={-1}` when it is not focusable itself), in the
 * commit that draws it, without scrolling: it takes the place of the control that had focus.
 */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return ref
}

function Loading() {
  const ref = useFocusOnMount<HTMLParagraphElement>()
  return (
    <p className="muted" role="status" tabIndex={-1} ref={ref}>
      Loading the swap panel…
    </p>
  )
}

function LoadError() {
  const ref = useFocusOnMount<HTMLButtonElement>()
  return (
    <div className="sec-error" role="alert">
      <span>The swap panel could not load. Reload the page to trade.</span>
      <Button size="sm" ref={ref} onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  )
}

type PanelProps = Omit<ComponentProps<TradeChunk['TradePanel']>, 'deps'>

/** The panel, drawn at once when intent already loaded its chunk, else through Suspense. */
function Panel(props: PanelProps) {
  const ready = loadedTradeChunk()
  if (ready) return <ready.TradePanel {...props} deps={PANEL_DEPS} />
  return <LazyPanel {...props} deps={PANEL_DEPS} />
}

/** Focus into an open panel: its step heading, else its first control. */
function focusInside(slot: HTMLElement): void {
  const target =
    slot.querySelector<HTMLElement>('[tabindex="-1"]') ??
    slot.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]')
  target?.focus({ preventScroll: true })
}

/** The three facts before the panel opens: custody, where the swap goes, where prices come from. */
function TradeFacts() {
  return (
    <ul className="pool-trade-facts">
      <li>
        <b>Non-custodial:</b> you swap from your own wallet and sign each step.
      </li>
      <li>
        <b>Direct:</b> the swap goes to the DEX’s own contract; Depthwatch adds no fee.
      </li>
      <li>
        <b>Live prices:</b> read through your wallet once you connect it.
      </li>
    </ul>
  )
}

function TradeRow({ detail, gate }: { detail: PoolDetail; gate: NonNullable<Gate> }) {
  const [open, setOpen] = useState(false)
  // The row's height at rest, kept while the panel loads and draws its first step.
  const [rest, setRest] = useState(0)
  const slot = useRef<HTMLDivElement | null>(null)
  const isOpen = useRef(open)
  isOpen.current = open
  useWarmNearViewport(slot)

  const openPanel = useCallback(() => {
    if (isOpen.current) return
    setRest(slot.current?.getBoundingClientRect().height ?? 0)
    setOpen(true)
  }, [])

  // The title's "Swap": bring the row into view (smoothly for a pointer, unless reduced motion is
  // asked for), then open the panel, or move focus into it when it is already open. The panel
  // opens once the scroll has settled, so its focus lands on a heading already in view. The
  // button's own hover, press or focus has already warmed the panel.
  const id = detail.pool.id
  useEffect(
    () =>
      onTradeOpen(id, (instant) => {
        const el = slot.current
        const section = el?.closest('section')
        if (!el || !section) return
        const smooth = !instant && !prefersReducedMotion()
        section.scrollIntoView?.({ block: 'start', behavior: smooth ? 'smooth' : 'auto' })
        const enter = () => (isOpen.current ? focusInside(el) : openPanel())
        if (smooth) whenScrollSettles(enter)
        else enter()
      }),
    [id, openPanel],
  )

  return (
    <Section id="s-trade" title="trade in this pool" takeaway={tradeTakeaway(detail)}>
      <div
        className="pool-trade"
        ref={slot}
        style={open && rest > 0 ? { minHeight: rest } : undefined}
      >
        {open ? (
          <PartErrorBoundary fallback={<LoadError />}>
            <Suspense fallback={<Loading />}>
              <Panel detail={detail} venue={gate.venue} flagsAtLoad={gate.flags} />
            </Suspense>
          </PartErrorBoundary>
        ) : (
          <>
            <TradeFacts />
            <div>
              <Button variant="primary" {...WARM_ON_INTENT} onClick={openPanel}>
                Swap in this pool
              </Button>
            </div>
          </>
        )}
      </div>
    </Section>
  )
}

type Gate = ReturnType<typeof tradeGate>

export function TradeSection({ detail }: { detail: PoolDetail }) {
  const ctx = useApiContext()
  const gate = tradeGate(detail, ctx)
  if (!gate) return null
  return <TradeRow detail={detail} gate={gate} />
}

/**
 * "Swap" on the title's price line (docs/design/visual-v4.md §6.4), only where the trade row is
 * shown: the same gate, on the same cached pool. It brings "trade in this pool" into view, opens
 * the panel and moves focus into it; hovering, pressing or focusing it warms the panel.
 */
export function SwapShortcut({ poolId }: { poolId: string }) {
  const ctx = useApiContext()
  const detail = usePool(poolId).data
  if (!detail || !tradeGate(detail, ctx)) return null
  return (
    <Button
      variant="primary"
      size="sm"
      className="pool-swap"
      {...WARM_ON_INTENT}
      onClick={(e) => requestTradeOpen(poolId, isKeyboardClick(e))}
    >
      Swap
    </Button>
  )
}
