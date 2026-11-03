/**
 * "trade in this pool" (DESIGN.md, "Dashboard (apps/web)"), the row under cost to trade when
 * `tradeGate` allows it. Before the reader asks, it repeats what the snapshot measured, with its
 * time, and offers "Swap in this pool". The panel (wallet discovery, viem, the Builder Code) is a
 * lazy chunk loaded on that click, inside Suspense and an error boundary that asks for a reload
 * when the chunk cannot load (an old tab after a deploy). Focus goes to the loading line, then to
 * the panel's first heading, or to Reload when the chunk fails: the button that had it is gone.
 * Nothing wallet-related is in this file.
 */
import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { useApiContext } from '../../api/context.js'
import type { PoolDetail } from '../../api/types.js'
import { PartErrorBoundary } from '../../components/ErrorBoundary.js'
import { Button } from '../../components/ui/Button.js'
import { Section } from '../../components/ui/Section.js'
import { bps, full, NB, SPREAD_UNABSORBED_BPS, usd } from '../../lib/format.js'
import { tradeGate } from './tradeGate.js'

const TradePanel = lazy(() => import('../../trade/TradePanel.js'))

/** The snapshot's round trip the section quotes before any live price. */
const QUOTED_NOTIONAL_USD = 10_000

const PERCENT = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 })

/**
 * "At 21 Oct, 04:00 UTC a $10K round trip here cost 0.024 % (2.4 bps)." from the latest
 * snapshot: in percent like the panel's impact, fee and slippage, with the bps of cost to trade.
 */
export function tradeTakeaway(detail: PoolDetail): string {
  const latest = detail.latest
  const spread = latest?.spreads.find((s) => s.notionalUsd === QUOTED_NOTIONAL_USD)
  const value = spread?.feasible ? spread.spreadBps : null
  if (!latest || value === null || value === undefined || value >= SPREAD_UNABSORBED_BPS)
    return `The latest snapshot measured no ${usd(QUOTED_NOTIONAL_USD)} round trip here.`
  const percent = `${PERCENT.format(value / 100)}${NB}%`
  return `At ${full(latest.timestamp)} a ${usd(QUOTED_NOTIONAL_USD)} round trip here cost ${percent} (${bps(value)}).`
}

/**
 * Focus on an element as it appears (`tabIndex={-1}` when it is not focusable itself), in the
 * commit that draws it.
 */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  useLayoutEffect(() => {
    ref.current?.focus()
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

export function TradeSection({ detail }: { detail: PoolDetail }) {
  const ctx = useApiContext()
  const [open, setOpen] = useState(false)
  const gate = tradeGate(detail, ctx)
  if (!gate) return null
  return (
    <Section id="s-trade" title="trade in this pool" takeaway={tradeTakeaway(detail)}>
      {open ? (
        <PartErrorBoundary fallback={<LoadError />}>
          <Suspense fallback={<Loading />}>
            <TradePanel detail={detail} venue={gate.venue} flagsAtLoad={gate.flags} />
          </Suspense>
        </PartErrorBoundary>
      ) : (
        <>
          <p className="muted">
            Swap in this pool from your own wallet: you review and sign each step, and the swap goes
            straight to the DEX’s own contract. Depthwatch takes no fee. Live prices are read
            through your wallet once you connect it.
          </p>
          <div>
            <Button variant="primary" onClick={() => setOpen(true)}>
              Swap in this pool
            </Button>
          </div>
        </>
      )}
    </Section>
  )
}
