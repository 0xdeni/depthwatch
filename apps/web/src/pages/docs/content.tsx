/**
 * Methodology's copy (ia-v3 §4.8, docs/design/visual-v4.md §6.9): the metric blocks and one
 * section per anchor, each a plain explanation of at most 150 words (in the fixed vocabulary of
 * principles CP9, without "we"), an optional schematic and the exact formula from
 * docs/METRICS.md and docs/SCORECARDS.md, then the USD price convention the dollar figures rest
 * on. Section titles are lowercase words (acronyms and symbols keep their case). Formulas use only
 * glyphs the self-hosted mono subset carries (no √, Σ or ∈).
 */
import { GAP_FEED_MIN_VOLUME_USD, SPREAD_NOTIONALS_USD } from '@depthwatch/core'
import type { ReactNode } from 'react'
import { NB, usd } from '../../lib/format.js'
import { DepthSchematic, KpiSchematic, PersistenceSchematic } from './figures.js'
import { GapScale, HealthFigure } from './scales.js'

export interface MetricSection {
  id: string
  /** The "On this page" label; lowercased, the metric block's heading. */
  short: string
  /** The index definition: one line (ia-v3 §4.8). */
  definition: string
  title: string
  body: ReactNode
  figure?: ReactNode
  /** The exact definition, behind "Show formula" (L2). */
  formula: string
}

const u = (n: number | string, unit: string) => `${n}${NB}${unit}`

/** "$1K, $10K, $100K or $1M": core's spread notionals as a list in words. */
function notionals(last: 'or' | 'and'): string {
  const all = SPREAD_NOTIONALS_USD.map((n) => usd(n))
  return all.length < 2 ? all.join('') : `${all.slice(0, -1).join(', ')} ${last} ${all.at(-1)}`
}

export const SECTIONS: readonly MetricSection[] = [
  {
    id: 'depth',
    short: 'Depth',
    definition: `Dollars it takes to move the price 1, 2 or ${u(5, '%')}, on each side.`,
    title: `depth at ±1, 2 and ${u(5, '%')}`,
    body: (
      <>
        <p>
          {`Depth answers one question: how many dollars does it take to move a pool’s price by 1, 2 or ${u(5, '%')}? Each reading simulates the swap on the pool’s real state, tick by tick with the contract’s own rounding, once in each direction.`}
        </p>
        <p>
          {`The buy side is the money spent buying the first token to lift the price; the sell side is the first token sold to push it down. Both sides added at ±${u(2, '%')} give the headline number used for sorting and scoring. A stretch with no liquidity costs nothing to cross, as it does onchain, so when the ±${u(5, '%')} amount equals the ±${u(2, '%')} amount, nothing sits between the two prices. When the target lies past the liquidity the snapshot read, the side is marked “Liquidity runs out”, and the amount is what it took to get that far.`}
        </p>
        <p>
          {`A pool whose own price sits ${u(5, '%')} or more from the price its tokens’ dollar prices imply is marked “Stale price”: its depth is measured at a price nobody trades, so it stays out of the totals and sorts last by depth. A pool of a tokenized stock whose transfers are paused stays out of the totals too: every swap in it reverts. A pool with a swap hook Depthwatch does not model (a Uniswap v4 pool with a hook, or an Aero Slipstream pool off its reviewed hook) runs that code on every swap, so its depth and spread are not modelled at all.`}
        </p>
      </>
    ),
    figure: <DepthSchematic />,
    formula: [
      'up       = simulateSwapToPrice(state, mid × (1 + p/100))   input token1, buy side',
      'down     = simulateSwapToPrice(state, mid × (1 − p/100))   input token0, sell side',
      'upUsd    = human(up.amountIn) × token1Usd',
      'downUsd  = human(down.amountIn) × token0Usd',
      'totalUsd = upUsd + downUsd                                for p in {1, 2, 5}',
    ].join('\n'),
  },
  {
    id: 'spread',
    short: 'Spread',
    definition: `What a round trip of ${notionals('or')} costs, fees included.`,
    title: 'effective spread',
    body: (
      <>
        <p>
          {`Effective spread is what a round trip costs: buy N dollars of the first token, sell N dollars of it back, and compare the two average prices with the mid price. The swap fee and price impact are both included (the LP fee, plus on Uniswap v4 the protocol fee, which the fee shown for a pool does not include), so even an infinitely deep pool shows about twice its swap fee. It is measured at ${notionals('and')}, because the cheapest pool for a small trade is often not the cheapest for a large one; the spread at $10K is the headline. If either leg cannot be filled from known liquidity, or one leg pays more than half of its value in price impact, the pool can’t absorb that trade and shows no spread. A spread that is shown is therefore never above 10,000 bps.`}
        </p>
        <p>
          {`The fee of every Slipstream pool, Aerodrome or Aero, is read at each snapshot: it can change from one block to the next, and an Aero Slipstream pool’s swap hook sets it every block, up to its cap. The fee shown and used is the one read at the latest snapshot (for a pool not snapshotted yet, the one read at discovery), marked “dynamic”, so a spread can move with the fee alone.`}
        </p>
      </>
    ),
    formula: [
      'buyAvg    = N of token1 in / token0 out',
      'sellAvg   = token1 out / N of token0 in',
      `spreadBps = (buyAvg − sellAvg) / mid × 10 000      for N in {${SPREAD_NOTIONALS_USD.map((n) => usd(n)).join(', ')}}`,
      '            = (buyAvg / mid − 1) + (1 − sellAvg / mid), each leg at most 50 %',
    ].join('\n'),
  },
  {
    id: 'concentration',
    short: 'Concentration',
    definition: 'How much of the liquidity near the price one LP or one range holds.',
    title: 'LP concentration',
    body: (
      <p>
        {`Concentration asks whether the depth is many independent positions or one that can be pulled in a single transaction. Inside ±${u(5, '%')} of the price, every tick range is weighted by the liquidity it holds: the range HHI is 1 when everything sits in one range. When positions are indexed, they are also grouped by owner, which gives the top LP’s share, the top three’s share and an owner HHI, and the coverage: how much of the pool’s liquidity near the price those owners account for. A Slipstream gauge, Aerodrome’s or Aero’s, holds staked positions for their depositors, so it is not counted as an owner. Aerodrome v2 and Aero v2 pools are one full-range position by construction.`}
      </p>
    ),
    formula: [
      `weight_i = L_i × (sqrt(P_upper) − sqrt(P_lower)), clipped to mid × (1 ± ${u(5, '%')})`,
      'share_i  = weight_i / sum of all weights',
      'rangeHhi = sum of share_i²',
      'owners   : top1Share = the largest share, top3Share = the three largest,',
      '           ownerHhi = sum of each owner’s share²',
      'coverage = the owners’ weight / the pool’s weight, 0..1',
    ].join('\n'),
  },
  {
    id: 'persistence',
    short: 'Persistence',
    definition: 'Whether the depth is still there from one snapshot to the next.',
    title: 'persistence',
    body: (
      <p>
        {`A pool that is deep at snapshot time but empty a tenth of the day is not deep. Persistence looks at every snapshot of the last ${u(24, 'h')} and ${u(7, 'd')}: stability compares the worst tenth of readings with a normal one, and uptime counts how often the pool held at least half its usual depth. Both are unknown, and the health score treats them as neutral, until there are three snapshots that span at least a quarter of the window. A pool with no depth at all scores zero for it.`}
      </p>
    ),
    figure: <PersistenceSchematic />,
    formula: [
      `samples   = depth2Usd of the snapshots in (now − W, now], for W in {${u(24, 'h')}, ${u(7, 'd')}}`,
      'stability = clamp(p10 / median, 0, 1)',
      'uptime    = share of samples with depth ≥ 0.5 × median',
      '            (both null below 3 samples, or when the samples span under a quarter of W;',
      '             both 0 when the median is 0)',
    ].join('\n'),
  },
  {
    id: 'health',
    short: 'Health',
    definition:
      'One score from 0 to 100, and a grade from A to F for pools deep enough to be rated.',
    title: 'health and grades',
    body: (
      <>
        <p>
          The health score is one number from 0 to 100, so that thousands of pools can be ranked.
          Its four parts are shown on every pool page, so nobody has to trust the total: depth is
          worth up to 35 points, spread 25, concentration 20 and persistence 20. Where money is
          involved, the scale is logarithmic. Depth counts twice the thinner of the two sides, so a
          pool with all its money on one side earns nothing for it. Unknown depth or a spread the
          pool can’t absorb scores 0; unknown concentration or persistence scores the neutral
          midpoint, with a note.
        </p>
        <p>
          {`Concentration counts the largest LP’s share only when the indexed owners cover at least ${u(90, '%')} of the liquidity near the price; otherwise a concentrated pool is scored from how its liquidity spreads over price ranges, and an Aerodrome v2 or Aero v2 pool, one full range by construction, scores the neutral 10. Where a list’s grades do not all rest on LP owners, an info button at its Health column says what most of them rest on, and a star marks each grade that rests on something else; a pool’s page names any basis other than LP owners under its score.`}
        </p>
        <p>
          {`A grade only means something where there is liquidity to grade. A pool is rated when both sides within ±${u(2, '%')} are known and the thinner one holds at least $5K. Any other pool shows “Not rated” instead of a letter, with the reason: too thin to rate, too thin on one side, no USD price, a hooked pool that is not modelled, or transfers paused, a tokenized stock’s pool in which every swap reverts. It keeps its score and its four parts, and stays in every list; the median health on Home and in the stats counts rated pools only.`}
        </p>
      </>
    ),
    figure: <HealthFigure />,
    formula: [
      'depth          35 × clamp((log10(2 × min(up, down)) − 3) / 3, 0, 1)',
      '               $500 on each side scores 0, $500K on each side scores 35',
      'spread         25 × clamp(log10(300 / spread10kBps) / log10 30, 0, 1)',
      '               300 bps scores 0, 10 bps scores 25',
      'concentration  20 × (1 − top1Share) when owners cover ≥ 90 % of the band,',
      '               else 20 × (1 − rangeHhi) (concentrated pools), else 10',
      `persistence    20 × (0.5 × stability + 0.5 × uptime) over ${u(24, 'h')}, else 10`,
      'rated          both sides known and min(up, down) ≥ $5K',
      'grade          rated pools only: A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F',
    ].join('\n'),
  },
  {
    id: 'gaps',
    short: 'Gaps',
    definition: 'Pools that trade far more each day than the liquidity near their price.',
    title: 'gap score',
    body: (
      <p>
        {`A gap is a pool where a day’s trading is many times the money sitting near its price: real demand, thin liquidity. Turnover is the day’s volume over the depth ±${u(2, '%')}; the gap score maps 1× to 0, 10× to 50 and 100× or more to 100. It ranks turnover, not fee income: what that volume pays liquidity providers also depends on the pool’s fee tier, so a low-fee pool full of arbitrage can top the list while earning less than one further down. The gaps list only includes pools with at least ${usd(GAP_FEED_MIN_VOLUME_USD)} of ${u(24, 'h')} volume, so dust pools with a single trade stay out.`}
      </p>
    ),
    figure: <GapScale />,
    formula: [
      'turnover = volume24hUsd / depth2Usd',
      'gapScore = 100 × clamp(log10(turnover) / 2, 0, 1)',
      `feed     = pools with volume24hUsd ≥ $${GAP_FEED_MIN_VOLUME_USD.toLocaleString('en-US')}, by gapScore`,
    ].join('\n'),
  },
  {
    id: 'scorecards',
    short: 'Scorecards',
    definition: 'A market maker’s promised depth, checked at every snapshot.',
    title: 'market-maker scorecards and uptime',
    body: (
      <>
        <p>
          {`A scorecard is a market-making mandate, measured: “keep at least $50K within ±${u(2, '%')} on each side, ${u(95, '%')} of the time”. A project registers a mandate naming the pool, the market maker’s addresses and the KPIs. At every snapshot the pool is rebuilt with only the liquidity those addresses own (their positions, gauge-staked positions resolved to the depositor, or their share of the LP supply), and depth and spread are measured on it with the same code as above.`}
        </p>
        <p>
          {`Each sample is within KPI or breached; a sample with a missing USD price counts on neither side. Uptime is the share of evaluable samples within KPI over ${u(24, 'h')}, ${u(7, 'd')} and ${u(30, 'd')}. The agreed target uptime is shown for comparison and never decides the status.`}
        </p>
      </>
    ),
    figure: <KpiSchematic />,
    formula: [
      'breached  if depthUpUsd < minDepthUsd or depthDownUsd < minDepthUsd',
      '          or spreadBps > maxSpreadBps (or the pool can’t absorb the trade)',
      '          or no holdings were found',
      'uptime(W) = within KPI / evaluable samples in (now − W, now]',
      `            for W in {${u(24, 'h')}, ${u(7, 'd')}, ${u(30, 'd')}}`,
      'status    = inactive, else no data, else breached (latest sample), else within KPI',
    ].join('\n'),
  },
]

/**
 * The convention under every dollar figure (docs/METRICS.md, USD prices): a section after the
 * metrics, listed in "On this page" but not a metric block.
 */
export const PRICES: MetricSection = {
  id: 'usd-prices',
  short: 'USD prices',
  definition: 'Dollar values read from the pools, from stablecoins taken at $1.',
  title: 'USD prices',
  body: (
    <p>
      {`Every dollar figure comes from the pools themselves. Four stablecoins are the anchors: USDC, USDbC, DAI and USDT count as $1 by convention, whatever their own pools say. Every other token is priced through pools, along the route from an anchor whose weakest pool is the deepest, where a pool counts with the thinner of its two sides within ±${u(2, '%')}, both in dollars as the route reaches it. A pool with a swap hook Depthwatch does not model is no route. Native ETH is tied to WETH one for one. Aerodrome moved to a new platform, Aero, on 21 October 2026: Aerodrome’s AERO and Aero’s AERO are two tokens with one symbol, each priced from its own pools, with no peg between them. A token that no route reaches has no USD price, and every dollar figure that needs it is unknown. This is a valuation convention for depth and volume, not an oracle: a stablecoin trading slightly off its peg still counts as $1.`}
    </p>
  ),
  formula: [
    'anchors = USDC, USDbC, DAI and USDT at $1, by convention',
    'edge    = a pool with a usable mid, at its price (token1 per token0), no unmodelled hook',
    `weight  = min(up × token1Usd, down × token0Usd) at ±${u(2, '%')}, the thinner side`,
    '          the settled token at its USD price, the other at the price the pool implies',
    'route   = from an anchor, the path whose weakest edge weighs the most',
    'usd     = the anchor’s $1 times the pool prices along the route',
  ].join('\n'),
}

/** The closing section (ia-v3 §4.8 "End"). */
export const REPRODUCE = {
  id: 'reproduce',
  short: 'Reproduce any number',
  title: 'reproduce any number',
} as const

/** Every anchor on the page, in order, for "On this page". */
export const OUTLINE: ReadonlyArray<{ id: string; label: string }> = [
  ...SECTIONS.map((s) => ({ id: s.id, label: s.short })),
  { id: PRICES.id, label: PRICES.short },
  { id: REPRODUCE.id, label: REPRODUCE.short },
]
