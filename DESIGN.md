# Depthwatch design (the contract between packages)

Depthwatch is an open liquidity observatory for **Base mainnet only**. It indexes Uniswap v3,
Uniswap v4, Aerodrome (v2 AMM + Slipstream concentrated) and Aero (v2 AMM + Slipstream
concentrated; Aerodrome and Velodrome merged into Aero on 2026-10-21) pools: every pool of those factories
with log discovery (`discover`), or the pools between the reference tokens (and any
`--seed-token`) with `discover --seed`. It publishes per pool:
- **Depth at ±1 / 2 / 5 %**: how much capital it takes to move the price by that much, each side.
- **Effective spread** at $1k / $10k / $100k / $1M round-trip notional, fees included.
- **LP concentration**: structural (tick-range HHI) and ownership (top-1 / top-3 share, HHI over owners).
- **Liquidity persistence** over 24 h / 7 d from stored snapshots.
- A **Liquidity Health Score** (0–100; a grade A–F for _rated_ pools, those whose thinner ±2 % side holds at least
  $5,000) and a **liquidity gaps feed** (real volume, thin depth).

Depthwatch measures and does not trade on its own account: no trading capital, no token, no
custody, no fee added to swaps. It is indexing, analytics and a dashboard. The dashboard's optional
swap panel, off unless the site's operator switches it on (`features.trade`, "Dashboard
(apps/web)"), lets a visitor swap in the pool they are viewing, from their own wallet, straight to
that pool's router; it never routes or recommends a pool. Each swap carries Depthwatch's Builder
Code (ERC-8021), which lets Base attribute the transaction onchain; the code adds no fee, only 29
bytes of calldata (a negligible amount of gas).

## Repository layout (pnpm workspace, TypeScript, ESM, Node ≥ 22.13)

| Path             | Package             | Responsibility                                                                 | May import                                                                   |
| ---------------- | ------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `packages/core`  | `@depthwatch/core`  | Pure math and scoring. **Zero I/O, zero runtime deps.**                        | nothing                                                                      |
| `packages/chain` | `@depthwatch/chain` | viem adapters for Base: discovery, state, positions, swaps, fixture transport. | core, viem                                                                   |
| `packages/db`    | `@depthwatch/db`    | `node:sqlite` schema, migrations, repositories.                                | core                                                                         |
| `apps/api`       | `@depthwatch/api`   | Hono REST API + static serving of the built dashboard.                         | core, db, hono, @hono/node-server, zod                                       |
| `apps/web`       | `@depthwatch/web`   | Vite + React 19 dashboard. Reads `/api` or the bundle; swaps use the wallet.   | core, chain, react, react-dom, react-router-dom, @tanstack/react-query, viem |
| `apps/cli`       | `@depthwatch/cli`   | `depthwatch` CLI: the pipeline (discover → snapshot → volume → score → serve). | every workspace package, viem, tsx                                           |

"May import" lists each package's `dependencies` in its `package.json`: workspace packages by their
short name, others by their npm name; build and test tools (Vite, Vitest, Biome, TypeScript, jsdom,
Testing Library, `@types/*`) are `devDependencies`, used to build and test, never by the code that
runs. `apps/api/src/routes/docs.test.ts` fails when a dependency is missing from its row.
`apps/web` imports `chain` only through its browser-safe `@depthwatch/chain/addresses` entry (below),
and `viem` only in the lazy swap panel (`src/trade/`): the panel reads the chain and sends
transactions through the reader's own wallet (EIP-1193), and ABI encoding, the wallet's JSON-RPC
and EIP-5792 calls are what viem does and the standard library does not; viem was already in the
lockfile for `chain`. `ox` is a `devDependency` of `apps/web` only, pinned to 0.14.57, for the test
that checks the Builder Code suffix against `Attribution.toDataSuffix`.

Package entry points are `src/index.ts` (no build step for Node packages; `tsx` runs TypeScript
directly, a dependency of `apps/cli` so that the server image runs the sources the same way).
`@depthwatch/chain` has a second, browser-safe entry, `@depthwatch/chain/addresses`
(`src/addressesExport.ts`): the addresses, the trade routes and token allowlist and the trade ABIs,
with no viem client, transport or `node:` import (the package barrel pulls `node:crypto`);
`addressesExport.test.ts` walks its module graph.
Lint/format: Biome (`pnpm lint`). Types: `pnpm typecheck`. Tests: Vitest (`pnpm test`). All three must pass.

Rules for contributors (human or agent):
1. **Do not add dependencies** without updating this file; the lockfile is shared. Core has none.
2. Addresses are lowercase. Never compare addresses case-sensitively.
3. Raw token amounts are `bigint`. Do not convert to `number` until the final human-facing step.
4. Tests never touch the network. Chain code is tested through the fixture transport.
5. Every metric is defined once, in `docs/METRICS.md`, and implemented once, in core.

## Shared types

`packages/core/src/types.ts` is the single source of truth.
Key conventions it encodes:
- `PoolMeta.id` = `${dex}:${poolAddressLowercase}` or `uniswap-v4:${poolId}`.
- `Dex` is `uniswap-v3 | uniswap-v4 | aerodrome-v2 | aerodrome-slipstream | aero-v2 | aero-slipstream`;
  `DEXES` lists them in that order (stats rows, the API's `dex` enum, swap-scan grouping). Aero's
  factories are not Aerodrome's, so its pools get ids of their own (`aero-v2:<pool>`,
  `aero-slipstream:<pool>`) and discovery and seed cursors of their own; both platforms are indexed.
- `price` = token1 per token0, decimal-adjusted. From `sqrtPriceX96`:
  `priceRaw = (sqrtPriceX96 / 2^96)^2` (token1 raw per token0 raw) and `price = priceRaw * 10^(dec0 − dec1)`.
- Fees in pips (1e-6). Aerodrome v2 `getFee()` and Aero v2 `getBaseFee()` return bps → ×100. `feePips` is the LP fee (shown for the pool);
  a Uniswap v4 `ConcentratedState` also carries `protocolFeePips: { zeroForOne, oneForZero }` from slot0, and its swaps
  pay `swapFeePips` = protocolFee + lpFee − ⌊protocolFee·lpFee / 1e6⌋ per direction (docs/METRICS.md, Conventions).
- `PoolMeta.feePips` is the fee as last read: at discovery or seeding until the pool's first snapshot, then the latest
  snapshot's (discovery and seeding no longer change it); `PoolSnapshot.feePips` is the fee that snapshot's depth and spread used (`null` in rows stored before schema version 7). `hasDynamicFee(pool)`
  (core `dex.ts`) is true for `aerodrome-slipstream` and `aero-slipstream`, whose `fee()` can change every block.
- `PoolMeta.stable` marks Aerodrome v2 and Aero v2 stable pools. `PoolMeta.hooks` is a Uniswap v4 pool's hooks address,
  or an Aero Slipstream pool's swap hook when it is not its deployment's reviewed `swapHook` or charges each block's
  first transaction an initial fee (`initialFeeEnabled`); otherwise null. A non-zero `hooks` is hooked (`isHookedPool`).
- A symbol is not an identity (Aerodrome's and Aero's AERO both answer "AERO"); the address is. `tokenLabel(token,
  shared)` (core `tokenLabel.ts`) names a token for display: its symbol when no other address in the index `shared`
  (`buildSharedSymbols`) holds that symbol, else `SYMBOL (name)` when no other address holds symbol and name, else
  `SYMBOL (0x3f5b…a4ee)`. The token itself need not be in the index, so a token outside it is still told apart.
  `withTokens(shared, tokens)` is a copy of the index with `tokens` added (a pool's two tokens that share a symbol).
- `Mandate.alertWebhookUrl` is private: every public surface (API, export, dashboard) uses `PublicMandate`
  (`toPublicMandate`), which has `alertWebhookConfigured: boolean` instead.
- `DepthLevel.up` is the token1 needed to push the price up by pct (buy pressure on token0);
  `DepthLevel.down` is the token0 needed to push it down (sell pressure).
- `PriceEdge` carries either a pool's ±2 % depth sides (`upToken1`, `downToken0`: human token1 and token0 amounts),
  weighed in USD by `derivePrices` when it reaches the edge, or a fixed `weight` (the ETH ↔ WETH wrap edge).
- `UnratedReason` is `'hooked' | 'unpriced' | 'one-sided' | 'thin'`; `HealthInputs.hooked` (optional, default false) marks
  a hooked pool (`isHookedPool`), whose `PoolSnapshot` holds no depth levels, spread points or concentration.
- `PoolSnapshot.priceDeviationBps` is the stale-quote measure (docs/METRICS.md, Stale quotes): `null` when a token has
  no USD price, and in snapshots stored before the field existed.
- `FeatureFlags` is the static bundle's optional `features` block and, exactly, `data/flags.json`: `{ trade: TradeFlags }`
  with `TradeFlags = { enabled: boolean, venues: Dex[], maxUsd: number, maxSlippageBps: number }` (`TradeLimits` holds the
  two limits). Written by `depthwatch export` from `DEPTHWATCH_TRADE`, read by the dashboard; every reader fails closed
  (core `parseTradeFlags`, `parseFlagsFile`): a block that is missing or not exactly this shape is off, and a swap needs
  both reads on for its venue (`combineTradeFlags`, `tradeOnFor`).

## Core math (packages/core)

Modules and exported functions (names are part of the contract; implementations may add more):

```ts
// sqrt-price / tick helpers (exact integer math matching Uniswap's TickMath/SqrtPriceMath)
getSqrtRatioAtTick(tick: number): bigint
getTickAtSqrtRatio(sqrtPriceX96: bigint): number
sqrtPriceX96ToPrice(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number
priceToSqrtPriceX96(price: number, decimals0: number, decimals1: number): bigint

// swap simulation over any PoolState (fees included, rounding in the pool's favour like the contracts)
simulateSwapExactIn(state: PoolState, direction: SwapDirection, amountIn: bigint): SwapResult
simulateSwapToPrice(state: PoolState, targetPrice: number /* human, token1 per token0 */, decimals: { decimals0: number; decimals1: number }): SwapResult
//   direction is implied by whether targetPrice is above (oneForZero) or below (zeroForOne) the current price.
//   `decimals` (required) turns the human target into the pool's raw price for concentrated and constant-product
//   pools; stable pools carry their own decimals in the state and ignore the argument (like midPrice).

// metrics
computeDepth(state: PoolState, decimals0: number, decimals1: number, pcts?: readonly number[]): DepthLevel[]
depthToUsd(levels: DepthLevel[], token0: TokenInfo, token1: TokenInfo, token0Usd: number | null, token1Usd: number | null): DepthLevelUsd[]
computeEffectiveSpread(state: PoolState, token0: TokenInfo, token1: TokenInfo, token0Usd: number | null, token1Usd: number | null, notionalsUsd?: readonly number[]): SpreadPoint[]
computeConcentration(state: ConcentratedState, positions: Position[] | null, bandPct?: number, excludedOwners?: readonly string[]): ConcentrationMetrics // excludedOwners: custodians (a Slipstream gauge), uncovered
computeConcentrationForReserves(state: ConstantProductState | StableSwapState): ConcentrationMetrics   // rangeHhi = 1, activeRangeShare = 1, owners null (or from LP token holders when provided later)
computePersistence(samples: Array<{ timestamp: number; depthUsd: number | null }>, windowHours: number, now: number): PersistenceMetrics
computeHealthScore(inputs: HealthInputs): HealthScore   // inputs: depth2UpUsd, depth2DownUsd, spread10kBps, ownerTop1Share, ownerCoverage, rangeHhi, poolKind, persistence, hooked?; HealthScore.concentrationBasis: 'owners' | 'ranges' | 'neutral' (null only when read from a score stored before it)
rateDepth(upUsd: number | null, downUsd: number | null, opts?: { hooked?: boolean }): { rated: boolean; unratedReason: UnratedReason | null }
isHookedPool(pool: Pick<PoolMeta, 'hooks'>): boolean // a non-zero hooks address (Uniswap v4 hook; Aero Slipstream off its reviewed swap hook)
ownersCoverPool(owners: OwnerConcentration | null | undefined): boolean // count > 0 and coverage ≥ OWNER_COVERAGE_MIN (0.9)
poolOwnerTop1Share(owners: OwnerConcentration | null | undefined): number | null // top1Share when ownersCoverPool, else null
priceDeviationBps(price: number, token0Usd: number | null, token1Usd: number | null): number | null // |price / (token0Usd / token1Usd) − 1| × 1e4
isStaleQuote(deviationBps: number | null): boolean // deviationBps ≥ STALE_QUOTE_MIN_DEVIATION_BPS (500)
feasibleSpreadBps(point: SpreadPoint | undefined, mid: number): number | null // a stored point under today's cap
computeGap(volume24hUsd: number | null, depth2Usd: number | null): GapMetrics
volumeWindow(dataEndTs: number, hours?: number): VolumeWindow // [H − 24 h, H), H = start of the hour holding dataEndTs
scoringVolumeWindow(dataEndTs: number | null, now: number): VolumeWindow | null // null without a volume pass of the last 24 h
computeVolume24hUsd(window: VolumeWindow | null, coveredFromTs: number | null, buckets): number | null // 0 when covered and untraded
tvlUsd(reserve0: bigint, reserve1: bigint, token0: TokenInfo, token1: TokenInfo, token0Usd: number | null, token1Usd: number | null): number | null

// pricing (pure graph over observed pool prices)
derivePrices(edges: PriceEdge[], anchors: Record<Address, number>): Map<Address, DerivedPrice>
//   Widest-path (max-bottleneck) search from the anchors (USDC = 1, other stables = 1) so that USD prices
//   come through the deepest route. Tokens unreachable from any anchor are absent. A pool edge carries its ±2 % depth
//   sides and is weighed when the search reaches it from a settled token: min(up × token1Usd, down × token0Usd), the
//   settled side at its USD price and the other at the price the edge implies, so a one-sided pool is no route and
//   the weight is in USD in one pass. The CLI builds the edges (apps/cli/src/pipeline/prices.ts); hooked pools are none.

// Uniswap v4 fees (swap/protocolFee.ts)
decodeV4ProtocolFee(packed: number): ProtocolFeePips // low 12 bits zeroForOne, high 12 bits oneForZero
v4SwapFeePips(protocolFeePips: number, lpFeePips: number): number
swapFeePips(state: ConcentratedState, direction: SwapDirection): number // what the swap walk charges

// DEX facts and token labels (dex.ts, tokenLabel.ts)
hasDynamicFee(pool: { dex: string }): boolean // dex in DYNAMIC_FEE_DEXES: 'aerodrome-slipstream', 'aero-slipstream'
buildSharedSymbols(tokens: Pick<TokenInfo, 'address' | 'symbol' | 'name'>[]): SharedSymbols // symbolKey / symbolNameKey → addresses
tokenLabel(token: Pick<TokenInfo, 'address' | 'symbol' | 'name'>, shared: SharedSymbols): string
withTokens(shared: SharedSymbols, tokens: Pick<TokenInfo, 'address' | 'symbol' | 'name'>[]): SharedSymbols // a copy with tokens added

// swap checks of the dashboard's single-pool exact-input swap (trade/; docs/METRICS.md, "Swap checks")
checkTrade(input: TradeCheckInput): TradeDecision // ok | warn (price-impact-high) | refuse with the first failed check
minAmountOut(quotedAmountOut: bigint, slippageBps: number): bigint // floor(quote × (10 000 − s) / 10 000)
tradeDeadline(latestBlockTimestamp: bigint, windowSeconds?: bigint): bigint // + TRADE_DEADLINE_SECONDS (300)
validateSlippageBps(value: number | undefined, flagMaxBps: number): SlippageCheck // default 50, ceiling min(flag, 300)
effectiveMaxSlippageBps(flagMaxBps: number): number | null
tradePriceImpact(direction, amountIn, amountOut, mid: Fraction): Fraction | null
tradeEffectivePrice(direction, amountIn, amountOut): Fraction | null // raw token1 per token0, fee and impact included
tradePriceDeviation(price: Fraction, reference: Fraction): Fraction | null
sqrtPriceX96ToRawPrice(sqrtPriceX96: bigint): Fraction | null
humanPriceToRawPrice(price: number, decimals0: number, decimals1: number): Fraction | null
tradeSizeUsd(amounts: readonly UsdPricedAmount[]): number | null
tradeSizeAboveUsd(amounts: readonly UsdPricedAmount[], maxUsd: number): boolean | null
parseTradeFlags(value: unknown): TradeFlags | null // exactly the exported shape, else null (off)
parseFlagsFile(value: unknown): TradeFlags | null // data/flags.json: exactly { trade }, else null
combineTradeFlags(atLoad: TradeFlags | null, live: TradeFlags | null): TradeFlags // on only when both are
tradeOnFor(flags: TradeFlags, venue: Dex): boolean
tradeOff(): TradeFlags // off, with the launch limits

// test helpers (exported from core for other packages' tests)
buildConcentratedState(opts: { positions: Array<{tickLower, tickUpper, liquidity}>; tick; feePips; tickSpacing; blockNumber?; timestamp? }): ConcentratedState
```

### Concentrated-liquidity swap walk (must match Uniswap v3 semantics)

- Fee is taken from amountIn before the price move (`amountInLessFee = amountIn * (1e6 − fee) / 1e6`), with `fee` the
  direction's swap fee: `feePips`, or on Uniswap v4 `swapFeePips(state, direction)` (LP fee combined with the protocol fee).
- Within a tick range with liquidity L, moving from √Pa to √Pb (Q64.96):
  Δtoken1 = L · (√Pb − √Pa) / 2^96 (round up for input), Δtoken0 = L · (√Pb − √Pa) · 2^96 / (√Pa · √Pb) (round up for input, down for output).
- At an initialized tick crossing, apply `liquidityNet` (add when moving up, subtract when moving down).
- Steps stop where the contract's do: at the next initialized tick _or_ the edge of the current tick-bitmap
  word (256 × tickSpacing ticks, `TickBitmap.nextInitializedTickWithinOneWord`), whichever comes first. A word
  edge is an uninitialized stop that runs `computeSwapStep` again; since every step rounds on its own, skipping
  it would differ from on-chain amounts by a few wei.
- A 100 % fee (Uniswap v4 `MAX_LP_FEE = 1_000_000`) is valid: exact-in turns the whole input into fee without
  moving the price (v4 `SwapMath`); swap-to-price reports `complete = false` with zero amounts.
- Walk stops at the target price, when amountIn is exhausted, or at the bound; `complete` is false at the bound.
  A range with zero liquidity inside the known bounds is crossed at no cost, as the contract's `computeSwapStep`
  crosses it: an exact-input walk consumes nothing there and goes on (to the bound, if no liquidity follows), and a
  swap-to-price walk reaches a target past it (`complete = true`, the amounts those of the last range with
  liquidity). Depth's `reached` is this `complete` (docs/METRICS.md, Depth).
- Ticks beyond `tickLowerBound`/`tickUpperBound` are unknown: never extrapolate.

### Constant product (Aerodrome v2 and Aero v2 volatile)

`amountOut = reserveOut · amountInAfterFee / (reserveIn + amountInAfterFee)`.
Depth to price target: solve for amountIn that moves the marginal price `reserve1/reserve0` to the target (closed form).

### Stable swap (Aerodrome v2 and Aero v2 stable)

Invariant `k = x³y + xy³` on 1e18-normalised reserves; `getAmountOut` solves y numerically with Newton
iterations exactly like the contract's `_get_y` (converging to 1 wei of normalised units). Depth to a price
target is an exact bisection over the gross amountIn on the analytic marginal price `dy/dx` of the post-trade
reserves: the result is the smallest input (to 1 wei of the input token) whose post-trade price passes the
target. Where the contract would revert (`_get_y` non-convergence, or reserves so small that `_d` floors to 0,
as in a drained pool) the simulators return `complete = false` with zero amounts instead of throwing.

### Metric definitions (mirrored in docs/METRICS.md)

- **Fee**: depth and spread use the LP fee the state carries, read at the snapshot's block (`PoolSnapshot.feePips`; a
  Slipstream pool's is a per-block reading, docs/METRICS.md Conventions); MEV taxes and per-caller discounts are not modelled.
- **Depth at ±p %**: up = `simulateSwapToPrice(state, mid·(1+p/100), decimals)` with input token1; down = `simulateSwapToPrice(state, mid·(1−p/100), decimals)` with input token0. USD = amountIn × token USD price.
- **Effective spread at N USD**: buy token0 with N USD of token1 (`exactIn oneForZero`), sell N USD of token0 (`exactIn zeroForOne`); `buyAvg = amount1In/amount0Out`, `sellAvg = amount1Out/amount0In` (human prices); `spreadBps = (buyAvg − sellAvg)/mid × 1e4`. Infeasible (null) if either leg is incomplete, either leg yields nothing (`amount0Out = 0` or `amount1Out = 0`), a USD price is missing, or either leg's average price is more than `SPREAD_MAX_LEG_IMPACT_BPS = 5 000` bps (50 %) from mid (`buyAvg/mid − 1`, `1 − sellAvg/mid`): constant-product and stable legs never run out of liquidity, so completeness alone let a dust pool publish 1e24 bps. A feasible spread is at most 10 000 bps.
- **Range HHI**: inside the band [mid·(1−5 %), mid·(1+5 %)] split liquidity into tick ranges between consecutive initialised ticks; weight each range by `L_range × (√Pupper − √Plower)` (≈ token1 value of the range) clipped to the band; `rangeHhi = Σ share²`; `activeRangeShare` = share of the range containing the current tick.
- **Owner concentration**: for each position overlapping the band, weight = `liquidity × clipped (√Pupper − √Plower)`; aggregate by owner; `top1Share`, `top3Share`, `hhi`, `count` (owners with weight > 0); `coverage = min(1, Σ owner weights / poolBandWeight)` (0 when the band holds nothing; `null` when read from a snapshot stored before it). Positions of a custodian (a Slipstream pool's CLGauge, recorded by `positions`) belong to no owner and count as uncovered. The owners describe the pool only with `count > 0` and `coverage ≥ OWNER_COVERAGE_MIN` (`ownersCoverPool`); `poolOwnerTop1Share(owners)` is `top1Share` then and `null` otherwise, and is what a snapshot stores and lists as `ownerTop1Share` (schema version 6 cleared the stored values that break the rule).
- **Persistence (window W hours)**: samples = snapshots in the window with non-null depth2Usd; `stability = clamp(p10/median, 0, 1)`; `uptime = share of samples ≥ 0.5·median`. Both null when samples < 3 or the oldest and newest sample are less than `PERSISTENCE_MIN_COVERAGE = 25 %` of the window apart (6 h of 24 h, 42 h of 7 d); with ≥ 3 samples and a median of 0 both are 0 (a dead pool).
- **Rating**: a pool is _rated_ when both ±2 % sides (`depthUsd[pct = 2].upUsd`, `.downUsd`) are known and the thinner one is at least `HEALTH_RATING_MIN_SIDE_USD = 5 000`; otherwise `grade = null` and `unratedReason` is `hooked` (a hooked pool, `isHookedPool`: no depth, spread or concentration is computed), `unpriced` (a side unknown), `one-sided` (the deeper side holds the floor, the thinner does not) or `thin`, tested in that order. The total and components of an unrated pool are still published.
- **Stale quote**: `priceDeviationBps = |price / (token0Usd / token1Usd) − 1| × 1e4` (null when a token has no USD price); stale when ≥ `STALE_QUOTE_MIN_DEVIATION_BPS = 500`. A stale pool's numbers are published as measured, but its depth is left out of the stats' depth sums and a depth sort puts it last.
- **Health score** (0–100):
  - depth (max 35): `35 · clamp((log10(2 · min(up, down)) − 3) / 3, 0, 1)` → balanced-equivalent $1k = 0, $1M = 35; a one-sided pool scores 0. An unknown side → 0.
  - spread (max 25): `25 · clamp((log10(300) − log10(spread10kBps)) / (log10(300) − log10(10)), 0, 1)` → ≤10 bps = 25, ≥300 bps = 0. Null (infeasible at $10k) → 0.
  - concentration (max 20), recorded as `concentrationBasis`: owners known (`top1Share > 0`) with `ownerCoverage ≥ OWNER_COVERAGE_MIN = 0.9` → `owners`, `20 · (1 − top1Share)`; else a concentrated pool with `rangeHhi` → `ranges`, `20 · (1 − rangeHhi)`; else → `neutral`, 10 with the note "concentration neutral: LP owners not indexed" (a reserve pool) or "concentration neutral: no position or range data". Owners known but not used add "owner data covers X % of in-band liquidity" (X rounded down).
  - persistence (max 20): `20 · (0.5·stability + 0.5·uptime)`; null → 10 with note "persistence neutral: fewer than 3 samples" (or "…: samples cover under 25 % of the window").
  - grade (rated pools only): A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F.
  - `medianHealth` (stats, Home) is the median of `health.total` over rated pools; `rated` counts them next to `scored`.
- **Gap score**: `turnover = volume24hUsd / depth2Usd`; `gapScore = 100 · clamp(log10(turnover) / 2, 0, 1)` (turnover 1× → 0, 100× → 100). Null if volume or depth unknown or depth = 0. The feed lists pools with `volume24hUsd ≥ 10 000` sorted by gapScore desc.

## Chain adapters (packages/chain)

```ts
export interface ChainAddresses {
  /* see src/addresses.ts: factories, managers, lens, reference tokens */
}
export interface PoolOverview {
  pool: PoolMeta
  blockNumber: bigint
  sqrtPriceX96: bigint | null
  tick: number | null
  liquidity: bigint | null // concentrated
  reserve0: bigint
  reserve1: bigint // token balances for TVL (v4: not available cheaply → 0n, use liquidity)
}
export interface ChainReader {
  readonly chainId: 8453
  getLatestBlock(): Promise<{ number: bigint; timestamp: number }>
  getBlockTimestamp(blockNumber: bigint): Promise<number>
  discoverPools(dex: Dex, fromBlock: bigint, toBlock: bigint): Promise<PoolMeta[]> // paginates getLogs in chunks (default 10 000 blocks), resolves token metadata (cached), symbol fallback for bytes32/missing
  seedPools(opts?: SeedPoolsOptions): Promise<SeedResult> // no logs: factory / StateView views for every pair of the token list (default: the reference tokens) at one block (default latest), creation blocks by binary search over archive state (eth_getCode; v4: PoolManager extsload of slot0); same PoolMeta as discoverPools. opts: { dexes, tokens, blockNumber, knownCreatedAt(poolId), concurrency (4), batchSize (50), onPools(pools, { done, total, requests }) per finished batch, onSearchRound, onRetry }; 429 / transient probes back off with the logRetry policy; the DEX seeders run independently: one whose factory views fail is listed in `failed` and the others' pools are still searched and returned (a failed creation-block search still throws); result: { blockNumber, pools, dexes: [{ dex, candidates, found, searched }] (seeded DEXes only), failed: [{ dex, error }], searchRequests, searchRounds }
  refreshPoolMetas(pools: readonly PoolMeta[]): Promise<PoolMeta[]> // stored pools' PoolMeta read again at the head as discovery builds them (stored tokens, tick spacing, creation block kept) for DEXes whose PoolMeta holds a reading the state reads check (Aero Slipstream: `hooks`); other DEXes' pools and pools no factory reports are left out
  readTokens(addresses: Address[]): Promise<TokenInfo[]>
  readOverview(pools: PoolMeta[], blockNumber?: bigint): Promise<PoolOverview[]> // multicall-batched (≤ 500 calls per multicall)
  readState(pool: PoolMeta, opts: { bandPct: number; blockNumber?: bigint }): Promise<PoolState> // tick walk via tickBitmap words ± enough to cover bandPct·2 (at least ±10 %), ticks() per initialised tick, all multicall-batched
  readPositions(pool: PoolMeta, opts: { fromBlock: bigint; toBlock: bigint }): Promise<Position[]> // v3/Slipstream: NFPM IncreaseLiquidity/DecreaseLiquidity/Transfer + positions() (Aero Slipstream: its NFPM's 6-field IncreaseLiquidity); v4: PositionManager; aerodrome-v2, aero-v2: []
  readCustodians(pool: PoolMeta, blockNumber?: bigint): Promise<Address[]> // contracts holding positions for depositors: Slipstream (Aerodrome and Aero) CLPool.gauge() (lowercase; [] without a gauge); other DEXes [] with no request
  readSwaps(
    pools: PoolMeta[],
    fromBlock: bigint,
    toBlock: bigint,
    opts?: { onProgress(p: SwapScanProgress) },
  ): Promise<SwapEvent[]> // one log scan per Swap event source (Uniswap v3 + both Slipstreams share one filter, Aerodrome v2 + Aero v2 another: same event, swapScanOf); timestamps interpolated between anchor headers every timestampSpan blocks (default 10 000), independent of logChunkSize; onProgress after each chunk / backoff: { scans, blocksDone, blocksTotal, chunks, rateLimited, transient }
}
export function createChainReader(opts: {
  rpcUrl?: string // every read but eth_getLogs (default https://mainnet.base.org)
  transport?: Transport // wins over rpcUrl
  logsRpcUrl?: string // eth_getLogs only (default: rpcUrl, or transport when given)
  logsTransport?: Transport // wins over logsRpcUrl
  addresses?: Partial<ChainAddresses>
  logChunkSize?: number | bigint // blocks per eth_getLogs (default 10 000)
  minLogRange?: number | bigint // rejected ranges are split down to min(minLogRange, logChunkSize), default 100
  logRetry?: Partial<LogRetryPolicy> // { retries: 8, baseDelayMs: 1 000, maxDelayMs: 30 000, sleep, onRetry }: the one backoff of every 429 / transient request (eth_getLogs, multicalls, blocks, eth_getCode); onRetry hears eth_getLogs
  onCallRetry?: (event: BackoffEvent) => void // each backoff of a main-endpoint request; the rpcUrl transport has no viem retries
  maxCallsPerMulticall?: number // calls per Multicall3 aggregate3 (default 500)
  maxConcurrentMulticalls?: number // aggregate3 requests one batched read keeps in flight (default 4); its further groups wait, results stay in call order
  timestampSpan?: number | bigint
  onRequest?: (event: RpcRequestEvent) => void // { endpoint: 'main' | 'logs', method }: every request as it is sent, retries included (eth_getLogs counts as logs)
  signal?: AbortSignal // once aborted: in-flight HTTP requests cancelled, backoff waits end, every later request fails at once with signal.reason (never retried)
}): ChainReader
// A logs endpoint that cannot serve logChunkSize (stated maximum or halving below the floor) throws
// LogRangeLimitError { details: { reason: 'stated' | 'floor', maxRange, chunkSize, minRange, fromBlock, toBlock, providerMessage } }
// A rate-limited / transient request (429, timeout, no answer, gateway 408 / 5xx) still failing after logRetry.retries throws
// RetryExhaustedError { what, kind: 'rate-limit' | 'transient', retries, providerMessage, cause }: final, never retried again or split
export function redactUrls(text: string): string // every http(s) / ws(s) URL cut to its origin (RPC URLs carry API keys)
export function errorSummary(error: unknown): string // one line for logs: causes joined, viem errors as status / code / URL origin / method / details, never the request body
export function createFixtureTransport(fixture: Fixture): Transport // deterministic JSON-RPC answers keyed by method+params for tests/demo
export function createRecordingTransport(inner: Transport, sink: Fixture): Transport // records live answers into a fixture (used to produce demo fixtures from a real RPC)
export function observeTransport(
  inner: Transport,
  opts: { endpoint; onRequest?; signal? },
): Transport // what createChainReader applies for onRequest / signal
export function createFakeRpcFetch(fixture: Fixture, opts?: FakeRpcOptions): FakeRpc // { fetch, calls }: a fixture behind viem's real http() transport; replays provider HTTP errors in tests
```

Protocol specifics (addresses live in `src/addresses.ts`, overridable via `createChainReader({ addresses })`):
- Uniswap v3: factory `PoolCreated`, pool `slot0/liquidity/tickBitmap/ticks/fee/tickSpacing`, `Swap`. Position owners via NonfungiblePositionManager.
- Uniswap v4: PoolManager `Initialize` (poolId, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick); state via StateView (`getSlot0`, `getLiquidity`, `getTickBitmap`, `getTickInfo`); `Swap` on PoolManager carries `id`; currency0 == 0x0 is native ETH (TokenInfo symbol `ETH`, 18 decimals).
- Aerodrome v2: PoolFactory `PoolCreated(token0, token1, stable, pool, length)`; `getReserves`, `stable()`, fee from `PoolFactory.getFee(pool, stable)` (bps); `Swap` event.
- Aerodrome Slipstream: CLFactory `PoolCreated(token0, token1, tickSpacing, pool)`; same tick interface as v3 but `ticks()` returns a different struct (ABI in docs/research/base-contracts.md); fee via `fee()`, which the deployment's DynamicSwapFeeModule can change every block.
- Aero v2 (`aero-v2`, `ChainAddresses.aeroV2`): a volatile and a stable PoolFactory. `PoolCreated(token0, token1, pool, length)` has no `stable` flag: one log filter covers both factories and the emitting factory gives the kind; seeding asks `getPool(token0, token1)` of both. `getReserves` and Aerodrome v2's `Swap` (its swaps join that scan); `metadata()` (6 outputs) and `stable()` (reverts) are never read. Fee: `getBaseFee(pool, 0x0, 0, 0, 0, 0)` (bps) on the pool's factory, in the same multicall as its `feeModule()`, which must be `aeroV2.volatileFeeModule` / `stableFeeModule`. LP holdings: the wallet balance plus the gauge from `FactoryRegistry.targetToGauge(pool)` (`balanceOf(owner)`); the LeafVoter has no pool views.
- Aero Slipstream (`aero-slipstream`, `ChainAddresses.aeroSlipstream`, `AeroSlipstreamDeployment` = a Slipstream deployment plus its reviewed `swapHook`): Slipstream's `PoolCreated`, `slot0`, `ticks()`, `positions()` and `Swap` (its swaps join the Uniswap v3 scan); the NFPM's `IncreaseLiquidity` has 6 fields (`aeroNFPMAbi`); `fee()` is the swap hook's fee for the block. Discovery and seeding read `getPoolSwapHook(pool)` and the hook's `dynamicFeeConfig(pool)` and set `hooks` (above); custodians are `CLPool.gauge()`, staked owners resolved with `CLGauge.stakedContains`.
- A state read that finds an Aero pool's configuration changed throws `PoolConfigChangedError` and fails that pool's snapshot: `fee module changed` (an Aero v2 factory's `feeModule()` is not the pinned one) or, for Aero Slipstream, `swap hook changed` / `initial fee enabled` (`isPool`, `getPoolSwapHook` and `dynamicFeeConfig` ride in the state multicall; `hooks ?? swapHook` must answer, and `initialFeeEnabled` must be false when `hooks` is null). `discover --seed` reads the hook of every stored Aero Slipstream pool again, seeded pair or not (`refreshPoolMetas`), so a changed hook stores the pool as hooked; a changed fee module needs a new build that pins the reviewed module (`poolConfigFix` names the remedy the snapshot step logs).

## Storage (packages/db)

`node:sqlite` (`DatabaseSync`). `openDatabase(path | ':memory:')` sets `busy_timeout` (5 000 ms) first, then WAL journaling
(only when the file is not in WAL yet, retried for up to 5 s while another process holds the lock: SQLite's busy handler does not
cover the switch) and `synchronous = NORMAL`, then runs migrations. A database at the current version is opened without a write
lock; otherwise `BEGIN IMMEDIATE` comes before `schema_version` is read, so of several processes opening one file at once the first
applies each pending migration and the others read the version it recorded. Schema version 7; a file of a newer version
than the build is refused before any step runs. Tables:
- `tokens(address PK, symbol, name, decimals)`
- `pools(id PK, dex, kind, address, pool_id, token0, token1, fee_pips, tick_spacing, stable, hooks, created_at_block, tracked INTEGER, first_seen_at)`
- `snapshots(id PK AUTOINCREMENT, pool_id, block_number, timestamp, price, token0_usd, token1_usd, tvl_usd, active_liquidity TEXT, depth_json, depth_usd_json, spreads_json, concentration_json, price_deviation_bps, fee_pips)` + index `(pool_id, timestamp)` + unique index `(pool_id, block_number)`; `price_deviation_bps` (schema version 5) is `PoolSnapshot.priceDeviationBps`, NULL in rows stored before it; `fee_pips` (schema version 7) is `PoolSnapshot.feePips`, NULL in rows stored before it; `owner_top1_share` is core's `poolOwnerTop1Share` of the stored owners (schema version 6 set it to NULL in the rows stored before where those owners do not describe the pool)
- `volume_hourly(pool_id, hour_start, volume_token0 TEXT, volume_token1 TEXT, volume_usd, swap_count, PK(pool_id, hour_start))`
- `positions(pool_id, token_id TEXT, owner, tick_lower, tick_upper, liquidity TEXT, updated_block, PK(pool_id, token_id))`; rows under `<pool id>#catch-up` hold a windowed first scan that has not reached the head (never read as a pool's positions)
- `prices(token PK, usd, via_json, updated_at)`
- `scores(pool_id PK, timestamp, health_json, gap_json, persistence_24h_json, persistence_7d_json, volume_24h_usd, depth2_usd, health_total, gap_score)`; `health_json.rated` is the rating flag (a row without one reads as unrated until `score` runs again)
- `sync_state(key PK, value)` (e.g. `discover:uniswap-v3:lastBlock`; `seed:<dex>:lastBlock` records the block of the last `discover --seed`; `volume:<pool>:lastBlock` / `volume:<pool>:fromTs` the volume coverage of a pool; `volume:lastBlock` / `volume:lastTs` the head of the last volume pass; `positions:<pool>:lastBlock` the positions cursor, `positions:<pool>:catchUpBlock` that of a staged first scan, `positions:<pool>:custodians` the pool's custodians (comma-separated) as of its published positions; `start:<step>:lastRunAt` the unix ms of `start`'s last volume / positions run; `prune:lastRunAt` the unix seconds of the last `prune`)

One snapshot per pool and block, one market-maker sample per mandate and block (`mm_samples` unique on `(mandate_id, block_number)`,
docs/design/scorecards.md §4): migration 3 deleted the later copies a second writer had stored and added both unique indexes, and
`snapshots.insert` / `mmSamples.insert` skip a row already stored (`INSERT OR IGNORE`), returning its row id or `null`, while
`insertMany` returns the number stored. A second process writing the same block adds nothing. `packages/db/src/schema.test.ts` pins a
sha256 of every shipped migration: a shipped entry is never edited, a change is a new migration.
bigint columns are TEXT (decimal strings). JSON columns hold the core types with bigint → string.
Reads apply core's spread cap (`feasibleSpreadBps`): a snapshot stored before it comes back with the points whose legs are above `SPREAD_MAX_LEG_IMPACT_BPS` infeasible, and `SnapshotSummary.spread10kBps` is derived from the stored $10k point, never read from the denormalised `spread10k_bps` column; the score feeds
derive it in SQL through `dw_spread10k_bps(point, price)`, a function `openDatabase` registers on the connection that runs core's rule, so
`scores.topBy('spread')` orders by exactly the value it lists.
Repositories expose typed methods (`pools.upsertMany` (keeps the stored `fee_pips` of a pool with a snapshot), `pools.setFees` (the fee
column alone, what the snapshot step writes), `snapshots.insert`, `snapshots.latestForPool`, `snapshots.seriesForPool(poolId, fromTs)`,
`snapshots.seriesSummaryForPool(poolId, fromTs, toTs)` (the `SnapshotHealthSummary` per row: the summary columns plus `rangeHhi` and `ownerCoverage`, extracted by
SQLite, no snapshot JSON parsed; what the history route scores), `snapshots.latestTimestampForPool`, `mmSamples.latestIdFor(mandateId)`,
`volume.upsertBuckets`, `volume.sumUsd(poolId, fromTs)`, `scores.upsert`, `scores.topBy('health'|'gap'|'depth'|'volume'|'tvl'|'spread'|'top', limit, offset, filters)`, `scores.gapCounts(minVolumeUsd)`
(`{ total, meaningful }` over the whole gaps feed), `scores.tokenDepth(token)` (`{ depth2UsdTotal, depthKnownPools }` over every scored pool of
the token, stale quotes left out)…).
Pool filters (`PoolFilter`, shared by `pools.list/count` and `scores.topBy`): `dex`, `tracked`, `q` (case-insensitive substring of a token
symbol, token address, pool address or v4 pool id) and `token` (exactly token0 or token1, never a symbol; what `/api/tokens/:address` uses).
Query plans: the score feeds join `scores s CROSS JOIN pools p` so the scored set drives every count and filtered page whatever the number of
discovered pools; `pools.count` without `q` reads `pools` alone (no token joins); `db.analyze()` (`ANALYZE`, `PRAGMA analysis_limit` 1000) runs
at the end of `discover` and `discover --seed`, and `close()` runs `PRAGMA optimize`.
Retention: `snapshots.pruneBefore(ts, limit?)` (the oldest `limit` rows when given), `volume.pruneBefore(ts)`, `mmSamples.pruneBefore(ts)`, `mmAlerts.pruneBefore(ts)` (keeps each mandate's newest delivered alert; `timestamp` indexes on both, schema version 4) and `syncState.keys(prefix)`; `Database.checkpoint()` runs `PRAGMA wal_checkpoint(TRUNCATE)`.
`@depthwatch/core` exports `serializeBigints`/`reviveBigints` helpers (JSON with `"123n"`-free decimal strings; key-based revival by schema, not by regex).

## API (apps/api)

`createApp(db, opts?: CreateAppOptions)` returns a Hono app. `CreateAppOptions` (`apps/api/src/app.ts`):
`staticDir` (the built dashboard), `adminToken` (the bearer token `POST /api/mm` and `DELETE /api/mm/:id` require;
unset or empty, they answer 403 `registration disabled`; the CLI passes `DEPTHWATCH_ADMIN_TOKEN`), `source` (`demo` or
`live`, default `live`, reported by `/api/health`), `now` (unix-seconds clock), `onError` and `onRequest`. All responses
JSON, bigints as decimal strings. `onRequest(entry)` is the access log: one `{ method, path, status, ms }` per request,
after it was answered, with the path only (never the query string or a header, so the admin token never reaches it); a
401 from the admin routes adds `authFailure: 'missing token' | 'wrong token'` and `client` (the peer address, when the
server knows it). `serve`, `start` and `demo` log it as `request` (info) and `admin request refused` (warn).
Every response is gzip- or deflate-compressed when `Accept-Encoding` allows it and carries an `ETag` that answers a
matching `If-None-Match` with `304`. A successful `GET /api/*` response carries `Cache-Control: public, max-age=30`
unless the route sets its own (the badge: `public, max-age=300`; a pool's history: `public, max-age=60`); `/api/health` sends none.

Each response body is a type of `apps/api/src/dto.ts`, mirrored in `apps/web/src/api/types.ts`;
`apps/api/src/agentDocs/openapi.json` describes every field, and `apps/api/src/routes/agentDocs.test.ts` checks real
responses against it. The list names each route's type and query parameters; the fields are in those files:
- `GET /api/health?maxAge=` → `HealthResponse`: counts, the newest snapshot's time and block, the newest score's time
  (`latestScoredAt`, `MAX(scores.timestamp)`: a pass writes its scores after its snapshots, so the dashboard refetches
  when either moves), `snapshotAgeSeconds` (the server clock minus `latestSnapshotAt`, `null` before the first snapshot)
  and `source` (`demo` or `live`); 503 with
  `ok: false` and `error` when the database cannot be read (zero counts) or, with `maxAge` (a positive integer of
  seconds), when `snapshotAgeSeconds` is `null` or above it (`error: stale: …`, counts filled); 400 for an invalid `maxAge`
- `GET /api/stats` → `StatsResponse`: totals by dex (one row per `DEXES` id, in that order) and overall: pools, tracked, scored, rated, depth2Usd sum (stale
  quotes left out) and `depthKnownPools` (the scored pools it sums: a known depth, no stale quote), volume24hUsd sum
  (null when no pool has a volume), median health over rated pools
- `GET /api/pools?sort=health|depth|volume|gap|tvl|spread|top&dir=asc|desc&dex=&q=&minVolume=&rated=true|false&limit=&offset=` →
  `PoolsResponse` (`{ items: PoolSummary[], total }`; sorting by health puts unrated pools last in both directions,
  sorting by depth stale quotes; `spread` orders by `spread10kBps` and `top` by `ownerTop1Share`, both of the newest
  snapshot as listed, so every key orders the whole matching set, nulls last)
- `GET /api/pools/:id` → `PoolDetail`: the pool, whether it is `tracked`, the newest snapshot, the score with its gap,
  persistence and 24 h volume and the `scoredAt` time; the snapshot and score fields are null until the pool is
  snapshotted and scored
- `GET /api/pools/:id/history?window=24h|7d` → `HistoryResponse`: the `window`, its `from` / `to` bounds (ending at the
  pool's newest snapshot) and `points: HistoryPoint[]` (timestamp, price, depth2Usd, spread10kBps, tvlUsd, health, feePips),
  built from `snapshots.seriesSummaryForPool` (health recomputed per point by core); `Cache-Control: public, max-age=60`
- `GET /api/gaps?limit=&offset=&minVolume=` → `GapsResponse`: `items: GapItem[]` (pool summary + gap metrics) of the
  pools with 24 h volume ≥ `minVolume` (default $10k) by gap score, the floor applied as `minVolumeUsd`, and `total`
  (feed pools) and `meaningful` (feed pools with turnover ≥ 3, docs/METRICS.md), which count the whole feed, ignoring
  `limit` / `offset`
- `GET /api/tokens/:address?sort=&dir=&limit=&offset=` → `TokenDetail`: token info, USD price and the pools it was
  derived through, a page of the scored pools containing it (sorted like `/api/pools`, default deepest first) with
  `total`, the count of every pool containing it (`poolCount`), and `depth2UsdTotal` / `depthKnownPools` (the ±2 % depth
  summed over every scored pool of the token with a known depth and no stale quote, ignoring paging; docs/METRICS.md)
- `GET /AGENTS.md`, `GET /llms.txt`, `GET /openapi.json` → the documents for AI agents (usage guide, llms.txt index,
  hand-written OpenAPI 3.1 of the GET routes), written once in `apps/api/src/agentDocs/` and registered before the static
  fallback; the web build copies the files into `dist` unchanged and into `dist-static` with a generated static-site
  note.
- Static: when `staticDir` exists serve it with SPA fallback to `index.html`; the hashed `/assets/*` files carry
  `Cache-Control: public, max-age=31536000, immutable`, `index.html` and every other file `no-cache` (revalidated by `ETag`),
  including `index.html` served as the fallback under `/assets/` (a navigation to a removed chunk).

`PoolSummary = { pool: PoolMeta, price, tvlUsd, depth2Usd, depth2UpUsd, depth2DownUsd, spread10kBps, priceDeviationBps, staleQuote, health: { total, grade, rated, unratedReason, concentrationBasis }, gapScore, volume24hUsd, ownerTop1Share, updatedAt }`
(`grade: HealthGrade | null`, `unratedReason: 'hooked' | 'unpriced' | 'one-sided' | 'thin' | null`, `concentrationBasis: 'owners' | 'ranges' | 'neutral' | null`;
`HealthScore` carries the same three fields; `priceDeviationBps` is the newest snapshot's, `staleQuote` is core's `isStaleQuote` of it).
`depth2UpUsd` / `depth2DownUsd` are the ±2 % level's `upUsd` (buy side) and `downUsd` (sell side) of the pool's newest
snapshot, read from the stored `depth_usd_json` as core computed them; each is `null` when its token has no USD price
(docs/METRICS.md) or the pool has no snapshot. They are listed, not sorted, so they are not denormalised columns.
Every token object a response carries (`token0` / `token1` of a pool in summaries, details, gaps and scorecards,
`TokenDetail.token`) adds `label`: core's `tokenLabel` over an index of the tokens of scored pools, built once per
request; a pool whose two tokens share a symbol labels them against that index plus the two tokens (`withTokens`), so
they are told apart even when neither is in a scored pool. The `dex` query parameter and `Dex` fields take the `DEXES` ids.
Validation with zod; unknown pool → 404 JSON `{ error }`.

Scorecard responses (docs/design/scorecards.md §6) carry the mandate as core's `PublicMandate`, not as the stored
`Mandate`: `alertWebhookUrl` is replaced by the boolean `alertWebhookConfigured`. A webhook URL is a bearer secret (whoever
holds it can post through it), so it lives only in the database and is read by alert delivery and by the operator's own
CLI (`mm show` prints it masked to scheme and host); no `/api` response, no `export` bundle and no dashboard page contains
it, and `apps/api/src/routes/webhookSecret.test.ts` fails when any part of it shows up in a response body or header.

## CLI (apps/cli)

`depthwatch <command>` via `tsx` (`pnpm depthwatch …`). Env: `DEPTHWATCH_RPC_URL`, `DEPTHWATCH_LOGS_RPC_URL` (eth_getLogs only, default: `DEPTHWATCH_RPC_URL`), `DEPTHWATCH_LOG_CHUNK`, `DEPTHWATCH_DB`, `DEPTHWATCH_PORT` (else the platform's `PORT`), `DEPTHWATCH_HOST` (`serve`, `start`, `demo`; default `0.0.0.0`), `DEPTHWATCH_LOG_LEVEL` (`debug|info|warn|error|silent`, default `info`), `DEPTHWATCH_PUBLIC_URL` (base of the scorecard link `mm register` prints and of webhook alerts' `scorecardUrl`; default `http://<host>:<port>`), `DEPTHWATCH_ADMIN_TOKEN` (environment only: `createApp`'s `adminToken` under `serve`, `start` and `demo`), `DEPTHWATCH_TOP_POOLS`, `DEPTHWATCH_KEEP_DAYS` (`prune`, `run`, `start`), `DEPTHWATCH_SEED_TOKENS` (`--seed`, `start`); for `start` also `DEPTHWATCH_SNAPSHOT_INTERVAL`, `DEPTHWATCH_VOLUME_INTERVAL`, `DEPTHWATCH_POSITIONS_INTERVAL`, `DEPTHWATCH_POSITIONS_BUDGET`, `DEPTHWATCH_DISCOVER_BUDGET`, `DEPTHWATCH_SHUTDOWN_GRACE` (durations: `90s`, `30m`, `6h`, a plain number is seconds).
- `discover [--dex …] [--from-block N]` — incremental factory log scan in windows of 50 log chunks; each window upserts its pools and advances sync_state in one transaction, so reruns resume. `--dex` takes the `DEXES` ids; a DEX without a cursor starts at its factories' first block (Aero: `aeroV2.startBlock`, the earliest `aeroSlipstream` start block).
  `--seed [--seed-token <address> …]`: no logs; `ChainReader.seedPools` for the pairs of the reference tokens plus the `--seed-token` ERC-20s (repeatable; `DEPTHWATCH_SEED_TOKENS`, comma-separated; lowercased; also read by `run --seed` and `start`), upsert, then `refreshPoolMetas` over the stored `aero-slipstream` pools the seed did not find (upserted; a failure fails that DEX), `seed:<dex>:lastBlock` = the seed block for each DEX whose seeder succeeded (log cursors untouched; pools already stored keep their creation block and are not searched again). A DEX whose seeder failed gets no marker and is logged; the step stores the other DEXes' pools, then fails naming it.
- `snapshot [--top N] [--pool id…]` — readOverview for all pools → derive prices → rank by TVL (a Uniswap v4 pool by its ±2 % depth; a hooked one is not ranked, so it is tracked only through `--pool` or a mandate) → readState for top N → compute depth/spread/concentration (none for a hooked Uniswap v4 pool, which is also no price edge) and the price deviation → insert snapshots and write each snapshotted pool's fee (`pools.setFees`); also rebuild `prices`. A tracked pool without a usable mid price (a zero reserve) is logged and skipped (`empty`), not failed; a `PoolConfigChangedError` is logged with `poolConfigFix`. One `MmSample` per active mandate of a snapshotted pool; a mandate on a hooked Uniswap v4 pool, or on a concentrated pool whose positions are not published (`positions:<pool>:lastBlock` unset), is an attribution failure, no sample. Under `start`, a stop before the storing transaction stores nothing.
- `volume [--hours 24]` — readSwaps for tracked pools, bucket hourly, USD via prices; incremental per pool (`volume:<pool>:lastBlock` / `volume:<pool>:fromTs`): a later pass starts at the hour that held the previous head and rewrites it, keeping earlier hours; pools without coverage of the window read all of it. Uniswap v3 and Slipstream pools share one log scan; progress (blocks and chunks done of the total, %, elapsed, ETA, backoffs) is logged every 30 s.
- `positions` — readPositions for tracked concentrated pools and the concentrated pools of active mandates, upsert; with each published set, `readCustodians` at its head block is recorded (`positions:<pool>:custodians`) for the snapshot's owner coverage. Options `windowBlocks` / `budgetMs` (used by `start`): pools far behind are read in shared windows from the oldest cursor, a first scan stays staged until it reaches the head, a mandated pool without published positions reads to the head on its own range at once, and a spent budget starts no further pool or window.
- `score` — for every tracked pool: persistence 24h/7d from snapshots, volume24h, health, gap → `scores`; rows of pools no longer tracked are deleted. volume24h sums the 24 whole hours before the hour of the last block `volume` read (`volume:lastTs`), via core `computeVolume24hUsd`.
- `prune [--keep-days 30]` — retention, database only: deletes snapshots and hourly volume older than `--keep-days` (`DEPTHWATCH_KEEP_DAYS`, default 30; snapshots keep at least 8 days so the 7 d windows always have their series), scorecard samples older than 35 days and alerts older than 90 (each mandate's newest delivered alert is kept, so a longer breach streak is not reported twice and still gets its recovery), and the `volume:<pool>:*` cursors of pools no longer tracked; a tracked pool's `volume:<pool>:fromTs` moves up to the volume cutoff so no pruned hour counts as covered. Snapshots go in batches of 10,000 rows, each its own transaction; the WAL is checkpointed (truncated) at the end. Records `prune:lastRunAt` (unix seconds).
- `run [--interval 300|5m] [--once] [--with-positions] [--seed] [--keep-days 30]` — loop: discover → [positions] → snapshot → volume → score → [prune] (positions runs for the concentrated pools of active mandates, before the snapshot that samples them; `--with-positions` runs it for every tracked pool; volume values swaps at the prices snapshot stored; score follows volume, whose head anchors the 24 h window; prune runs once a day, when `prune:lastRunAt` is a day old or unset); `--seed` seeds in the discover step. A failed step is logged and the pass goes on; `--once` exits 1 when any step failed (one stderr line naming them); the loop stops with exit 1 (`PipelineStalledError`) after three passes in a row in which every step that reads the chain (discover, positions, snapshot, volume) failed, so a supervisor restarts or alerts.
- `start [--snapshot-interval 30m] [--volume-interval 1h] [--positions-interval 6h] [--positions-budget 10m] [--discover-budget 15m]` — the server: `serve`'s API and dashboard, listening at once (after a write probe: an unwritable database is exit code 1), plus a scheduler over the same database. A pass every snapshot interval runs [seed until one succeeds] → snapshot → [volume when due] → score → [positions when due or while an active mandate's concentrated pool has no published positions, budgeted] → [log discovery, budgeted] → [prune once a day], both budgets cut to the time left before the next pass; steps never overlap, a failing step is logged and retried at its next slot, a volume or positions run that found no tracked pool is due again at the next pass, every step logs its requests and estimated Alchemy compute units and each UTC day a total. SIGTERM aborts the chain reader and the pipeline (`PipelineContext.signal`: no further pool read, nothing stored by the step in flight), waits `DEPTHWATCH_SHUTDOWN_GRACE` (8 s) at most, closes server and database, exit 0.
- `serve` — API + dashboard (`apps/web/dist` if built).
- `demo` — seed an in-memory DB (or an empty / demo-seeded `--db` file; `DEPTHWATCH_DB` is ignored so the live DB is never touched) from the synthetic fixture set and `serve`. Must work with no network.
- `export --out <file> [--demo] [--note <text>] [--bundle <file>]` — the static dashboard bundle (`StaticBundle`, JSON) of the database, read route by route through `createApp(db).request()` so it holds what the server would answer; `--demo` bundles the offline demo world instead (in memory), `--note` sets the bundle's `note`. Every export writes the trade switch from `DEPTHWATCH_TRADE` (environment only, `apps/cli/src/tradeSwitch.ts`) twice: the bundle's `features.trade` and `flags.json` next to the bundle, exactly `{ "trade": … }`. Unset, empty or `off` is off; otherwise a comma-separated list of trade venues with a route in `TRADE_ROUTES` that is not on hold, with the launch limits of core (`TRADE_LAUNCH_MAX_USD`, `TRADE_MAX_SLIPPAGE_BPS`); an unknown or held venue fails closed: everything is written with the switch off, then the export fails with exit code 3, so a workflow publishes off and still fails. `--bundle <file>` writes an exported bundle again with only `features` replaced and reads no database (docs/DEPLOY.md, "Trade switch").
- `mm register --file <json>` — validate a registration (docs/SCORECARDS.md), store the mandate (an existing id is replaced, keeping its registration time, samples and alerts) and print its scorecard URL; `mm list` — every mandate with its status; `mm show <id>` — the scorecard summary as JSON (the webhook URL masked to scheme and host); `mm deactivate <id>` — stop sampling, the scorecard stays served as `inactive`; `mm sample` — sample every active mandate now against the latest block (the one live `mm` command). The other `mm` commands only touch the database.

## Dashboard (apps/web)

Routes (docs/design/ia-v3.md §2): `/` (the answer, the depth butterfly, facts, gap and scorecard previews), `/pools`,
`/pools/:id` (mirrored depth curve, health, cost to trade, providers, over time, mandates), `/gaps`, `/tokens/:address`,
`/mm`, `/mm/:id`, `/methodology`. The visual and interaction spec is docs/design/visual-v4.md, which supersedes
visual-v3.md where they differ. Charts are hand-written SVG and HTML: no chart library, because library defaults
conflict with the chart rules (visual-v4.md §7.1); the standard library and React cover them. Light and dark theme
via `prefers-color-scheme`, tokens on `:root` (`src/styles/tokens.css`), fonts self-hosted under `public/fonts`. Data
via TanStack Query against `/api`; the static build (`pnpm build:static`) reads an exported bundle on hash routes.
`VITE_MOCK=1` serves from
in-repo mock JSON so the UI runs without a backend (the dev server also falls back to it when the API is down); a production
build contains no mock data and, when `/api/health` does not answer, shows "The data service is not answering." with a
"Try again" button instead of made-up pools (docs/design/web-v2.md §4). The bundle (`StaticBundle` in `apps/api/src/dto.ts`, mirrored in
`apps/web/src/api/types.ts`) carries an optional `note` from `depthwatch export --note <text>` and an optional
`features.trade`, the trade switch; the static build ships it again as `data/flags.json` and fails when the two differ
(`plugins/staticFlags.ts`). Core's `parseTradeFlags`, `parseFlagsFile` and `combineTradeFlags` read them failing
closed: a missing or malformed block is off, and a swap needs both on for its venue. The static build also ships
`public/_headers` for Cloudflare Pages (no framing, `nosniff`, a Content-Security-Policy with `connect-src 'self'` and
the inline script of `index.html` by hash, `data/flags.json` uncached); every build fails when that hash and the inline
script differ or the file opens a URL pattern in two blocks (Pages was seen to serve only the last), and the server
build leaves the file out (`plugins/securityHeaders.ts`).

The swap panel (`src/trade/`: an exact-input swap in the one pool the page shows, nothing
else). The Pool page gains "trade in this pool" under cost to trade only when `pages/pool/tradeGate.ts`
allows it: the bundle's switch on for the pool's DEX, a route in `TRADE_ROUTES` that is not on hold,
a concentrated pool with an address, no hook, rated, not a stale quote, both tokens in `TRADE_TOKENS`;
never in demo, mock or connecting mode, and never in the server build, which carries no switch (it still
ships the section, the gate and the lazy panel's chunks, unreachable there: about 10 kB of its boot script). Until
the reader clicks "Swap in this pool" the row shows the snapshot's $10K round trip with its time and
loads no wallet code: the panel is a lazy chunk in Suspense and an error boundary ("Reload the page to
trade"), and `src/tradeBundle.test.ts` fails when the ERC-8021 marker, `eip6963:requestProvider` or
viem reach a boot chunk, or the boot chunks pass their byte budget. The panel finds wallets by EIP-6963
(`window.ethereum` when none announces itself), asks for Base (0x2105) when the wallet is elsewhere,
and reads everything through the wallet's own provider: before any quote it checks the pool on chain
(`pool.factory()` names the route, the router's `factory()` is that factory, the factory's `getPool`
is this pool, the tokens are the page's); quotes are `eth_call`s to the route's quoter at one block
with the pool's `slot0()` and that of the deepest other rated pool of the pair (a bound for core's
`checkTrade`, never shown as a suggestion), and the pool's `fee()` at that block, the fee a swap at
that block pays (it can change by the block the swap lands in), shown as the live pool fee (on
Slipstream it is the factory's `getSwapFee(pool)`, which can be far from the snapshot's; a quote
whose fee cannot be read gives no price); a quote that stopped at the price limit (part of the
input unused) is refused whatever the quoter. Amounts, minimum, impact, size cap and deviations are
core's (docs/METRICS.md, "Swap checks"). The review names each token by symbol, name and address on
Base, linked to Basescan. Approval is exact and skipped when the allowance covers the input; the
panel reads `data/flags.json` again with `cache: 'no-store'` when it connects and before each
signature request, and before each one it also re-quotes (a lower minimum goes back to the review)
and simulates the exact transaction from the account. A started approve-then-swap asks the wallet for
nothing more once the panel has moved on (another account, network or wallet, or another page). ETH
in is `value` with WETH as `tokenIn` (on SwapRouter02, whose swap refunds nothing, followed by
`refundETH()`); ETH out is the router's `unwrapWETH9(minOut, account)` in the same multicall, with
WETH out offered when only the unwrap fails its simulation. The Builder Code `bc_j6obesn8` goes on
every transaction as its ERC-8021 suffix (`trade/builderCode.ts`, 29 bytes): an EOA is asked once,
after a check that it is on Base, for `eth_sendTransaction` of our calldata with the suffix appended,
the bytes simulated, and `gas` the wallet's `eth_estimateGas` of those bytes × 125 / 100, rounded
up, plus 150,000 (`GAS_ALLOWANCE` in `trade/send.ts`: a Slipstream pool's `fee()` runs its factory's
dynamic fee module, about 13,000 to 24,000 gas, or about 70,000 to 86,000 when the module
binary-searches the pool's oracle; it switches to the search once another transaction, a swap that
moves the tick or a liquidity change in range, has written the oracle in the same block or, on a
pool without an initial fee, within the module's `secondsAgo`, which an estimate made before that
transaction cannot see; measured on a fork of Base mainnet (docs/research/base-contracts.md
§2.12), a swap after such a swap, which also brought an initialized tick into its path, needed
118,986 gas over its estimate, × 1.61, and 150,000 covers that with 31,014 to spare before the 25 %
counts; the account pays for the gas used, not the limit): an estimate that reverts sends nothing,
and a wallet that cannot estimate sets the limit itself (viem's `sendTransaction` is not used: it
can ask again as `wallet_sendTransaction`); a wallet
whose `wallet_getCapabilities` reports `dataSuffix` on 0x2105 gets `wallet_sendCalls` with
`capabilities.dataSuffix = { value, optional: false }` and plain calldata, so it is never appended
twice and never dropped by a fallback, and its outcome is the wallet's EIP-5792
status and receipts (an ERC-4337 bundle succeeds when the user operation inside it reverts). An
account with contract code that is not an EIP-7702 delegation and does not report the capability
signs on the EOA path, and the review says its code may not be recorded. After the receipt the
panel reads the codes back where ERC-8021 puts them, the end of the account's user operation when
the transaction is a `handleOps` bundle, else the end of the transaction's input
(`trade/readBack.ts`), and shows them under Details; a missing code never blocks. A swap whose
receipt shows no payment to the account is not reported as done, an approval that went through
before a swap that was not made is shown with its fee, its link and the allowance it leaves, and a
request the wallet took whose outcome could not be read is reported as unknown, never as not sent;
one taken before the panel moved on stays linked in the panel. The footer's promise follows the
switch the page loaded with (`lib/tradeSwitch.ts`, `tradeSwitchOn`, which the gate also uses): on
for a venue whose route is not on hold, it says the swap panel is on and non-custodial with no fee
added to swaps, otherwise that the site is read-only (visual-v4.md §5.1); a page already open keeps
its footer until it reloads.

A static build of a
`live` bundle is a dated snapshot that does not update: the top line names Base mainnet and the snapshot's UTC time,
"About this snapshot" shows the note, and freshness and every other time are absolute, never "… ago"
(docs/design/web-v2.md §4).

## Testing

- core: unit tests against hand-computed values and property tests against a brute-force simulator
  (many tiny exact-in swaps vs one simulateSwapToPrice); TickMath checked against known Uniswap constants
  (`getSqrtRatioAtTick(0) = 2^96`, `MIN_TICK`/`MAX_TICK` ratios, `getSqrtRatioAtTick(887272) = 1461446703485210103287273052203988822378723970342`).
- chain: fixture transport with hand-built responses; ABI decoding round-trips via viem's `encodeFunctionResult`.
- db/api: in-memory SQLite; API tests through `app.request()`.
- cli: `demo` end-to-end against fixtures.
- Aero fixtures are hand-built from the ABI encodings with the values read on chain (docs/research/base-contracts.md §2.9),
  never recorded. The demo world dates the Aero factories inside its synthetic history (earlier than on Base), so its
  history holds Aero pools; `BASE_ADDRESSES` keeps the real start blocks.
