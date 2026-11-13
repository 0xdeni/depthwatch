# Metric definitions

This page is the single definition of every number Depthwatch publishes. Each metric is
implemented once, in `packages/core`, and `packages/core/src/metrics/workedExamples.test.ts` (the
health score's in `workedExamples.health.test.ts`, the effective spread's in
`workedExamples.spread.test.ts`, the swap checks' in
`packages/core/src/trade/workedExamples.test.ts`, the stock metrics' in
`packages/core/src/stocks/workedExamples.test.ts`) reproduces the worked examples below to the digit
(raw amounts to the wei, USD and bps figures to the two decimals printed here). If the dashboard,
the API and this page ever disagree, this page and the core tests are what gets fixed first.

## Conventions

- **Addresses** are lowercase `0x…` strings. Native ETH (Uniswap v4 `currency0 == address(0)`) is
  `0x0000000000000000000000000000000000000000` with symbol `ETH` and 18 decimals.
- **Price orientation.** `price` always means token1 per token0, decimal adjusted. For a
  concentrated pool, `priceRaw = (sqrtPriceX96 / 2^96)^2` is token1 raw units per token0 raw unit
  and `price = priceRaw × 10^(decimals0 − decimals1)`. Example: in the WETH/USDC pool on Base,
  WETH (18 decimals) is token0 and USDC (6 decimals) is token1 because its address sorts lower;
  at 2,500 USDC per WETH, `priceRaw = 2.5 × 10^-9` and `sqrtPriceX96 ≈ 3.9614 × 10^24`
  (`3961408125713216879677197`). "Price goes up" always means token0 gets more expensive in token1.
- **Mid price** (`mid`) is the pool's current marginal price: from `sqrtPriceX96` for concentrated
  pools; `reserve1 / reserve0` (decimal adjusted) for constant-product pools; the analytic
  `dy/dx` of `x³y + xy³` on 1e18-normalised reserves for stable pools.
- **Fees** are in pips (1e-6): 500 = 0.05 %, 3000 = 0.30 %. Aerodrome v2 and Aero v2 report basis
  points; they are multiplied by 100 when read. Every simulation takes the fee from the input
  amount before the price moves, as the contracts do.
- **Swap fee.** The fee a simulated swap pays is the pool's LP fee (`feePips`, the fee shown for
  the pool), except on Uniswap v4, where the PoolManager adds the protocol fee of the swap's
  direction: slot0's `protocolFee` packs 12 bits per direction (zeroForOne in the low bits,
  oneForZero in the high bits, each at most 1,000 pips) and the swap is charged `swapFee =
  protocolFee + lpFee − floor(protocolFee × lpFee / 1e6)` (`ProtocolFeeLibrary.calculateSwapFee`;
  `lpFee` alone when the protocol fee is 0). So a 500-pip pool with a 125-pip protocol fee charges
  625 pips, a 3,000-pip pool with 500 charges 3,499. Depth and spread use the swap fee; `feePips`
  stays the LP fee. Uniswap v3's and Slipstream's protocol shares are cut from the LP fee and do
  not change what a trader pays. A Uniswap v4 pool with a hook is not modelled at all (`hooked`,
  see [Rated and unrated pools](#rated-and-unrated-pools)).
- **The fee is read at the snapshot's block.** Each state read carries the pool's LP fee as the
  pool answers it at that block; depth and spread use that fee, the snapshot stores it
  (`PoolSnapshot.feePips`; `null` in snapshots stored before schema version 7), and the pool's
  `feePips` is the latest snapshot's (for a pool never snapshotted, the reading at discovery or
  seeding). For most pools it is a fixed tier. A Slipstream pool's
  `fee()`, Aerodrome or Aero, is a reading that can change from one block to the next
  (`hasDynamicFee`): on Aerodrome it asks the deployment's DynamicSwapFeeModule, on Aero the
  pool's swap hook, which fixes one fee per block at its first swap, `min(baseFee + dynamic part,
  feeCap)`, the dynamic part computed from the pool's time-weighted average tick over the last
  `secondsAgo` (600 s), with `feeCap` at most 50,000 pips (5 %). A volatile
  block's capped reading can therefore drive the latest spread and the grade. Over all 489 Aero
  Slipstream pools at block 53,213,030 the fee was 5 to 25,000 pips, median 1,965, 90th
  percentile 10,000. Not modelled: a different fee in a later block; the MEV tax that a
  transaction with a high priority fee pays on Aero (0 in an `eth_call`, and at or below a priority
  fee of 1 gwei on Aero v2 volatile pools, 2 gwei on stable ones); the per-caller discounts Aero's
  swap hook applies. The Slipstream unstaked fee is cut from unstaked LPs' income and does not
  change what a trader pays.
- **Aero v2 fee.** `getBaseFee(pool, 0x0, 0, 0, 0, 0)` on the pool's factory, × 100. The factory
  asks its fee module; the reviewed CustomFeeModule (docs/research/base-contracts.md, `## aero`)
  answers from the pool alone: its override, 0 for the 420 sentinel, or the factory's default (30
  bps volatile, 5 bps stable). A read that finds the factory's `feeModule()` changed fails that
  pool's snapshot ("fee module changed") rather than model a fee that may depend on the zeroed
  arguments.
- **Sides.** The **up** side is buy pressure on token0: the input is token1 and the price rises.
  The **down** side is sell pressure on token0: the input is token0 and the price falls. Depth
  and spread are reported for both sides; USD depth sums them, but the health score and the rating
  use the thinner side (see [Rated and unrated pools](#rated-and-unrated-pools)).
- **Raw and human amounts.** Simulation runs on raw `bigint` amounts in the token's smallest
  unit with the contracts' rounding (in the pool's favour). A human number appears only in the
  last step: `human = raw / 10^decimals`.
- **USD conversion.** A token's USD price is derived from the pools themselves (see
  [USD prices](#usd-prices)). If a token has no USD price, every USD metric that needs it is
  `null`. Nothing is estimated.
- **Band.** Concentration is computed inside ±5 % of mid (`CONCENTRATION_BAND_PCT = 5`). Pool state
  is read for at least ±10 % so the band is always inside known ticks; the band is clipped to the
  known tick range and never extrapolated.
- **Null semantics.** `null` means "not known", never "zero". A score component that needs an
  unknown input is scored 0 (depth, spread) or at the neutral midpoint with a note (concentration,
  persistence), as detailed under the health score. A pool whose depth is too thin, one-sided,
  unpriced or not modelled (a hooked pool) is not graded at all.
- **Levels.** Depth is computed at 1, 2 and 5 % (`DEPTH_LEVELS_PCT`); spread at $1,000, $10,000,
  $100,000 and $1,000,000 (`SPREAD_NOTIONALS_USD`). The ±2 % total and the $10k spread are the
  headline numbers used for sorting and scoring.

## Depth at ±p %

**Question.** How much capital does it take to move the price by p % in each direction?

**Definition.** With `mid` the current price:
- `up = simulateSwapToPrice(state, mid × (1 + p/100), decimals)`, input token1. `up.amountIn` is the token1
  required (gross, fee included); `up.amountOut` the token0 received on the way.
- `down = simulateSwapToPrice(state, mid × (1 − p/100), decimals)`, input token0. `down.amountIn` is the
  token0 required; `down.amountOut` the token1 received.
- `reached` is true when the simulated swap moves the price to the target. A stretch with no
  liquidity inside the known tick range is crossed at no cost, as the contract's swap step
  crosses it, so a target past it is reached with the amounts of the last price that had
  liquidity: a ±5 % amount equal to the ±2 % amount means nothing sits between the two prices.
  `reached` is false when the walk hit the edge of the known tick range before the target, or when
  the pool cannot move (see the edge cases below); the amounts are then the totals to that point,
  not the depth.

USD: `upUsd = human(up.amountIn) × token1Usd`, `downUsd = human(down.amountIn) × token0Usd`;
`totalUsd = upUsd + downUsd` when both are known, else whichever side is known, else `null`. A
side whose token has no USD price is `null`.

**Per pool kind.**
- Concentrated (Uniswap v3/v4, Slipstream): the Uniswap swap walk. Swap fee off the input, then
  within each tick range of liquidity L from √Pa to √Pb (Q64.96): `Δtoken1 = L × (√Pb − √Pa) /
  2^96` and `Δtoken0 = L × (√Pb − √Pa) × 2^96 / (√Pa × √Pb)`, input rounded up and output rounded
  down; `liquidityNet` applied at every initialised tick crossed. Steps stop exactly where the
  contract's do (the next initialised tick or the edge of the current 256-slot tick-bitmap
  word), so the amounts match onchain results to the wei. On Uniswap v4 the walk runs with the
  swap fee (LP fee combined with the direction's protocol fee): the same price move then needs
  `1e6 / (1e6 − swapFee)` times the net input, while the amount out is unchanged.
- Constant product (Aerodrome v2 volatile): closed form. The net input that moves `reserve1 /
  reserve0` to the target is `√(target × k) − reserve1` (up) or `√(k / target) − reserve0` (down)
  with `k = reserve0 × reserve1`, then grossed up for the fee.
- Stable swap (Aerodrome v2 stable): exact bisection over the gross input amount on the analytic
  marginal price `dy/dx = (3x²y + y³) / (x³ + 3xy²)` of the post-trade normalised reserves. The
  result is the smallest input (to 1 wei of the input token) whose post-trade marginal price
  passes the target; the contract's `_get_y` Newton solve itself converges to 1 wei of
  normalised units.

**Edge cases.** A pool with no usable mid (a reserve is zero) reports zero amounts with
`reached = false` on every level (`computeDepth`). The snapshot step stores nothing for such a
pool: a snapshot needs a price. It logs the pool as empty ("empty pool, not snapshotted") and
skips it without counting it as failed; only a pool requested with `--pool` or named by a
mandate gets there, since TVL ranking never selects an empty pool. `p` must lie in (0, 100).
Pools whose known tick range is narrower than the target move report `reached = false` rather
than a guess. A stable pool whose
reserves are too small for the contract's math (below ~1e-6 tokens the invariant's derivative
floors to 0 and the contract reverts, the state a drained pool is left in) and a concentrated pool
with a 100 % LP fee (Uniswap v4 `MAX_LP_FEE`, nothing can move the price) both report zero
amounts with `reached = false`.

**Worked example.** A constant-product WETH/USDC pool with 1,000 WETH and 2,500,000 USDC, fee
0.30 % (3000 pips), WETH = $2,500, USDC = $1. `mid = 2,500`.
- Up 2 %: target 2,550. Net input `√(2,550 × 2.5×10^9) − 2,500,000 = 24,876.23` USDC; grossed up
  for the fee: `24,876.23 / 0.997 = 24,951.09` USDC → `up.amountIn = 24951087854` (raw, 6
  decimals), `up.amountOut ≈ 9.8525` WETH, `upUsd = $24,951.09`.
- Down 2 %: target 2,450. Net input `√(2.5×10^9 / 2,450) − 1,000 = 10.1525` WETH; grossed up:
  `10.1831` WETH → `down.amountIn = 10183093833711884799` (raw, 18 decimals), `downUsd =
  10.1831 × 2,500 = $25,457.73`.
- `depth2Usd = totalUsd = $50,408.82`. At ±1 % the total is $25,138.86 and at ±5 % $127,064.77.

A second example used throughout the health score below: a USDC/WETH pool whose ±2 % depth is
$1.2M on each side, so `depth2Usd = $2.4M`.

**A token's depth.** `depth2UsdTotal` (`GET /api/tokens/:address`) is the sum of `depth2Usd` (the
score's, else the newest snapshot's, as the pool lists show it) over every scored pool containing
the token whose depth is known, whose quote is not stale (see [Stale quotes](#stale-quotes)) and
whose stock's transfers are not paused (see [Stock tradability](#stock-tradability)), whatever page
of the pools is listed; `depthKnownPools` counts those pools. A pool counts in full for each of its
two tokens. `null` when no such pool has a known depth (unknown is not 0).
Example: three WETH pools with `depth2Usd` $2.4M, $50,408.82 and `null` → `depth2UsdTotal =
$2,450,408.82`, `depthKnownPools = 2`; a fourth WETH pool with a stale quote changes neither.

### Stale quotes

**Question.** Is the pool's own price the market's?

Depth is measured at the pool's own mid. A pool whose price arbitrage has left behind holds
nothing on the side that would correct it, and still reports the depth of its other side, at a
price nobody trades. With `token0Usd` and `token1Usd` the derived USD prices (see
[USD prices](#usd-prices)):
- `priceDeviationBps = |price / (token0Usd / token1Usd) − 1| × 10,000`: how far the pool's price
  is from the price its tokens' USD prices imply. `null` when either token has no USD price.
- The quote is **stale** (`staleQuote`) when `priceDeviationBps ≥ 500`
  (`STALE_QUOTE_MIN_DEVIATION_BPS`, 5 %). A pool on a token's price route has a deviation of 0 by
  construction (the route's prices are its prices), so only a pool that is no route can be stale.

A stale pool's depth, spread and score are published as measured, since they describe the pool at
its own price. Its ±2 % depth is left out of the depth sums (`GET /api/stats`, the Home
headline, a token's `depth2UsdTotal`, the depth butterfly's totals, segments and shares, where
its row is still drawn) and so are the counts of pools those sums cover (`depthKnownPools`), a
depth sort puts it after the other pools in both directions, and the lists and the pool page flag
it. A snapshot stored before the deviation was recorded reads `null` (not known),
so its pool is not flagged until the next snapshot.

**Worked example** (the live run at Base block 53,069,244). The Uniswap v3 BRETT/USDC 0.3 % pool
quoted 17.962 USDC per BRETT while the price graph priced BRETT at $0.004652 and USDC at $1:
`|17.962 / 0.004652 − 1| × 10,000 ≈ 3.86 × 10^7` bps, a stale quote. Its $32,059 of ±2 % depth,
all on the up side, is no longer counted in the depth totals.

## Effective spread at N USD

**Question.** What does a round trip of N dollars cost, fees and price impact included?

**Notionals.** $1,000, $10,000, $100,000 and $1,000,000 (`SPREAD_NOTIONALS_USD`). The ladder runs
to $1M because the cheapest pool for a small trade is often not the cheapest for a large one (see
the last worked example below). The $1M legs walk the same ticks as the others, the ones the
snapshot already read; a leg that would move a concentrated pool's price past them is incomplete,
so that point is infeasible rather than extrapolated. Snapshots stored before the $1,000,000 point
was added carry the first three points and are not rewritten.

**Definition.** For each notional N:
- Buy leg: `amount1In = raw(N / token1Usd)` of token1, `simulateSwapExactIn(state, 'oneForZero',
  amount1In)`; `buyAvg = human(amount1In) / human(amount0Out)`.
- Sell leg: `amount0In = raw(N / token0Usd)` of token0, `simulateSwapExactIn(state, 'zeroForOne',
  amount0In)`; `sellAvg = human(amount1Out) / human(amount0In)`.
- `spreadBps = (buyAvg − sellAvg) / mid × 10 000`.

`buyAvg` and `sellAvg` are human prices (token1 per token0). Both legs include the swap fee (the
LP fee, plus the protocol fee on Uniswap v4, see Conventions), so even an infinitely deep pool shows
a spread of about twice the fee.

**Infeasible.** `spreadBps = null` and `feasible = false` when
- either leg is incomplete (liquidity ran out or the known tick range ended before the input was
  consumed), or yields nothing, or either token has no USD price (the notional cannot be
  converted); or
- either leg's average price impact is above `SPREAD_MAX_LEG_IMPACT_BPS = 5,000` (50 %).

An infeasible $10k spread scores 0 in the health score; it is a signal in itself: the pool cannot
absorb the trade.

**Price impact cap.** Per leg, with `mid` the pool's mid price: `buyImpactBps = (buyAvg / mid − 1)
× 10 000` and `sellImpactBps = (1 − sellAvg / mid) × 10 000`, fees included. Algebraically
`spreadBps = buyImpactBps + sellImpactBps`, so a feasible spread never exceeds 10,000 bps.

_Why completeness is not enough._ A constant-product or stable pool never runs out of liquidity on
an exact-input swap (its curve only approaches the reserve), so such a leg is always `complete`. A
$10,000 buy into a pool that holds a few cents "completes" by returning a sliver of one reserve,
and `buyAvg = amount in / amount out` is then a large number divided by a rounding crumb: on the
first live database an Aerodrome pool with a TVL of 7 × 10⁻¹⁷ USD showed a $10k spread of
1.4 × 10²⁴ bps, and 47 of 148 pools with a feasible $10k spread showed more than 10⁶ bps. Nothing
was wrong with the walk or the division; the number was a correct price for a trade that never
could have happened.

_Why 5,000 bps per leg._ Of those 148 pools, 74 had a $10k spread of 5,000 bps or more and 74 had
one from 0.3 to 3,525 bps; at $10k nothing lies between 3,525 and 10,103 bps. At $1,000 and
$100,000 the values are continuous (4,479, 4,585, 4,612, 5,232, … bps), so the cap is a chosen line,
not a natural break: it is where a leg gives away half of its value, and a trade that costs half of
itself has not been absorbed. With the cap the pools with a feasible spread at $1k / $10k / $100k
go from 186 / 148 / 114 to 121 / 74 / 34 of 492. The cap applies to snapshots taken after it was
introduced. Spreads already stored are not rewritten, but every read applies the cap
(`feasibleSpreadBps`): a stored point whose legs are above it is served as infeasible, in the
pool's `latest.spreads`, in `spread10kBps` of the lists and in the static export, until the pool is
snapshotted again. The dashboard also prints a spread of 10,000 bps or more as "can't absorb"
rather than as a number.

**Worked example.** Same WETH/USDC pool as above, N = $10,000.
- Buy: 10,000 USDC in, 9,970 after the 0.30 % fee; out = `1,000 × 9,970 / (2,500,000 + 9,970) =
  3.97216` WETH; `buyAvg = 10,000 / 3.97216 = 2,517.52`.
- Sell: 4 WETH in (= $10,000), 3.988 after fee; out = `2,500,000 × 3.988 / 1,003.988 = 9,930.40`
  USDC; `sellAvg = 9,930.40 / 4 = 2,482.60`.
- `spreadBps = (2,517.52 − 2,482.60) / 2,500 × 10,000 = 139.69` bps.

At $1,000 the same pool shows 68.06 bps (about twice the fee plus a little impact); at $100,000
it shows 842.45 bps and at $1,000,000 6,902.55 bps (worked below). The ladder across notionals is
the depth story told in price terms. The legs of the $10,000 spread cost 70.09 bps (buy: `2,517.52
/ 2,500 − 1`) and 69.60 bps (sell: `1 − 2,482.60 / 2,500`), which add up to the 139.69 above.

**Worked example: the cap.** The same pool with 1 WETH and 2,500 USDC (TVL $5,000), N = $10,000.
- Buy: 10,000 USDC in, 9,970 after the fee; out = `1 × 9,970 / (2,500 + 9,970) = 0.79952` WETH;
  `buyAvg = 12,507.52`, a buy impact of 40,030.09 bps.
- Sell: 4 WETH in, 3.988 after the fee; out = `2,500 × 3.988 / (1 + 3.988) = 1,998.80` USDC;
  `sellAvg = 499.70`, a sell impact of 8,001.20 bps.
- Both legs complete, but the buy impact is above 5,000 bps: `spreadBps = null`, `feasible = false`.
  Without the cap the pool would have published 48,031.29 bps.

With ten times the reserves (10 WETH, 25,000 USDC, TVL $50,000) the same trade is feasible: the buy
costs 4,030.09 bps (`buyAvg = 3,507.52`), the sell 2,872.46 bps (`sellAvg = 1,781.88`) and
`spreadBps = 6,902.55`.

**Worked example: $1,000,000.** The first pool (1,000 WETH, 2,500,000 USDC, TVL $5,000,000) still
absorbs a $1M round trip.
- Buy: 1,000,000 USDC in, 997,000 after the fee; out = `1,000 × 997,000 / (2,500,000 + 997,000) =
  285.10` WETH; `buyAvg = 3,507.52`, a buy impact of 4,030.09 bps.
- Sell: 400 WETH in, 398.8 after the fee; out = `2,500,000 × 398.8 / 1,398.8 = 712,753.79` USDC;
  `sellAvg = 1,781.88`, a sell impact of 2,872.46 bps.
- `spreadBps = 6,902.55`: the same legs as the $50,000 pool's $10,000 trade above, since a
  constant-product leg depends only on N against the reserves.

A pool of 200 WETH and 500,000 USDC with a 0.05 % fee (TVL $1,000,000) is cheaper at $1,000 (49.94
bps against 68.06) but can't absorb $1M.
- Buy: 1,000,000 USDC in, 999,500 after the fee; out = `200 × 999,500 / (500,000 + 999,500) =
  133.31` WETH; `buyAvg = 7,501.25`, a buy impact of 20,005.00 bps.
- Sell: 400 WETH in, 399.8 after the fee; out = `500,000 × 399.8 / 599.8 = 333,277.76` USDC;
  `sellAvg = 833.19`, a sell impact of 6,667.22 bps.
- Both legs are above 5,000 bps: `spreadBps = null`, `feasible = false`, and the dashboard shows
  "Can't absorb $1M". Its ladder reads 49.94, 405.89 and 3,675.14 bps, then nothing: which pool is
  cheaper depends on the size of the trade.

## LP concentration

**Question.** Is the in-band liquidity one position or many, and how much of it does the largest
owner control? Structural concentration is readable from pool state alone; ownership needs
indexed positions.

Both are computed inside the band `[mid × (1 − 5 %), mid × (1 + 5 %)]`, expressed as sqrt prices
`√Plower`, `√Pupper` (Q64.96) and clipped to the known tick range.

### Range HHI (structural)

Split the band into tick ranges between consecutive initialised ticks. Each range has a constant
liquidity `L_range` (the active liquidity, adjusted by `liquidityNet` at each tick crossed away
from the current tick). Weight each range by `L_range × (√Pupper_range − √Plower_range)` with the
sqrt bounds clipped to the band; this is approximately the token1 value of the range.
- `share_i = weight_i / Σ weight`
- `rangeHhi = Σ share_i²` (0..1; 1 = all in-band liquidity sits in a single range)
- `activeRangeShare` = share of the range that contains the current tick (0..1)

Edge cases: no positive weight in the band → `rangeHhi = 1`, `activeRangeShare = 0`. Ranges with
negative liquidity (inconsistent tick data) count as 0.

### Owner concentration

For each indexed position overlapping the band: `weight = liquidity × (clipped √Pupper − clipped
√Plower)`, aggregated by owner (lowercase address). Positions with zero liquidity or no overlap
are skipped.
- `count` = owners with weight > 0
- `top1Share`, `top3Share` = share of the largest owner, of the three largest (capped at 1), out
  of the owners' total weight
- `hhi = Σ share²` over owners (0..1)
- `coverage = min(1, Σ owner weights / poolBandWeight)` (0..1): the share of the pool's whole
  in-band liquidity weight (the range HHI's `Σ weight`, same clipped band) that the indexed
  owners account for; 0 when the band holds no liquidity.

The shares describe the indexed positions only; `coverage` says how much of the pool those are.
It is below 1 when part of the liquidity was never indexed: Uniswap v3 positions minted on the
pool directly rather than through the NonfungiblePositionManager (vault managers do this), or a
pool whose position history was not read to the head.

**Custodians.** A contract that holds positions on behalf of depositors is not an owner. A
Slipstream pool's CLGauge (`CLPool.gauge()`, Aerodrome or Aero) holds every staked NFT, so all
staked liquidity would read as one LP. `depthwatch positions` records the gauge of each Slipstream
pool it indexes, and the gauge's positions count as uncovered: they are left out of the owners,
their shares and `coverage`.

`owners` is `null` when positions were not indexed for the pool (`depthwatch positions` has not
run for it, or the DEX has no observable positions). When positions were indexed but none overlap
the band (or only a custodian's do), `count = 0`, all shares are 0 and `coverage = 0`. A snapshot
stored before `coverage` was recorded reads `coverage = null` (unknown).

**The pool's top LP share.** The owners describe the pool only when `count > 0` and `coverage ≥
OWNER_COVERAGE_MIN = 0.9` (`ownersCoverPool`); the same rule decides whether the health score
uses them (see "Concentration (max 20)"). Only then is `top1Share` the pool's `ownerTop1Share`
(`poolOwnerTop1Share`), the number the pools table lists as Top LP and sorts by (`sort=top`);
otherwise `ownerTop1Share` is `null`. One unstaked LP beside a gauge that holds 97 % of the band
has `count = 1`, `top1Share = 1` and `coverage ≈ 0.01`: 100 % of the indexed owners is 1 % of the
pool, so no top LP share is listed, and the pool page says that indexed LPs hold 1 % of the
liquidity near the price, the largest 100 % of that.

### Reserve pools

Aerodrome v2 and Aero v2 pools are one full-range position by construction: `rangeHhi = 1`,
`activeRangeShare = 1`, `owners = null` (LP tokens are fungible; holder distribution is not
indexed in the MVP).

**Worked example.** A pool with three in-band ranges weighing 60, 30 and 10 (any unit): shares
0.6, 0.3, 0.1 → `rangeHhi = 0.36 + 0.09 + 0.01 = 0.46`. If the current tick is in the 60 range,
`activeRangeShare = 0.6`. Three owners with weights 42, 38, 20 → `top1Share = 0.42`, `top3Share =
1`, `hhi = 0.1764 + 0.1444 + 0.04 = 0.3608`, `count = 3`, `coverage = 100 / 100 = 1`. If the
owner of the 20 were the pool's gauge, the owners would be 42 and 38: `top1Share = 42 / 80 =
0.525`, `count = 2`, `coverage = 80 / 100 = 0.8`. If only positions weighing 40 had been indexed,
`coverage = 0.4`.

## Liquidity persistence (window W hours)

**Question.** When we looked during the last W hours, how much of the depth was there?

**Definition.** Samples are the stored snapshots with timestamp in `(now − W × 3600, now]` and a
non-null, finite, non-negative `depth2Usd`. Let `median` and `p10` be the 50th and 10th percentiles
of the sampled depths, with linear interpolation between order statistics (`rank = p/100 × (n −
1)`, the numpy default).
- `stability = clamp(p10 / median, 0, 1)`
- `uptime` = share of samples with `depth ≥ 0.5 × median`
- **Too few samples.** Both are `null` ("unknown") with fewer than 3 samples.
- **Dead pool.** With 3 or more samples and a median of 0, `stability` and `uptime` are both 0:
  "at least half of nothing" is true of every sample, so without this rule a pool that never held
  a dollar would show an uptime of 1 and earn the persistence points. A pool with nothing to keep
  is not "unknown", so this holds whatever the coverage.
- **Coverage.** Otherwise both are `null` unless the oldest and newest sample are at least
  `PERSISTENCE_MIN_COVERAGE = 25 %` of the window apart: 6 h for the 24 h window, 42 h for the 7 d
  window. Three snapshots taken minutes apart say nothing about a day.
- `depthUsdMedian`, `depthUsdP10` and `depthUsdMin` are always reported from whatever samples
  exist, and `samples` is the count.

Windows: 24 h and 7 d. `stability` says how deep the bad decile was relative to a normal reading;
`uptime` says how often the pool was at least half as deep as normal.

On the first live database, 5 snapshots spanned 51 minutes (0.86 h), so every pool's "24 h"
persistence was computed from under an hour, and the 144 pools holding nothing at all showed an
uptime of 1; with the coverage rule it is unknown for every pool with depth until the snapshots
span 6 h, and 0 for a pool with no depth.

**Worked example.** Six samples 4 h apart (a 20 h span, at least 6 h) in the last 24 h with
`depth2Usd` of 100,000; 120,000; 95,000; 110,000; 40,000; 105,000. Sorted: 40,000; 95,000; 100,000;
105,000; 110,000; 120,000.
- `median`: rank `0.5 × 5 = 2.5` → halfway between 100,000 and 105,000 = **102,500**
- `p10`: rank `0.1 × 5 = 0.5` → halfway between 40,000 and 95,000 = **67,500**
- `stability = 67,500 / 102,500 = 0.6585`
- `uptime`: threshold `0.5 × 102,500 = 51,250`; five of six samples qualify → **0.8333**

With only the first two samples, `median = 110,000`, `p10 = 102,000`, and both `stability` and
`uptime` are `null` (fewer than 3). Three samples 1 h apart are `null` too: they span 2 h, under the
6 h the 24 h window needs, and 3 samples spanning 6 h exactly count. Three samples of 0, whether
1 h or 11 h apart, give `stability = 0` and `uptime = 0`.

## Liquidity Health Score

**Question.** One number, 0–100, that ranks pools by how usable their liquidity is, and a letter
for the pools that have enough liquidity to be rated at all.

Four components, maximum 35 + 25 + 20 + 20 = 100. Each component is rounded to two decimals; the
total is the sum of the rounded components. Inputs: `depth2UpUsd` and `depth2DownUsd` (the two
sides of the ±2 % level of the latest snapshot), `spread10kBps` (from the latest snapshot),
`ownerTop1Share`, `ownerCoverage` and `rangeHhi` (from the latest snapshot's concentration), the
pool's kind, and the 24 h persistence. Every pool keeps its numeric total and components; only a
_rated_ pool gets a grade.

### Rated and unrated pools

Concentration and persistence do not depend on size, so an empty pool still earns part of them
(on the first live database, 10 to 35 points of 100 for each of the 275 pools holding under $1
within 2 %), and a letter
for such a pool compares nothing. A pool is **rated** only when both sides of its ±2 % depth are
known and the thinner side holds at least `HEALTH_RATING_MIN_SIDE_USD = $5,000`. Otherwise it is
unrated, `grade` is `null` and `unratedReason` says why, tested in this order:
- `hooked`: a pool with a hook (a non-zero `hooks` address): a Uniswap v4 pool with a hook, or
  an Aero Slipstream pool whose swap hook is not the reviewed one (docs/research/base-contracts.md,
  `## aero`) or charges each block's first transaction a fixed initial fee (`initialFeeEnabled`:
  `fee()` read at a block without a swap is then not what every swap of that block pays; no Aero
  pool did at block 53,213,030). A hook runs its own code around every swap (a fee of its own, a
  custom curve, amounts taken or added) that the pool's state does not describe, so the swap walk
  would guess. Depth, spread and concentration are not computed: the snapshot holds no depth
  levels, spread points or concentration, every number derived from them is `null`, and the pool
  is no price route (see [USD prices](#usd-prices)). Its price is still the pool's own. An
  allow-list of hooks that leave swaps unchanged may be added later. Aero Slipstream pools are
  checked at discovery and at every state read: a pool whose hook changed after discovery fails
  its snapshot ("swap hook changed", "initial fee enabled") until `depthwatch discover --seed`
  reads it again, which it does for every stored Aero Slipstream pool, seeded pair or not; the
  pool is then `hooked`, or modelled again when its initial fee was turned off.
- `transfers-paused`: a stock pool whose stock's transfers (`TRANSFER`) are paused at the
  snapshot's block, so that every swap in it reverts; it also leaves the depth sums. See
  [Stock tradability](#stock-tradability).
- `unpriced`: a side's USD depth is `null` (its token has no USD price, or the snapshot has no
  ±2 % level).
- `one-sided`: both sides are known, the deeper one holds at least the floor and the thinner one
  does not (it may be 0).
- `thin`: both sides are known and neither holds the floor.

A rated pool has `rated = true` and `unratedReason = null`. The boundary is inclusive: exactly
$5,000 on the thinner side is rated.

_Why the thinner side._ Price routing already weights a pool by its thinner side (see
[USD prices](#usd-prices)). A pool with $1,000,000 above its price and nothing below it can absorb
buys but no sells; summing the sides graded it A or C while no one could sell into it.

_Why $5,000._ The headline spread is measured on a $10,000 trade. A pool whose thinner side holds
under $5,000 within 2 % cannot absorb half of that trade on that side without moving more than
2 %, so a grade would compare nothing. On the first live database (492 scored pools) the number of
pools whose thinner side holds at least $1,000 / $2,500 / $5,000 / $10,000 is 81 / 64 / 50 / 40,
and the share graded F among them is 23 of 81, 6 of 64, 2 of 50 and 0 of 40: at $1,000 the rated
set is still full of dust that earns an F, at $5,000 an F means a real pool that is poor.
$10,000 would rate 40 pools and leave out pools that do trade. With $5,000, 50 pools are rated
(7 A, 18 B, 9 C, 14 D, 2 F; median 61.66, grade C) and 442 are not (431 thin, 11 one-sided,
0 unpriced). Before this rule 390 of the 492 were graded F and the median was 20 (F).

Of the 492, the 144 pools that held nothing on either side and the 348 others all had a 24 h
persistence computed from 5 snapshots 51 minutes apart: now the 144 score 0 for it (a dead pool)
and the 348 the neutral 10 with the note `persistence neutral: samples cover under 25 % of the
window`.

### Depth (max 35)

`35 × clamp((log10(2 × thinner) − 3) / 3, 0, 1)`, with `thinner = min(depth2UpUsd,
depth2DownUsd)`.

The depth the pool would have if both sides matched its thinner one ("balanced-equivalent"): $1,000
or less (a thinner side of $500) → 0; $1,000,000 or more (a thinner side of $500,000) → 35;
logarithmic in between. A pool that holds $1,000,000 on one
side and nothing on the other scores 0, not 35. A side that is `null` makes the thinner side
unknown: 0 with the note `depth unknown: scored 0`.

Example: $1.2M on each side → `2 × 1.2M = 2.4M` → `log10 = 6.38`; `(6.38 − 3) / 3 = 1.127` → clamp
→ 1 → **35**. $25,000 on each side → `50,000` → `(4.699 − 3) / 3 = 0.566` → **19.82**. $1,000 on each side →
`2,000` → `(3.301 − 3) / 3 = 0.100` → **3.51**. $1,000,000
up and $0 down → `0` → **0**. $5,000 up and $20,000 down → `2 × 5,000 = 10,000` → `(4 − 3) / 3` →
**11.67**.

### Spread (max 25)

`25 × clamp((log10 300 − log10 spread10kBps) / (log10 300 − log10 10), 0, 1)`

10 bps or tighter → 25; 300 bps or wider → 0; logarithmic in between. `null` (infeasible at $10k,
see the price impact cap) → 0 with the note `spread infeasible at $10k: scored 0`. A non-positive
spread, which can only arise from rounding on a zero-fee pool, scores the maximum.

Example: 30 bps → `(log10 300 − log10 30) = 1` exactly, divided by `1.4771` → `0.6770` → **16.92**.
100 bps → `(2.4771 − 2) / 1.4771 = 0.3230` → **8.08**.

### Concentration (max 20)

The first rule that applies gives the component and `concentrationBasis`, which the score
publishes so that a reader knows what the 20 points stand on:
- `owners`: owners known (`ownerTop1Share` not null and > 0) and covering the pool (`ownerCoverage
  ≥ OWNER_COVERAGE_MIN = 0.9`): `20 × (1 − top1Share)`.
- `ranges`: a concentrated pool with `rangeHhi` known: `20 × (1 − rangeHhi)`.
- `neutral`: otherwise **10**. Without known owners the note is `concentration neutral: LP owners
  not indexed` for a reserve pool and `concentration neutral: no position or range data` for a
  concentrated pool without range data.

Owners known but not used (coverage under 90 %) add the note `owner data covers X % of in-band
liquidity`, with X = `ownerCoverage × 100` rounded down (so 89.9 % never reads as 90 %), or `owner
data covers an unknown share of in-band liquidity` for a snapshot stored before coverage was
recorded.

Example: `top1Share = 0.42` with `ownerCoverage = 0.95` → **11.6** (`owners`). The same owners with
`ownerCoverage = 0.4` and `rangeHhi = 0.18` → **16.4** (`ranges`) with the note `owner data covers
40 % of in-band liquidity`. Owners unknown, `rangeHhi = 0.18` → **16.4** (`ranges`). An Aerodrome
v2 pool → **10** (`neutral`).

_Why coverage._ Owner shares are relative to the indexed positions. A pool indexed in part, or a
Slipstream pool whose staked liquidity sits with its gauge, would show one owner with 70 to 100 %
and score close to 0 here while nobody controls the pool. Below 90 % the owners say too little,
and the structural measure is used instead.

_Why reserve pools are neutral._ A reserve pool is one full range by construction, so its `rangeHhi
= 1` describes the AMM, not its LPs, and LP-token holders are not indexed. Scored from `rangeHhi` it
got 0 of 20: on the first live database all 86 Aerodrome v2 pools did, so a whole DEX started 20
points down. With no information either way it scores the neutral 10, like any other unknown: the
four rated v2 pools of that database move from 22.8 to 39.05 (three F, one D) to 32.8 to 49.05 (two
F, two D).

_What `ranges` means._ The range HHI says how the in-band liquidity is spread over price ranges, not
who owns it: twenty ranges can belong to one LP. It is the best structural signal without owners, so
concentrated pools keep it, and `concentrationBasis` marks every score that rests on it (the
dashboard states the basis once per list, at its Health column, and on the pool page). The first
live database indexed no positions, so all 46 of its rated concentrated pools rest on it.

### Persistence (max 20)

`20 × (0.5 × stability + 0.5 × uptime)` over the 24 h window. Unknown persistence (`null`: fewer
than 3 samples, or samples spanning under 25 % of the window, see
[persistence](#liquidity-persistence-window-w-hours)) → **10** with the note `persistence neutral:
fewer than 3 samples` or `persistence neutral: samples cover under 25 % of the window`. A pool
whose median depth is 0 has `stability = uptime = 0` → **0**.

Example: `stability = 0.6585`, `uptime = 0.8333` → `20 × 0.7459` → **14.92**.

### Grade

For rated pools only: A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F. The thresholds are unchanged; on
the 50 rated pools of the first live database they give 7 A, 18 B, 9 C, 14 D and 2 F.

### Medians over rated pools

`medianHealth` (the Home headline and `GET /api/stats`, in `totals` and per DEX) is the median of
`health.total` over **rated** pools only, with the usual interpolation between the two middle
values; the letter shown beside it is `healthGrade(median)`. The stats also carry `rated`, the
number of rated pools, next to `scored`. `medianHealth` is `null` when no pool is rated. Unrated
pools stay in every list, in the gaps feed and in the depth and volume sums (only a
[stale quote](#stale-quotes) and a pool whose stock has its transfers paused
([Stock tradability](#stock-tradability)) leave the depth sums); sorting by health puts them after
the rated ones in both directions.

Example: five scored pools with totals 85, 70, 55 (rated) and 20, 12 (unrated): `rated = 3`,
`scored = 5`, `medianHealth = 70` (B). The median over all five would have been 55.

### Worked examples

Unless stated, "known" persistence is the 14.92 example above, and known owners cover at least
90 % of the in-band liquidity.
1. $1.2M on each side, `spread10kBps = 30`, `top1Share = 0.42`, persistence known: depth 35 +
   spread 16.92 + concentration 11.6 + persistence 14.92 = **78.44, rated, grade B**, no notes.
2. $25,000 on each side, `spread10kBps = 100`, owners unknown with `rangeHhi = 0.18`, fewer than
   three snapshots: 19.82 + 8.08 + 16.4 + 10 = **54.3, rated, grade C**, note `persistence neutral:
   fewer than 3 samples`.
3. A pool just discovered, nothing known: 0 + 0 + 10 + 10 = **20, unrated (`unpriced`), no grade**,
   with all four notes. Its total still ranks it below every pool with any depth.
4. $500 on each side, `spread10kBps = 10`, `top1Share = 1`, persistence known: 0 + 25 + 0 + 14.92 =
   **39.92, unrated (`thin`), no grade**: a single-owner, tight but empty pool, which the earlier
   rules graded D.
5. $1,000,000 up and $0 down, otherwise as example 1: 0 + 16.92 + 11.6 + 14.92 = **43.44, unrated
   (`one-sided`), no grade**; summing the sides it scored 78.44 and a B.
6. $5,000 up and $20,000 down, otherwise as example 1: 11.67 + 16.92 + 11.6 + 14.92 = **55.11,
   rated, grade C**. With $4,999.99 up it is unrated (`one-sided`).
7. Three snapshots a minute apart, all with a depth of 0: `stability = uptime = 0`, persistence
   **0** (a dead pool earns nothing). Three snapshots with a depth of 100,000 a minute apart:
   unknown, persistence **10** with the note `persistence neutral: samples cover under 25 % of the
   window`.
8. As example 1, but the indexed owners cover 40 % of the in-band liquidity and `rangeHhi = 0.18`:
   35 + 16.92 + 16.4 + 14.92 = **83.24, rated, grade A**, `concentrationBasis = ranges`, note
   `owner data covers 40 % of in-band liquidity`.
9. An Aerodrome v2 pool with $25,000 on each side, `spread10kBps = 100`, persistence known:
   19.82 + 8.08 + 10 + 14.92 = **52.82, rated, grade C**, `concentrationBasis = neutral`, note
   `concentration neutral: LP owners not indexed`; scored from `rangeHhi = 1` it was 42.82 (D).

## 24 h volume

**Question.** How much traded in the pool over the last day?

**Buckets.** The volume step reads the `Swap` events of every tracked pool and sums them into
hourly buckets, half-open hours `[h, h + 1 h)` on unix-hour boundaries. A swap counts `|amount|` of
one priced side: the USD stablecoin side when there is one, else token1, else token0, valued with
the prices the snapshot step stored. Every pass revalues the pool's stored buckets at the current
prices, so the whole window is valued alike.

**Window.** Let `E` be the timestamp of the last block the latest volume pass read and `H` the
start of the hour that holds it (`H = E − E mod 3,600`). The window is `[H − 24 h, H)`: exactly 24
whole hourly buckets, and `volume24hUsd` is the sum of the pool's buckets whose `hourStart` lies in
it.
- **First bucket.** The window starts on an hour boundary, and the volume step starts its scan at
  the first block whose timestamp reaches it, found by time (`ChainReader.blockAtOrAfter`: Base's
  block schedule, 2 s blocks and then 200 ms blocks from Denim's block 53,556,127, confirmed by
  headers), so the first bucket is complete. Swaps take their block's header timestamp (whole
  seconds). No bucket is prorated.
- **Last, partial hour.** The hour from `H` to `E` is stored but not counted: it is still being
  filled, and a later pass completes it. The window therefore ends 0 to 1 hour before the data.
- **Between volume and score.** The window is anchored to `E`, not to the scoring clock, so a
  snapshot or a pause between the volume pass and the score does not shorten it. `run` orders its
  steps snapshot → volume → score: `volume` values swaps at the prices just stored, and `score`
  follows it directly.
- `0` when the pool's buckets cover the window and it did not trade.
- `null` when no volume pass is stored or the latest ended more than 24 h before the score
  (stale); when the pool was not part of the latest pass or its buckets do not reach back to
  `H − 24 h` (newly tracked, or `--hours` below 24); or when a traded hour in the window has no
  USD value (neither token priced).

**Worked example.** The last volume pass read up to a block at 14:37:20 UTC, so `H = 14:00` and the
window runs from 14:00 yesterday to 14:00 today. If each of those 24 hours traded $20,000,
`volume24hUsd = $480,000`; the $9,000 traded from 14:00 to 14:37 today is not counted yet, nor is
the hour before 14:00 yesterday. Scored at 15:10 after another snapshot, the window and the total
are the same. If the pool's buckets were complete only from 15:00 yesterday (23 hours),
`volume24hUsd` would be `null`.

## Gap score and the gaps feed

**Question.** Which pools have real trading but not the depth to carry it?

**Definition.**
- `turnover = volume24hUsd / depth2Usd`
- `gapScore = 100 × clamp(log10(turnover) / 2, 0, 1)`

Turnover of 1× (a day's volume equals the ±2 % depth) → 0; 10× → 50; 100× or more → 100; below 1×
→ 0. `turnoverRatio` and `gapScore` are `null` when volume or depth is unknown or depth is 0.

**Feed.** `GET /api/gaps` lists pools with `volume24hUsd ≥ 10,000` sorted by `gapScore`
descending; ties (every pool at 100× or more scores 100) by turnover, highest first, then pool id.
The volume floor keeps dust pools with a single trade out of the feed.

**Meaningful gap.** A feed pool whose `turnover ≥ 3` (`MEANINGFUL_GAP_TURNOVER`, a gap score of
23.86) trades at least three times its ±2 % depth a day: a meaningful gap, the threshold every
screen counts and highlights. Each feed response carries two counts over the whole feed at its
volume floor, ignoring `limit` / `offset`: `total`, the feed's pools, and `meaningful`, those with
`turnover ≥ 3`. Since the gap score rises with turnover, the meaningful pools are the head of the
feed. Example: a feed of 250 pools of which 120 trade 3× or more answers `total = 250`,
`meaningful = 120` on every page, including a page of 100.

**Turnover is not fee income.** What a day's volume pays the pool's LPs is about `volume24hUsd ×
feePips / 10^6`, so a 0.01 % pool full of arbitrage flow can top the feed while earning less per
dollar of liquidity than a 0.30 % pool further down. The feed shows where trading outruns the
depth near the price, not where added liquidity earns the most fees.

**Worked example.** `volume24hUsd = $500,000`, `depth2Usd = $20,000` → `turnover = 25` →
`log10 25 / 2 = 0.699` → **69.90**. `$20,000 / $20,000` → 0. `$2,000,000 / $20,000` → 100.
`$5,000 / $20,000` → 0. Depth 0 → `null`.

## TVL

`tvlUsd = human(reserve0) × token0Usd + human(reserve1) × token1Usd`. A side without a USD price
is skipped, so a one-sided value is a lower bound; when neither side is priced, `null`. For the
worked-example pool: `1,000 × 2,500 + 2,500,000 × 1 = $5,000,000`. Uniswap v4 pools hold no
reserves of their own (the singleton PoolManager holds every pool's tokens), so their `tvlUsd` is
`null`, and the snapshot ranks them by the USD value of their ±2 % depth instead.

TVL ranks which pools get full depth snapshots; it is not a liquidity metric. Two pools with the
same TVL can differ by an order of magnitude in ±2 % depth, which is the point of this project. A
hooked Uniswap v4 pool is not ranked at all (its depth is not modelled, see `hooked`): it is
snapshotted only when requested with `--pool` or named by a mandate.

## USD prices

**Question.** What is a token worth in dollars, read from the pools alone?

**Graph.** Every pool with a usable mid price is an edge `token0 ↔ token1` at its price (token1 per
token0). Native ETH (Uniswap v4 `currency0 = 0x0`) is tied to WETH by a 1:1 edge of unbounded
weight. Anchors are the USD stablecoins (USDC, USDbC, DAI and USDT = 1). `derivePrices` runs a
widest-path (maximum-bottleneck) search from the anchors: among all routes from an anchor to a
token, the one whose weakest edge is strongest wins, and the token's USD price is the product of
the pool prices along it. Tokens unreachable from an anchor have no USD price. The route is stored
(`via`) and shown on the token page so that any price can be audited.

**Edge weight: the thinner side.** Each pool's ±2 % depth (`PRICE_DEPTH_PCT`) is computed with
`computeDepth`, on the pool's full state when the snapshot step read it, otherwise on a state built
from the overview (Aerodrome v2 reserves, exact; a concentrated pool's active liquidity held
constant over ±2,000 ticks). With `up = human(up.amountIn)`, the token1 that moves the price 2 % up,
and `down = human(down.amountIn)`, the token0 that moves it 2 % down:
- `weight = min(up × token1Usd, down × token0Usd)`: the thinner side, in USD.
- A pool with no liquidity within 2 % on one side of its price has weight 0 and is no route,
  however deep its other side.
- A hooked pool (`hooked`) is no route.

**Two AEROs.** Aerodrome's AERO (0x9401…8631) and Aero's AERO (0x3f5b…a4ee) are two tokens with
the same symbol. Aero's migration contract converts the old one into the new one, one way, but
that is no price peg, so there is no synthetic edge between them as there is between ETH and
WETH. A pool that pairs the two (Aero v2's stable AERO/AERO pool, `aero-v2:0x7986…6c1b`) is an
ordinary edge at its own price, weighted by its ±2 % depth like any other: an AERO is priced
through it only when that is its widest route, otherwise from its own pools.

USD prices are what is being derived, so the search weighs each edge when it reaches it from a
settled token, in one pass: the settled token's side at that token's USD price, the other side at
the price this edge implies (`token1Usd = token0Usd / price` from token0, `token0Usd = token1Usd ×
price` from token1). The weight is in USD whatever the tokens' units, so re-denominating a token
(its amounts × k, its price ÷ k) changes no weight and no route. A pool that misprices the token
it would price counts that token's side at its own wrong price: a stale pool that quotes a token
1,000 times too cheap values its side of that token 1,000 times too low.

**Worked example** (`apps/cli/src/pipeline/prices.units.test.ts`). USDC = $1; Aerodrome v2
pools at 0.3 %: A/USDC holds 800 A and 80,000 USDC ($100 per A); B/USDC 10^9 B and 100,000 USDC
($0.0001 per B); a stale A/B pool 2,000 A and 2,000,000 B, quoting A at 1,000 B ($0.10). Reached
from B, the stale pool weighs $2.00 (19,961 B at $0.0001 against 20.37 A at its $0.10), A/USDC
$798.43, so A is $100 through A/USDC. Weighed in token1 units, as an earlier two-pass search did
first, the stale pool weighed 19,961 (B) against 798 (USDC) and A came out at $0.10; a second
pass valuing the sides at that price left A/USDC $0.81 on its A side and kept $0.10.

**Why the thinner side.** A pool's mid price is only as good as the trades that would correct it.
When a pool's price drifts away from the market, arbitrage trades against it until the side it
profits from is empty, so a stale price survives only in a pool that holds nothing on that side of
its price. Weighted by one side, such a pool won on the depth of the side that nobody trades
against.

**Worked example** (the live run at Base block 53,063,332). The Uniswap v3 BRETT/USDC 0.3 % pool
(BRETT is token0) had no active liquidity and one range just above a stale mid of 17.96 USDC per
BRETT: `up = 32,059` USDC, `down = 0` BRETT, so `weight = min($32,059, $0) = 0`. The WETH/BRETT
pools price BRETT at about $0.0047, through a route whose bottleneck was about $3,900. Weighted by
the up side alone, the one-sided pool's $32,059 beat that route, BRETT was priced at $17.96 (3,800
times too high) and BRETT pools showed $3.33 B of a $3.59 B TVL. Weighted by the thinner side, the
pool is no route and BRETT is priced through WETH at $0.0047.
`apps/cli/src/pipeline/prices.oneSided.test.ts` reproduces the case.

This is a valuation convention for depth and volume, not an oracle.

## Reference deviation

**Question.** How far is a pool's price for a tokenized stock from the stock's reference value,
and is that reference live?

A **stock** is a token of the stock list the pipeline stores (`stocks`, written by the snapshot
step from `packages/chain/src/stocks.ts`: the ten Coinbase Tokenized Stocks of base.org/stocks,
B20 Asset tokens of 8 decimals, [docs/research/base-contracts.md
`## stocks`](research/base-contracts.md#stocks)); a **stock pool** is a pool holding one. The
reference is the stock's Chainlink "Coinbase <ticker>" feed, read on chain at the snapshot's block
([docs/design/stocks.md](design/stocks.md)). "§2.14" below is [docs/research/base-contracts.md
§2.14](research/base-contracts.md#214-tokenized-stocks-and-their-chainlink-feeds-2026-11-05),
where every on-chain figure of these sections was read.

**Not an oracle.** Depthwatch publishes how far each pool is from the reference. It sets no
stock price for anyone to settle, mark or liquidate against. Three numbers carry a stock's dollar
value, and none is such a price:
- `referenceUsd` is Chainlink's answer, passed on as read, always beside its `referenceStatus`
  and `feedAgeSeconds`.
- `poolUsd` is one pool's own mid in dollars, the measured side of that pool's deviation, never
  combined across pools.
- A stock's USD price in the price graph (a snapshot's `token0Usd` or `token1Usd`, the `usd` of
  `GET /api/tokens/:address`) is the [USD prices](#usd-prices) valuation convention, applied to a
  stock as to any token so that its TVL and depth can be stated in dollars. The stock pages and
  the served AGENTS.md label it so.

There is no aggregate, median or time-weighted stock price, and no pool is compared with a
reference that is not `live`.

### The reading (per stock and snapshot block)

At the snapshot's block `B`, timestamp `T`, one multicall reads, for every stock of the stock
list, with pools or without:
- the feed proxy's `latestRoundData()` (`roundId`, `answer`, `updatedAt`), `decimals()` and
  `description()`, and the oracle registry's `getOracleParams(stock)` (a multiplier and a paused
  flag): the four **required calls**;
- the stock's own `multiplier()` and `pausedFeatures()`, which only feed
  [Stock tradability](#stock-tradability).

From them:
- `feedAgeSeconds = T − updatedAt`, whole seconds, both times from the chain (no wall clock);
  `null` when the stock has no feed, a required call failed, or `updatedAt` is 0 or after `T`
  (the `invalid` cases below: an age is never negative).
- `referenceUsd = answer / 10^decimals`, USD per stock token. The Coinbase feeds answer USD per
  token, the share price times the token's multiplier truncated to 8 decimals (§2.14), which is
  the unit of a pool's price: the multiplier is never applied to the answer.
- `referenceStatus`, the first that applies:
  - `no-feed`: the stock list records no feed for the stock.
  - `unread`: a required call failed, reverted or did not decode (`getOracleParams` reverts for a
    token the oracle registry does not know). A failed `multiplier()` or `pausedFeatures()`
    changes no status: a failed `multiplier()` leaves `tokenMultiplierWad` `null`, a failed
    `pausedFeatures()` leaves `pausedFeatures` and `transfersPaused` `null`.
  - `paused`: the oracle registry's paused flag is set (a corporate action: the feed holds its
    last good value until the price and the multiplier both reflect it).
  - `invalid`: `answer ≤ 0`, `updatedAt` is 0 or after `T`, `decimals()` is not the recorded
    one, or `description()` is not `Coinbase <ticker>` (a proxy recorded for the wrong stock).
  - `held`: the feed holds a closed market's value (Off-hours, below).
  - `live`: otherwise.

`referenceUsd` is published for `live`, `held` and `paused` (what the feed answers, beside its
status) and is `null` for the other three.

_The oracle registry's interface._ `paused` rests on an ABI that no document gives. Base's
list-tokenized-stocks page describes the oracle registry as "a single contract (separate from the
tokens) that returns both values for a token in one call" and names no function; the name
`getOracleParams(address)` comes from earlier research, and its selector 0xd4197e82 is in the
contract's bytecode. At block 53,663,272 it answered `(uint256, bool)`, the multiplier equal to
each stock's own `multiplier()` and the flag false, and reverted for USDC and for an unregistered
B20 address (§2.14). An answer that does not decode as `(uint256, bool)` is `unread`, never
`live`; no paused answer has been observed.

**Off-hours.** The ten feeds are 24/5 feeds. Chainlink's page runs them through the US equity
"regular, pre-market, post-market, and overnight sessions"; when those markets are closed "the
feed holds the last close", and "These feeds do not have heartbeats during off-hours"
(<https://docs.chain.link/data-feeds/tokenized-equity-feeds/coinbase.md>, which gives no clock
times). The chain gives them: the sessions run from Sunday 20:00 to Friday 20:00 America/New_York.
None of the ten feeds' 15,903 rounds from 2026-08-05 to 2026-11-05 fell between Friday 20:00 and
Sunday 20:00 New York time, and every weekend gap but Labor Day's ended 19 to 99 s after Sunday
20:00 (§2.14). A 24/5 reading is `held` when either part holds:
- **Age:** `feedAgeSeconds > heartbeatSeconds + REFERENCE_AGE_GRACE_SECONDS`, which is 86,400 +
  3,600 = 90,000 s for the ten feeds.
- **Weekly close:** `T` lies in a weekly close, `[Friday 20:00, Sunday 20:00)` America/New_York,
  and `updatedAt` is before that close began.

The weekly close is a fixed rule computed in pure code (`weeklyCloseAt(T)`), not a maintained
calendar. New York is on UTC−4 from the second Sunday of March at 07:00 UTC to the first Sunday of
November at 06:00 UTC and on UTC−5 otherwise (the US daylight-saving rule since 2007), so a close
begins at Saturday 00:00 or 01:00 UTC and lasts 48 h, 49 h across November's change and 47 h
across March's. Holidays fall to the age part alone. A 24/7 feed (none of the ten) is held by its
age alone.

Younger than 90,000 s and outside a weekly close, a held value cannot be told from a quiet
market: the status is `live`, and `feedAgeSeconds`, published with every reading and every
deviation, shows how old the answer is. That is the case of a weekday holiday: over Labor Day
(Monday 2026-09-07) the sessions resumed at 20:00 New York time on the holiday itself (§2.14). If
Thanksgiving (Thursday 2026-11-26) follows that pattern, its gap is about 24 h plus the feed's
quiet tail before it, and the age part holds only what lies beyond 25 h, if anything.

**Worked example** (NVDA's feed, `updatedAt` Friday 2026-10-30 19:51:03 UTC, 15:51 New York time,
its last round before that weekend, §2.14):
- Read on Friday at 23:00:00 UTC (19:00 New York time): age 11,337 s, before the close: `live`
  (the post-market session is open).
- Read on Saturday 2026-10-31 at 14:00:00 UTC (10:00 New York time): age 65,337 s, under 90,000,
  but `T` lies in the close that began at Saturday 00:00 UTC (Friday 20:00 EDT), after
  `updatedAt`: `held`. By age alone it would read `live` until Saturday 20:51:03 UTC.
- Read on Sunday 2026-11-01 at 22:00:00 UTC (17:00 EST, in the close that ends at Monday
  01:00 UTC): age 180,537 s, held by both parts.
- Read on Monday 2026-11-02 at 01:00:30 UTC, after the close and before the feed's first new
  round: age 191,367 s, held by its age until that round.
- At exactly 90,000 s, on a weekday outside a close, the status is still `live`.

_Why one hour of grace, and the weekly close._ In those 15,903 rounds the longest gap with no
Saturday inside it was 86,418 s, the heartbeat plus 18 s, and every gap across a weekend or a
holiday was at least 172,968 s (§2.14). A grace of 3,600 s is 200 times the largest overshoot seen
and calls no weekday held; a shorter threshold calls quiet weekdays closed (212 weekday gaps were
longer than 12 h, 14 longer than 20 h). Age alone holds a weekend only from 25 h after Friday's
last round: 54.3 % of the 7,110.6 h inside the 130 weekend gaps, the rest of Saturday reading
`live` against Friday's value. With the weekly close the rule holds 91.3 % of those hours and every
second of each close, and still no weekday second: the hours left `live` are Friday's quiet tails,
from a feed's last round to 20:00 New York time, while the market is open (§2.14).

### The pool's USD price and the deviation

For a stock pool with stock `S` and quote `Q` (the other token), with `price` the pool's mid at the
snapshot's block (token1 per token0) and the USD prices of the same pass (see
[USD prices](#usd-prices)):
- `poolUsd`, USD per stock token at the pool's mid: `price × token1Usd` when `S` is token0,
  `token0Usd / price` when `S` is token1. A stock's address (0xb200…) sorts after USDC's and
  WETH's, so in most stock pools it is token1. Only the quote's USD price is used: the stock's own
  comes from its widest pool, which would be 0 from it by construction (see
  [Stale quotes](#stale-quotes)). `null` when the pool is hooked (its mid is not known to be a
  price a swap gets), when `Q` has no USD price, or when `Q`'s price route (`via`) runs through a
  pool holding `S` among all the pass's pools, tracked or not (every pool read for prices is an
  edge of the graph), which would price the quote with the stock itself.
- `deviationBps = (poolUsd / referenceUsd − 1) × 10,000`, signed: positive when the pool prices
  the stock above its reference. Not rounded; shown to two decimals.
- `toleranceBps = deviationThresholdBps + feePips / 100`: the feed's deviation threshold, 50 for
  the ten (a feed publishes a round on a 0.5 % move or at its heartbeat: Base's feed table and
  Chainlink's directory, `## stocks`), plus the pool's LP fee at the snapshot's block in bps
  (`PoolSnapshot.feePips`). `null` when the fee is unknown (a snapshot stored before schema
  version 7). Its two parts are published beside it, `deviationThresholdBps` and `feeBps =
  feePips / 100`, both `null` when it is, so that the band's words take each part as published
  rather than from the sum.
- `withinTolerance = |deviationBps| ≤ toleranceBps`; `null` when either is `null`.

_Why a tolerance._ While a feed is live its answer can sit up to its threshold from the market
without a new round, and an arbitrage against the pool pays the pool's fee, so a pool at the market
can show a deviation up to their sum with nothing mispriced. `withinTolerance = true` says the
deviation is no larger than those two explain. `false` says the pool and the feed's last round
disagree by more: the pool may be off the market, or the market moved since that round faster than
the next one landed (`feedAgeSeconds` says how long ago it was). The dashboard and the agent
documents word a deviation inside the band as "within the feed's 0.5 % band plus the pool's fee",
never as a mispricing.

`deviationBps`, `toleranceBps` and `withinTolerance` are `null` when the first reason that applies,
published as `deviationNull`, is:
- `hooked`: a hooked pool (see [Rated and unrated pools](#rated-and-unrated-pools)): its mid is not
  known to be a price a swap gets.
- `thin`: the pool's thinner ±2 % side is not known to hold `HEALTH_RATING_MIN_SIDE_USD` ($5,000):
  it holds less, or a side has no USD value. A pool too thin to rate holds a price that no one
  need correct, however far it is from the feed: of the 13 AMZNc/USDC and NVDAc/USDC pools the
  factories returned at block 53,663,272, 7 held under 2 USDC (§2.14).
- `stock-pair`: both tokens are stocks. The quote's USD price is then another stock's price-graph
  price, so the deviation would set one stock's feed against another stock's DEX price. Such a
  pool's reference carries token0's stock and its reading.
- `no-feed`, `unread`, `paused`, `invalid` or `held`: the reading's status. A held or paused answer
  is no market price, so no pool is compared with it; its `referenceUsd` and `feedAgeSeconds` are
  still published.
- `quote-unpriced`: `poolUsd` is `null` because the quote's USD price is routed through a pool of
  `S` itself (a quote with no USD price at all is already `thin`: its sides have no USD value).

A pool therefore gets a deviation only when its depth would rate it; a pool unrated for
`transfers-paused` alone keeps its deviation, which describes its price though no trade can use it.
`priceDeviationBps` applies to stock pools as to any other; it compares a pool with Depthwatch's
price graph, this one with the feed.

**Worked example.** An NVDAc/USDC Slipstream pool at a 0.05 % fee (`feePips = 500`): USDC is
token0 (6 decimals), NVDAc token1 (8), `price = 0.005` NVDAc per USDC, USDC = $1, $40,000 on its
thinner ±2 % side. On a Wednesday the feed answers `19950000000` (8 decimals), updated 1,800 s
before the block; the oracle registry is not paused.
- `poolUsd = 1 / 0.005 = $200.00`, `referenceUsd = $199.50`, `feedAgeSeconds = 1,800`: `live`.
- `deviationBps = (200 / 199.5 − 1) × 10,000 = +25.06`, `toleranceBps = 50 + 500 / 100 = 55`:
  `withinTolerance = true`, within the feed's 0.5 % band plus the pool's fee.
- Had the feed answered `19700000000` ($197.00): `(200 / 197 − 1) × 10,000 = +152.28` bps, above
  55: `withinTolerance = false`.
- An NVDAc/cbBTC pool at 0.30 % pricing 0.002 cbBTC per NVDAc (NVDAc is token0 there), cbBTC at
  $100,000: `poolUsd = 0.002 × 100,000 = $200.00`, the same +25.06 bps, `toleranceBps = 80`.
- The first pool with $3,000 on its thinner side: `null` (`thin`). The first pool on a Saturday:
  `null` (`held`), `referenceUsd = $199.50` still published.
- Applying the multiplier to the answer, as for a per-share feed, would understate every deviation
  by about `(m − 1) × 10,000` bps: 5.38 bps for NVDAc's multiplier of 1.000538 (§2.14). A test of
  `packages/core` pins that it is never applied.

On chain at block 53,663,272 (2026-11-05 23:57:10 UTC) the Aero Slipstream NVDAc/USDC pool
`0xf668…c8ec` priced NVDAc at $180.4632 and the feed answered 180.26191788, 1,268 s old: +11.17
bps (§2.14), inside the feed's 50 bps band before the pool's fee is even added.

### Stock tradability

`transfersPaused` says whether the stock's `pausedFeatures()` at the snapshot's block holds
`TRANSFER` (ordinal 0; `PausableFeature` ordinals TRANSFER 0, MINT 1, BURN 2, SEIZE 3:
<https://docs.base.org/specifications/b20/reference/interfaces/ib20/is-paused.md>). The other
features are published and change nothing here: minting and redeeming are the issuer's flow, not
the market's. While `TRANSFER` is paused every swap in every pool of the stock reverts
(`ContractPaused`), since a swap moves the token. It is read with every snapshot: a pause takes
effect at the block it is set and leaves the pools' state unchanged. `null` when `pausedFeatures()`
failed or did not decode: unknown is not a pause. A pool of two stocks is paused when either is.
The oracle registry's paused flag is no token pause: during a corporate action the feed freezes
while transfers go on.

A stock pool whose snapshot has `transfersPaused = true` is unrated with reason
`transfers-paused`, tested after `hooked` and before `unpriced`. Its depth, spread and deviation
are published as measured, since they describe the pool, but no trade can use them, so, like a
stale quote, it is left out of the depth sums (`GET /api/stats`, the Home headline, a token's
`depth2UsdTotal`, the depth butterfly's totals and shares) and out of the stock's aggregates
below.

## Stock aggregates

**Question.** For one stock, across every pool that trades it: how much depth is there, what does
a trade cost, on which venues, and how far is the deepest pool from the reference?

The stock's pools are the scored pools holding it, each as the pool lists show it (its newest
snapshot and score: `tvlUsd`, the ±2 % sides, the $10k spread under the cap, `staleQuote`,
`volume24hUsd`, and the snapshot's reference deviation). A pool **counts** when its quote is not
stale, its snapshot's `transfersPaused` is not `true`, and no newer reading of its stock (of
either stock, in a pool of two) has `transfersPaused = true`: a stale or paused pool's depth and
spread are measured at a price, or in a pool, that no trade reaches. A pool's newest snapshot can
be older than the stock's newest reading (its state read failed on the pass that read the stock),
and a pause takes effect at the block it is set, so the newer reading decides; one that finds the
transfers resumed lifts no snapshot's pause, and such a pool counts again from its next snapshot.

**The stock's sides.** A pool's ±2 % levels are its own (token1 per token0). For the stock:
- `buyUsd` is the side whose input is the quote: `depth2UpUsd` when the stock is token0,
  `depth2DownUsd` when it is token1.
- `sellUsd` is the other side, the stock as input, valued at the stock's USD price.

In a pool whose stock is token1, the down level (−2 % of token1 per token0) raises the stock's
price by 2.04 % (`1 / 0.98 − 1`) and the up level lowers it by 1.96 %: the levels are the pool's,
not simulated again.

**Aggregates** (`summarizeStock`):
- `poolCount`: the stock's pools.
- `tvlUsd`: Σ `tvlUsd` of the pools whose TVL is known (`tvlKnownPools`); `null` when none is. A
  Uniswap v4 pool's TVL is unknown (see [TVL](#tvl)), so a sum without it is a lower bound.
- `depth2BuyUsd`, `depth2SellUsd`: Σ `buyUsd` and Σ `sellUsd` over the counted pools whose two
  sides are known (`sidesKnownPools`); both `null` when there is none.
- `spread10kBps`: the lowest feasible $10k spread among the counted pools, with its pool
  (`spread10kPoolId`, ties to the lower pool id); `null` when none is feasible. A round trip has
  both legs, so no side applies.
- `volume24hUsd`: Σ `volume24hUsd` of the pools whose volume is known (`volumeKnownPools`), counted
  or not, since it is what traded; `null` when none is.
- `venues`: one row per DEX (in `DEXES` order) holding at least one of the stock's pools, with
  `poolCount`; `depth2Usd`, Σ (`buyUsd + sellUsd`) over its pools in the depth sums (`null` when
  none is); `depthShare = depth2Usd / (depth2BuyUsd + depth2SellUsd)`, 0..1 (`null` when its
  `depth2Usd` is `null` or the total is 0); `volume24hUsd`, Σ of its known volumes (`null` when
  none is known); `volumeShare = volume24hUsd / Σ` of the venues' known volumes, 0..1 (`null` when
  its volume is unknown or the total is 0).
- `deepestPoolId`: among the pools in the depth sums, the one with the largest
  `min(buyUsd, sellUsd)`, ties to the larger `buyUsd + sellUsd`, then to the lower pool id; `null`
  when there is none. The thinner side decides, as for price routes: a pool deep on one side only
  holds a price arbitrage has left behind.
- `deviationBps`, `withinTolerance` and `deviationNull`: the deepest pool's (see
  [Reference deviation](#reference-deviation)); without a deepest pool `deviationBps` and
  `withinTolerance` are `null` and `deviationNull = 'no-pool'`. A deepest pool whose snapshot has no
  reference (one stored before stock readings existed) gives `deviationNull = 'unread'`.

The stock's reading (`referenceUsd`, `referenceStatus`, `feedAgeSeconds`, `transfersPaused`, the
multiplier) is its newest. While the stock's transfers are paused (its newest reading's
`transfersPaused` is `true`) none of its pools counts, however old its snapshot: its depth, spread
and deviation read `null` (`no-pool`) and its TVL and volume are unchanged.

**Two depth totals for one token.** A stock's token page and its stock page both show ±2 % depth,
by two definitions. The token page's `depth2UsdTotal` ("A token's depth" under
[Depth at ±p %](#depth-at-p-)) sums each pool's `depth2Usd`, both sides together, so a pool with
one side unpriced counts with its known side, and `depthKnownPools` counts those pools. The stock
page splits buy from sell, so both sums must cover the same pools: it counts only pools whose two
sides are known, and its count is `sidesKnownPools`. The two totals agree when every counted pool
of the stock has both sides priced, as it has whenever its quote and the stock are priced, and
each pool's newest snapshot is at the stock's newest reading: the token page reads a pause from
each pool's own score, so a pool whose snapshot predates a pause stays in its total until that
pool is snapshotted again.

**Worked example.** NVDAc is token1 in four pools (quotes USDC and, in P2, WETH):

| Pool | DEX               | Up (sell) | Down (buy) | TVL        | $10k spread | 24 h volume | Stale |
| ---- | ----------------- | --------- | ---------- | ---------- | ----------- | ----------- | ----- |
| P1   | `aero-slipstream` | $260,000  | $250,000   | $1,500,000 | 30 bps      | $400,000    | no    |
| P2   | `uniswap-v3`      | $40,000   | $50,000    | $200,000   | 120 bps     | $100,000    | no    |
| P3   | `uniswap-v4`      | $10,000   | $10,000    | `null`     | 80 bps      | `null`      | no    |
| P4   | `aero-v2`         | $3,000    | $0         | $5,000     | infeasible  | $0          | yes   |
- `tvlUsd = $1,705,000` (`tvlKnownPools = 3`; a lower bound, P3's TVL is unknown).
- `depth2BuyUsd = 250,000 + 50,000 + 10,000 = $310,000`, `depth2SellUsd = 260,000 + 40,000 +
  10,000 = $310,000`, `sidesKnownPools = 3` (P4 is a stale quote).
- `spread10kBps = 30` (P1); `volume24hUsd = $500,000` (`volumeKnownPools = 3`).
- Venues: `aero-slipstream` $510,000 of depth (0.8226) and $400,000 of volume (0.8);
  `uniswap-v3` $90,000 (0.1452) and $100,000 (0.2); `uniswap-v4` $20,000 (0.0323), volume `null`;
  `aero-v2` depth `null` (its pool is stale) and volume $0 (0).
- Deepest: P1, whose thinner side holds $250,000 against $40,000 and $10,000; the stock's
  deviation is P1's: +25.06 bps, within tolerance, if P1 is the pool of the reference example.
- Were NVDAc's transfers paused, no pool would count: depth, spread and deviation `null`
  (`no-pool`), `tvlUsd` and `volume24hUsd` unchanged.

## Swap checks

**Question.** Before a swap in the pool being viewed is signed: what is the least it can return,
what does it cost against the pool's own price, and should it be sent at all?

These figures belong to the dashboard's optional swap panel, a single-pool exact-input swap that
stays switched off unless the site's `trade` flag turns it on. They come from a live quote read
just before signing, never from the snapshot, which serves only as a wide sanity bound. Amounts are
raw `bigint` units of each token, so 6-, 8- and 18-decimal tokens go through the same arithmetic;
prices are exact fractions of raw token1 per raw token0 (for a concentrated pool,
`sqrtPriceX96² / 2^192`), and every bound is compared exactly.
- **Minimum received.** `minOut = floor(quote × (10 000 − s) / 10 000)`, with `s` the slippage
  tolerance in whole bps: 50 by default, accepted from 1 to `min(maxSlippageBps, 300)`, where
  `maxSlippageBps` comes from the trade flag and 300 is a ceiling no flag can raise. Rounded down,
  so the bound is at most one raw unit below the exact tolerance. A `minOut` of 0 protects nothing
  and is refused.
- **Deadline.** The latest block's timestamp + 300 s, from the chain rather than the browser's
  clock.
- **Price impact**, fees included, is the effective spread's leg impact (see
  [Effective spread](#effective-spread-at-n-usd)) applied to the live quote. With `avg` the trade's
  average price (token1 per token0) and `mid` the pool's price just before the trade, read at the
  quote's block: selling token0, `impact = 1 − avg / mid`; buying token0, `impact = avg / mid − 1`.
  It is shown in whole bps rounded up, so the figure is above a threshold exactly when the impact
  is. A warning above 100 bps (1 %), a refusal above 500 bps (5 %). A quote cannot beat its own
  pool's mid at the same block (the fee is taken and every step rounds in the pool's favour), so an
  impact below −500 bps means the quote and the mid come from different states, and is refused.
- **Deviation** of the pool's mid `m` (its price before the trade, read at the quote's block) from a
  reference price `r` is `max(m, r) / min(m, r) − 1`, which does not depend on which price is the
  reference or which token is token0. Refused above 200 bps from the mid of another live pool of
  the same pair read at the same block, and above 1,000 bps from the snapshot's price of this pool,
  which can be three hours old. A pool without a snapshot price is refused. Both compare prices
  before the trade, so they are the same at any amount and in both directions: they catch a pool
  whose own price is wrong or has been pushed away from the market, while the fee and the trade's
  own impact are bounded by the price impact, which includes them.
- **Size.** The input and the quoted output are valued at their tokens' snapshot USD prices (see
  [USD prices](#usd-prices)) and the larger value counts, so a stale low price on one token cannot
  slip a large trade under the cap. Refused above the flag's `maxUsd` ($1,000 at launch), and when
  neither token has a USD price.
- **Decision.** One of ok, warn with a reason, or refuse with a reason. The checks run in a fixed
  order and the first refusal wins: flag limits, amount, slippage, quote, pool mid, size, price
  impact, snapshot deviation, live-pool deviation. With no refusal, a price impact above 100 bps
  gives a warning; otherwise the trade is ok. Every bound is "above": a value exactly at it passes.

**Worked example.** The WETH/USDC pool of the depth and spread examples (1,000 WETH as token0,
2,500,000 USDC as token1, 0.30 %), with the mid and the snapshot price at 2,500, `maxUsd` $1,000 and
the default slippage.
- Sell 0.4 WETH (`400000000000000000` wei, $1,000). The quote is `996602554`, 996.602554 USDC, so
  `avg = 2,491.51` and the impact is `1 − 2,491.51 / 2,500 = 33.97` bps, shown as 34.
  `minOut = floor(996,602,554 × 9,950 / 10,000) = 991,619,541` (991.619541 USDC). The size is
  `max($1,000, $996.60) = $1,000`: at the cap, allowed. The pool's mid equals the snapshot price,
  so the deviation from the snapshot is 0 bps. Decision: ok. One wei more (`400000000000000001`) is
  above the cap and refused.
- Buy with 1,000 USDC: 0.398641021960442175 WETH, `avg = 2,508.52`, an impact of 34.09 bps (shown
  as 35), `minOut = 396647816850639964` wei. Decision: ok.
- The same 0.4 WETH into a pool of 40 WETH and 100,000 USDC returns 987.158034 USDC: an impact of
  128.42 bps, a warning. Into 8 WETH and 20,000 USDC it returns 949.659475 USDC: 503.41 bps,
  refused.
- If another live WETH/USDC pool reads 2,451, the pool's mid of 2,500 is 199.92 bps from it and
  both trades pass; at 2,450 it is 204.08 bps away (shown as 205) and both are refused. A snapshot
  price of 2,273 is 998.68 bps away and passes; one of 2,272 is 1,003.52 bps away and refused.
- The same reserves with a 2 % fee: selling 0.1 WETH returns 244.975992 USDC, an impact of
  200.96 bps, and buying with 250 USDC returns 0.097990396941099772 WETH, 205.08 bps: warnings.
  With another live pool at 2,530, 120 bps from the mid, both are allowed, though the sale's
  average price is 327.54 bps from 2,530.

## Why these metrics

For a **market maker**, the question is what it will be quoting into. Depth at a percentage move
is the inventory the pool can absorb before the quote is gone, per side, which is the number in
every mandate ("maintain $X within ±2 %"). The effective spread ladder is what a taker actually
pays at the sizes that matter, fees included, so it is comparable across fee tiers and pool types.
Range and owner concentration say whether the depth is one position that can be withdrawn in a
single transaction, and whether the "pool" is really one counterparty. Persistence turns a point
reading into a track record: a pool that is deep at snapshot time but empty for a tenth of the day
is not deep.

For a **protocol team**, the same numbers answer whether their token is tradeable at size, whether
a market maker is delivering what was agreed, and where to direct incentives: the gaps feed is a
ranked list of pools where a day's volume outruns the ±2 % depth, so that added depth carries the
most trading per dollar. It ranks turnover, not fee income, which also depends on the fee tier
(see [Gap score and the gaps feed](#gap-score-and-the-gaps-feed)). The health score exists so
that a list of thousands of pools can be sorted; the components exist so that nobody has to trust
the score.

All of this is computed from public pool state with the contracts' own math, so any reading can be
reproduced by anyone with an RPC endpoint and this page.

## Where each metric lives

| Metric                   | Module                                              | Function(s)                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Depth                    | `packages/core/src/metrics/depth.ts`                | `computeDepth`, `depthToUsd`                                                                                                                                                |
| Effective spread         | `packages/core/src/metrics/spread.ts`               | `computeEffectiveSpread`, `feasibleSpreadBps`, `SPREAD_MAX_LEG_IMPACT_BPS`                                                                                                  |
| Concentration            | `packages/core/src/metrics/concentration.ts`        | `computeConcentration`, `computeConcentrationForReserves`, `bandSqrtBounds`                                                                                                 |
| Persistence              | `packages/core/src/metrics/persistence.ts`          | `computePersistence`, `PERSISTENCE_MIN_COVERAGE`                                                                                                                            |
| Health score, rating     | `packages/core/src/metrics/health.ts`               | `computeHealthScore`, `healthGrade`, `rateDepth`, `isHookedPool`, `HEALTH_RATING_MIN_SIDE_USD`, `HEALTH_MAX`, `OWNER_COVERAGE_MIN`, `ownersCoverPool`, `poolOwnerTop1Share` |
| Gap score                | `packages/core/src/metrics/gap.ts`                  | `computeGap`, `GAP_FEED_MIN_VOLUME_USD`, `MEANINGFUL_GAP_TURNOVER`, `isMeaningfulGap`                                                                                       |
| TVL                      | `packages/core/src/metrics/tvl.ts`                  | `tvlUsd`                                                                                                                                                                    |
| 24 h volume              | `packages/core/src/metrics/volume.ts`               | `volumeWindow`, `scoringVolumeWindow`, `computeVolume24hUsd`                                                                                                                |
| USD prices               | `packages/core/src/pricing.ts`                      | `derivePrices` (edge weights in USD at relaxation); edges in `apps/cli/src/pipeline/prices.ts` (`buildPriceEdges`)                                                          |
| Stale quotes             | `packages/core/src/metrics/depth.ts`                | `priceDeviationBps`, `isStaleQuote`, `STALE_QUOTE_MIN_DEVIATION_BPS`                                                                                                        |
| Reference deviation      | `packages/core/src/stocks/reference.ts`             | `evaluateStockReading`, `referenceUsdPerToken`, `poolReference`, `quoteRouteAvoids`, `REFERENCE_AGE_GRACE_SECONDS`; `weeklyCloseAt` in `stocks/hours.ts`                    |
| Stock tradability        | `packages/core/src/stocks/reference.ts`             | `decodePausedFeatures`, `isTransferPaused`; `rateDepth` (`transfersPaused`) in `metrics/health.ts`                                                                          |
| Stock aggregates         | `packages/core/src/stocks/aggregate.ts`             | `summarizeStock`, `stockSides`, `countsInStockSums`                                                                                                                         |
| Swap checks              | `packages/core/src/trade/`                          | `checkTrade`, `minAmountOut`, `validateSlippageBps`, `tradeDeadline`, `tradePriceImpact`, `tradePriceDeviation`, `tradeSizeAboveUsd`                                        |
| Swap simulation          | `packages/core/src/swap/`                           | `simulateSwapExactIn`, `simulateSwapToPrice`, `midPrice`, `swapFeePips`, `v4SwapFeePips`                                                                                    |
| Dynamic fees             | `packages/core/src/dex.ts`                          | `hasDynamicFee`, `DYNAMIC_FEE_DEXES`                                                                                                                                        |
| Token labels             | `packages/core/src/tokenLabel.ts`                   | `tokenLabel`, `buildSharedSymbols` (DESIGN.md, "Shared types")                                                                                                              |
| Tick and sqrt-price math | `packages/core/src/tickMath.ts`, `sqrtPriceMath.ts` | `getSqrtRatioAtTick`, `getTickAtSqrtRatio`, `sqrtPriceX96ToPrice`, `priceToSqrtPriceX96`                                                                                    |
