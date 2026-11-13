/**
 * The Pool title section (docs/design/visual-v4.md §6.4): the back link to Pools, the eyebrow
 * ("UNISWAP V3   0.05 % FEE"), then a two-column grid from 1024 px. At left the pair as the h1,
 * each symbol linking to its token page, with a no-break space before the slash so a title that
 * wraps breaks after "WETH /" and no line starts with the slash; under it the price line
 * "1 WETH = 2,329.96 USDC" with a quiet text toggle, "Show price in WETH", that flips it (N2),
 * and, where the trade row is shown, the "Swap" button that leads to it (`SwapShortcut`); at
 * right, bottom-aligned, the answer sentence. The toggle is words, not the swap glyph, so nothing
 * beside the price looks like a second swap button. The line starts from the pool's base token
 * (`lib/orient.ts`), so a price below 1 ("1 USDC = 0.7576 AERO") only shows behind the toggle.
 * Only the characters that change settle in (§4.3); a keyboard flip swaps instantly. The price and
 * the toggle keep the width of their longer direction, so a flip moves nothing on the line or
 * below it. The title and the answer rise with the first view, the rest fades in (`data-in`).
 */
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PoolMetaDto } from '../../api/types.js'
import { BackLink } from '../../components/ui/BackLink.js'
import { StaleQuoteChip } from '../../components/ui/PoolCells.js'
import { TextChange } from '../../components/ui/TextChange.js'
import { dexLabel, feeText, NB, price, tokenHref, tokenText } from '../../lib/format.js'
import { isKeyboardClick } from '../../lib/motion.js'
import { baseQuote } from '../../lib/orient.js'
import { SwapShortcut } from './TradeSection.js'

function priceLine(base: string, quote: string, v: number): string {
  return `1${NB}${base} = ${price(v)}${NB}${quote}`
}

function PriceLine({ pool, spot }: { pool: PoolMetaDto; spot: number | null }) {
  const [inverse, setInverse] = useState(false)
  const [animate, setAnimate] = useState(true)
  const t0 = tokenText(pool.token0)
  const t1 = tokenText(pool.token1)
  // The default line reads from the base token; the toggle shows the other direction.
  const { inverted } = baseQuote(pool, spot)
  const flip = inverse !== inverted
  const ok = spot !== null && spot > 0
  const lines: readonly [string, string] | null = ok
    ? [priceLine(t0, t1, spot), priceLine(t1, t0, 1 / spot)]
    : null
  // The price sits over hidden copies of both directions, the toggle over a copy of the other
  // direction's words, so the line is as wide either way (and while the price settles in) and
  // keeps its wrap, and the toggle its place, when it flips.
  return (
    <p className="pool-line" data-in="">
      {lines === null ? null : (
        <>
          <span className="pool-hold">
            <span className="num is-ghost" aria-hidden="true">
              {lines[0]}
            </span>
            <span className="num is-ghost" aria-hidden="true">
              {lines[1]}
            </span>
            <TextChange
              className="num pool-price"
              value={flip ? lines[1] : lines[0]}
              animate={animate}
            />
          </span>
          <button
            type="button"
            className="plink pool-flip pool-hold touch-hit"
            onClick={(e) => {
              setAnimate(!isKeyboardClick(e))
              setInverse((v) => !v)
            }}
          >
            <span>Show price in {flip ? t1 : t0}</span>
            <span className="is-ghost" aria-hidden="true">
              Show price in {flip ? t0 : t1}
            </span>
          </button>
        </>
      )}
      <SwapShortcut poolId={pool.id} />
    </p>
  )
}

export function PoolTitle({
  pool,
  spot,
  answer,
  staleDeviationBps,
}: {
  pool: PoolMetaDto
  spot: number | null
  /** The answer sentence, or its skeleton while the pool loads. */
  answer: ReactNode
  /** The price deviation of a stale quote: the eyebrow then carries the "Stale price" chip. */
  staleDeviationBps?: number | null
}) {
  return (
    <section className="wrap ttl pool-ttl" aria-labelledby="pool-title">
      <div data-in="">
        <BackLink to="/pools" label="Pools" />
      </div>
      <p className="eyebrow eb-row pool-eb" data-in="">
        <span>{dexLabel(pool.dex)}</span> <span>{feeText(pool)} fee</span>
        {pool.stable ? (
          <>
            {' '}
            <span>Stable pair</span>
          </>
        ) : null}
        {staleDeviationBps !== undefined ? (
          <>
            {' '}
            <StaleQuoteChip deviationBps={staleDeviationBps} />
          </>
        ) : null}
      </p>
      <div className="ttl-grid">
        <div className="pool-ttl-main">
          <h1 className="title pool-title" id="pool-title" data-rise="">
            <Link className="pool-tok" to={tokenHref(pool.token0.address)}>
              {tokenText(pool.token0)}
            </Link>
            {`${NB}/ `}
            <Link className="pool-tok" to={tokenHref(pool.token1.address)}>
              {tokenText(pool.token1)}
            </Link>
          </h1>
          <PriceLine pool={pool} spot={spot} />
        </div>
        {answer}
      </div>
    </section>
  )
}
