# Tokenized stocks: design contract

Goal: Depthwatch as the liquidity observatory for Base's tokenized stocks. Per stock: DEX depth at
±1 / 2 / 5 %, effective spread, venue share, and each pool's deviation from the stock's Chainlink
feed, read with the feed's status, age and tolerance.

Constraints, binding on every section below:
- Depthwatch tracks the ten stocks of base.org/stocks only. The issuer API's 71 minted tokens (61
  not on base.org) come later, and only from a first-party list.
- Chainlink feeds are read on chain only (`eth_call` at the snapshot block). No HTTP data vendor at
  runtime: the ROADMAP non-goal "no third-party data vendors" stands.
- Stock tokens never enter the swap panel: `TRADE_TOKENS` and `TRADE_ROUTES` are not touched.
  Coinbase tokenized stocks are "only available to persons in eligible jurisdictions outside of
  the U.S." (docs.base.org; base.org/stocks: Regulation S). No stock page has a trade button or a
  link to a swap interface.
- Depthwatch does not become an oracle. A stock token's price-graph USD price is the existing "USD
  prices" valuation convention (needed for TVL and depth in USD), labelled as such on the stock
  pages and in the served AGENTS.md; `referenceUsd` is Chainlink's answer passed on with its status
  and age; there is no aggregate, median or time-weighted Depthwatch stock price.

Design choices (each closes a question of an earlier draft):
- `held` is a two-part rule for 24/5 feeds: the age part, or the weekly close of New York time
  computed in pure code (METRICS.md, "Off-hours"). No maintained calendar; holidays fall to age.
- Each feed carries its deviation threshold (`deviationThresholdBps`, 50) and each deviation a
  `withinTolerance` flag against the threshold plus the pool's fee.
- Dust: a stock pool is force-tracked only from `rankUsd ≥ $10,000`, and a deviation is published
  only when the pool's thinner ±2 % side reaches `HEALTH_RATING_MIN_SIDE_USD` (`thin` otherwise).
- A pool whose stock's transfers are paused leaves the depth sums, the spread and the deepest-pool
  choice, as a stale quote does.
- Stock pools may still price other tokens through the price graph (no change).
- No per-share basis anywhere: every feed answers per token, and the multiplier is never applied.
- `isAuthorized(policy, pool)` as a second tradability check is deferred (§8).
- The MVP of §7 ships to `main` in one merge, so no stock pool appears in the generic lists before
  the stock pages and the eligibility lines exist.

The numbers are defined in [METRICS.md](../METRICS.md): "Reference deviation" (the reading, its
status and the off-hours rule, the deviation and its tolerance, "Stock tradability") and "Stock
aggregates". This page names the packages, functions and tables, and the plan;
[stocks-api.md](stocks-api.md) names the routes, the bundle, the dashboard and the agent documents.

Words: the **stock list** is Depthwatch's list of stocks (`StockList` in chain, the `stocks` table
in the database); the **oracle registry** is Coinbase's contract that the feeds read
(`STOCK_PROTOCOL.oracleRegistry`). "Registry" alone is not used for either.

## 0. Facts this rests on

From docs/research/base-contracts.md [`## stocks`](../research/base-contracts.md#stocks) and
[§2.14](../research/base-contracts.md#214-tokenized-stocks-and-their-chainlink-feeds-2026-11-05)
(block 53,663,272, 2026-11-05 23:57:10 UTC): the ten tokens of base.org/stocks (B20 Asset, 8
decimals, `multiplier()` WAD); their ten 24/5 feeds (8 decimals, heartbeat 86,400 s, 0.5 %
deviation threshold, from Base's feed table and Chainlink's directory); the answer is USD per token
(the share price times the multiplier, truncated); the oracle registry's `getOracleParams(token)`
answers (multiplier, paused) and reverts for unknown tokens, its name and ABI from earlier research
and the bytecode, no document; policy 5 is a BLOCKLIST and authorizes every pool checked.
`PausableFeature` ordinals TRANSFER 0, MINT 1, BURN 2, SEIZE 3, and "To check a single feature,
prefer `isPaused(feature)`" (`isPaused(uint8)`, 0xbc61e733):
<https://docs.base.org/specifications/b20/reference/interfaces/ib20/is-paused.md> and
`…/paused-features.md` (read 2026-11-06).

The feeds' round history is in §2.14: 15,903 rounds of the ten proxies' current phase from
2026-08-05 to 2026-11-05; gaps with no Saturday inside at most 86,418 s, two above 86,400 s, 212
above 12 h; weekend and holiday gaps at least 172,968 s; overnight rounds from every feed; **no
round inside a weekly close** (Friday 20:00 to Sunday 20:00 America/New_York, 13 closes), every
weekend gap beginning before its close and ending 19 to 99 s after it (Labor Day: at 20:00 New
York time on the holiday); the two-part `held` rule holds no weekday second and 91.3 % of the
weekend-gap hours, against 54.3 % by age alone. These are the evidence for
`REFERENCE_AGE_GRACE_SECONDS` and the weekly close (METRICS.md, "Off-hours").

Checked for this design on 2026-11-06 around 00:00 UTC through Alchemy's endpoint: one Multicall3
`aggregate3` at block 53,663,140 answered every read of §3 for NVDAc (B20 `pausedFeatures()` `[]`
and `multiplier()`, the oracle registry's `getOracleParams`, the proxy's `latestRoundData()`,
`decimals()` 8 and `description()` 'Coinbase NVDA'). The precompiles answer calls from a contract,
so the stock reads ride in a multicall at the snapshot block. Not established read-only, and so
not relied on: what a feed does through a corporate action (none happened), a paused answer of the
oracle registry (never observed), the holders of the tokens' admin and pause roles.

## 1. Stock list (`packages/chain/src/stocks.ts`)

Present: `STOCK_TOKENS`, `STOCK_TOKEN_LIST`, `STOCK_FEEDS` keyed by token address (`StockFeed`:
`feed`, `ticker`, `decimals`, `heartbeatSeconds`, `deviationThresholdBps`, `hours`),
`STOCK_PROTOCOL` (`b20Factory`, `policyRegistry`, `oracleRegistry`), `isStockToken`. It stays the
only place stock and feed addresses live. Additions:
- `interface StockList { tokens: readonly TokenInfo[]; feeds: Readonly<Record<Address,
  StockFeed>>; oracleRegistry: Address }` and `BASE_STOCKS: StockList` built from the constants.
- `createChainReader({ stocks?: StockList })` (default `BASE_STOCKS`, validated lowercase as
  `addresses` is) and `ChainReader.stocks`. Tests inject synthetic stocks this way; `addresses.ts`
  (398 lines) is not grown. The validation is `resolveStockList(list)`: every address lowercased,
  the result frozen; a malformed address, a token listed twice (two readings of one token at one
  block) or a feed keyed by a token not on the list throws.
- `stockInfos(list): StockInfo[]`, the list as core's `StockInfo` in list order (each feed's proxy
  as `StockFeedInfo.address`), for `evaluateStockReading` and the stored stock list (§4, §5). A
  stock without a feed gets `feed: null` and the ticker its symbol less a trailing "c", as the
  ten feeds' tickers are (none of the ten lacks a feed).

The snapshot step writes the stock list to the `stocks` table at every pass; the API knows which
tokens are stocks from that table only, since it imports core and db alone.

## 2. Core (`packages/core/src/stocks/`, pure)

A module of its own, as `mm/` is: `types.ts`, `hours.ts`, `reference.ts`, `aggregate.ts`, their
tests and `workedExamples.test.ts`, exported from the core barrel. Contract:

```ts
export type ReferenceStatus = 'live' | 'held' | 'paused' | 'invalid' | 'unread' | 'no-feed'
export type PausableFeature = 'transfer' | 'mint' | 'burn' | 'seize' // B20 ordinals 0..3
export type ReferenceNullReason =
  'hooked' | 'thin' | 'stock-pair' | Exclude<ReferenceStatus, 'live'> | 'quote-unpriced'
export type StockDeviationNull = ReferenceNullReason | 'no-pool'
export interface StockFeedInfo { address: Address; decimals: number; heartbeatSeconds: number
  deviationThresholdBps: number; hours: '24/5' | '24/7' } // address: the proxy (StockFeed.feed)
export interface StockInfo { token: TokenInfo; ticker: string; feed: StockFeedInfo | null }
/** Decoded answers at one block; a null field is a call that failed, reverted or did not decode. */
export interface StockRawRead { roundId: bigint | null; answer: bigint | null
  updatedAt: number | null; decimals: number | null; description: string | null
  oracleMultiplierWad: bigint | null; oraclePaused: boolean | null // getOracleParams: both or none
  tokenMultiplierWad: bigint | null; pausedOrdinals: number[] | null }
export interface StockReading { token: Address; blockNumber: bigint; timestamp: number
  referenceStatus: ReferenceStatus; referenceUsd: number | null; feedAgeSeconds: number | null
  feedRoundId: bigint | null; feedAnswer: bigint | null; feedUpdatedAt: number | null
  oracleMultiplierWad: bigint | null; oraclePaused: boolean | null
  tokenMultiplierWad: bigint | null; pausedFeatures: PausableFeature[] | null
  transfersPaused: boolean | null; error: string | null } // error: the failed call, or why invalid
export interface PoolReference { stock: Address; poolUsd: number | null
  referenceUsd: number | null; referenceStatus: ReferenceStatus; feedAgeSeconds: number | null
  deviationBps: number | null; toleranceBps: number | null
  deviationThresholdBps: number | null; feeBps: number | null // toleranceBps's parts, null with it
  withinTolerance: boolean | null; deviationNull: ReferenceNullReason | null
  transfersPaused: boolean | null }
export interface StockPoolInput { poolId: string; dex: Dex; token0: Address; token1: Address
  tvlUsd: number | null; depth2UpUsd: number | null; depth2DownUsd: number | null
  spread10kBps: number | null; staleQuote: boolean; volume24hUsd: number | null
  reference: PoolReference | null
  pausedByNewerReading?: boolean } // newerReadingPauses: set by the API only
export interface StockVenue { dex: Dex; poolCount: number; depth2Usd: number | null
  depthShare: number | null; volume24hUsd: number | null; volumeShare: number | null }
export interface StockAggregate { token: Address; poolCount: number; tvlUsd: number | null
  tvlKnownPools: number; depth2BuyUsd: number | null; depth2SellUsd: number | null
  sidesKnownPools: number; spread10kBps: number | null; spread10kPoolId: string | null
  volume24hUsd: number | null; volumeKnownPools: number; venues: StockVenue[]
  deepestPoolId: string | null; deviationBps: number | null; withinTolerance: boolean | null
  deviationNull: StockDeviationNull | null }
/** What the snapshot step stores with each reading (§5): the pass's own pools at that block. */
export type StockPassDepth = Pick<StockAggregate, 'depth2BuyUsd' | 'depth2SellUsd'
  | 'sidesKnownPools' | 'deepestPoolId' | 'deviationBps' | 'withinTolerance' | 'deviationNull'>

REFERENCE_AGE_GRACE_SECONDS = 3_600
weeklyCloseAt(timestamp: number): { start: number; end: number } | null // hours.ts
isHeld(feed: StockFeedInfo, timestamp: number, updatedAt: number): boolean
evaluateStockReading(stock: StockInfo, raw: StockRawRead | null,
  block: { blockNumber: bigint; timestamp: number }, error?: string): StockReading
referenceUsdPerToken(answer: bigint, decimals: number): number | null // rawToHuman at the end
decodePausedFeatures(ordinals: readonly number[]): PausableFeature[] // unknown ordinals dropped
isTransferPaused(features: readonly PausableFeature[] | null): boolean | null
quoteRouteAvoids(via: readonly string[], stockPoolIds: ReadonlySet<string>): boolean
poolReference(input: { pool: Pick<PoolMeta, 'token0' | 'token1' | 'hooks'>; price: number
  token0Usd: number | null; token1Usd: number | null; depth2UpUsd: number | null
  depth2DownUsd: number | null; feePips: number | null; quoteIndependent: boolean
  stocks: ReadonlyMap<Address, { info: StockInfo; reading: StockReading }> }):
  PoolReference | null // null: no stock in the pool
stockSides(stock: Address, token0: Address, depth2UpUsd: number | null,
  depth2DownUsd: number | null): { buyUsd: number | null; sellUsd: number | null }
countsInStockSums(pool: StockPoolInput): boolean // not stale, not paused (snapshot or newer)
newerReadingPauses(snapshotBlock: bigint | null, readings: readonly (Pick<StockReading,
  'blockNumber' | 'transfersPaused'> | undefined)[]): boolean // a later reading, transfers paused
summarizeStock(token: Address, pools: readonly StockPoolInput[]): StockAggregate
```

`weeklyCloseAt` applies the US daylight-saving rule (UTC−4 from the second Sunday of March 07:00
UTC to the first Sunday of November 06:00 UTC) and needs no time-zone data; its test checks it
against `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` every few minutes over 2026 and
2027, and pins the 47 h and 49 h closes. `evaluateStockReading` is `unread` when any of
`answer`, `updatedAt`, `decimals`, `description`, `oracleMultiplierWad`, `oraclePaused` is `null`
(the four required calls of METRICS.md), and never because of `tokenMultiplierWad` or
`pausedOrdinals`. A token is a stock in `poolReference` when `stocks` has it; in a pool of two
stocks the reference is token0's stock's (`stock`, its reading), the deviation `null`
(`stock-pair`) and `transfersPaused` true when either stock's is. `summarizeStock` ignores a pool
that does not hold the token, breaks a spread tie to the lower pool id, and gives `unread` for a
deepest pool whose snapshot has no reference (stored before schema version 8). `poolReference`
publishes the band's two parts (`deviationThresholdBps`, `feeBps`) beside `toleranceBps`, so the
dashboard words each part as published (review fix: it had subtracted one from the sum). The API
pairs each pool's newest snapshot with its stocks' newest readings: `newerReadingPauses` is true
when a reading of either token, taken at a later block than the snapshot (or for a pool without
one), finds its transfers paused, and the API sets it as `pausedByNewerReading`, which
`countsInStockSums` reads beside the reference's own flag (review fix, METRICS.md "Stock
aggregates": without it a pool whose state read failed on the pass where a pause began kept
counting under a paused banner). The snapshot step's pools are at their readings' block, so it
never sets the flag. `isHeld` and
`REFERENCE_AGE_GRACE_SECONDS` live in `reference.ts`, as METRICS.md's index says. Also exported:
`PAUSABLE_FEATURES` (the features by ordinal), `newYorkOffsetSeconds`, `WeeklyClose`,
`PoolReferenceInput` and `StockEntry` (the input of `poolReference`), `stockPassDepth(aggregate)`
(step 4 of §4), and in core's `testing.ts` the builders `makeStock(symbol, { address?, feed? })`
and `stockRawRead(stock, answer, updatedAt, overrides?)` for every package's tests.

Shared types (`types.ts`, DESIGN.md "Shared types" updated in the same change):
`PoolSnapshot.reference: PoolReference | null` (null: no stock in the pool, and rows stored before
schema version 8), with `PoolReference` defined in `stocks/types.ts` and brought in by
`import type`, so `types.ts` (421 lines) grows by three lines; `UnratedReason` adds
`'transfers-paused'`; `HealthInputs.transfersPaused?: boolean` and `rateDepth(up, down, { hooked?,
transfersPaused? })` test it after `hooked`. `BIGINT_KEYS` adds `feedRoundId`, `feedAnswer`,
`oracleMultiplierWad`, `tokenMultiplierWad`. `PoolReference` holds no bigint. `percentile` and
`median` come from `math.ts`.

## 3. Chain (`packages/chain`)

- `ChainReader.readStocks(blockNumber: bigint): Promise<StockReadResult[]>`, one per stock of the
  list, `{ token, raw: StockRawRead | null, error: string | null }`. `reader.ts` (391 lines) gains
  only the option, the property and a method of a few lines; the work is in
  `internal/stocks.ts`: one `multicallBatched` with `allowFailure` at the block, six calls per
  stock with a feed (`latestRoundData`, `decimals`, `description`, `getOracleParams`, `multiplier`,
  `pausedFeatures`, `STOCK_READ_CALLS`) and the last two without one, 60 calls for the ten, one
  request. Each call is decoded on its own (viem's multicall runs `decodeFunctionResult` per call,
  then each answer's shape is checked); a failure, a revert or a decode error nulls its fields and
  names the call in `error` as `<call>: <reason>`, `; `-joined in call order, the reason viem's
  one-line message without the function name it repeats (`getOracleParams: reverted.`). A failed
  request gives `raw: null` and its error (`errorSummary`) for every stock. Never throws for a
  stock, so the snapshot goes on; only the reader's own abort (`createChainReader({ signal })`) is
  thrown, since a stopped pass stores nothing. To keep `reader.ts` under 400 lines (398), the
  swap events' chain-order sort moved from it into `internal/swapScans.ts`.
- ABIs, `as const`, only the functions read: `abi/chainlinkFeed.ts` (`latestRoundData`,
  `decimals`, `description`), `abi/b20.ts` (`multiplier`, `pausedFeatures` → `uint8[]`),
  `abi/coinbaseOracleRegistry.ts` (`getOracleParams(address) → (uint256, bool)`, its header
  saying the ABI comes from the bytecode and observed answers, not a document). Base prefers
  `isPaused(feature)` for one feature; Depthwatch publishes the whole set, which
  `pausedFeatures()` returns in one call ("treat the result as a set"), and takes `TRANSFER`
  from it.
- Seeding: `SeedPoolsOptions.crossTokens?: readonly Address[]`, tokens paired with every token of
  `tokens` and never with each other. `seedPools` builds the pair list once (`sortedPairs(tokens)`
  plus `crossPairs(crossTokens, tokens)`, deduplicated, each sorted: `seedPairs(tokens,
  crossTokens)`, which equals `sortedPairs(tokens)` without cross tokens; a cross token also in
  `tokens` adds no self pair) and hands it to the seeders, whose signature becomes `(ctx, block,
  pairs)`; each drops pairs with native ETH (`erc20Pairs`) except Uniswap v4. The seed world
  fixture (`registerSeedWorld`) takes the same `crossTokens` (as `TokenInfo`, metadata
  registered). Per stock: 14 ERC-20 pairs × 40 calls (7 v3 tiers, 2 Aerodrome v2, 2 Aero v2, 22 + 7
  Slipstream spacings) plus 15 currency pairs × 4 v4 keys = 620 calls, 6,200 for the ten (about 13
  multicalls). The ten in `DEPTHWATCH_SEED_TOKENS` would add 8,180 calls instead, 45 of their
  pairs stock × stock, growing with the square of the list (71 tokens: 153,360 against 44,020).
- Fixtures: `fixtures/stocks.ts` `addStockFixture(fixture, { stock, feed, block, answer, updatedAt,
  roundId?, decimals?, description?, oraclePaused?, multiplierWad?, pausedOrdinals?, revert?,
  malformed? })` with `encodeFunctionResult`; `revert` and `malformed` name calls that revert or
  answer bytes that do not decode (a multi-word answer cut to its first word, a one-word answer to
  one byte). `stock` is the token's address and `feed` its `StockFeed` (defaults: its decimals,
  `Coinbase <ticker>`), or null for a stock without one, whose two token calls alone are
  registered, as the reader sends no more; `multiplierWad` (default 10^18) answers both the
  token's `multiplier()` and the oracle registry's multiplier, as on chain; `oracleRegistry?`
  (default `STOCK_PROTOCOL.oracleRegistry`) serves a synthetic stock list.

## 4. Pipeline (`apps/cli`)

- **Tracking** (new `pipeline/tracking.ts`): `rankPools`, `selectTracked` and `mandatedPoolIds`
  move there from `snapshot.ts` (398 lines; its tests import them from the new file), beside
  `stockPoolIds(ranked, stocks)` and `STOCK_TRACK_MIN_RANK_USD = 2 × HEALTH_RATING_MIN_SIDE_USD`
  ($10,000). `poolTvlUsd` (the ranking's TVL) moves with them, so `snapshot.ts` imports from
  `tracking.ts` and never the other way. `stockPoolIds` takes the stock list's addresses
  (`Iterable<Address>`, any case) and returns the ids sorted; `snapshot.ts` calls it (phase G) with
  the addresses of `chain.stocks` and logs the count (`selected tracked pools … stocks=<n>`).
  `mm.ts` (393 lines) is not touched.
- **Seed** (`seed.ts`): `crossTokens` = the addresses of `chain.stocks.tokens` on every `discover
  --seed`, `run --seed` and `start` seed (all three run `seedStep`), logged as `stocks=<n>` on the
  `seeding from factory views` line; `DEPTHWATCH_SEED_TOKENS` is unchanged and stays unset for
  stocks. Log
  discovery (`discover`) finds stock pools like any pool. Before this change no seed asks for a
  stock pair, so the refresh workflow's database holds no stock pool.
- **Snapshot** (new `pipeline/stocks.ts`; `snapshot.ts` only calls it):
  1. (From phase G.) `stockPoolIds`: ranked pools holding a stock with `rankUsd ≥
     STOCK_TRACK_MIN_RANK_USD` join the explicit tracked set beside `--pool` and mandates,
     whatever their rank (a hooked pool is not ranked, so only `--pool` tracks it). A smaller
     stock pool is tracked only if it ranks in.
  2. `chain.readStocks(latest.number)` runs beside the state reads (`Promise.all` with them, same
     block and abort signal); `evaluateStockReading` per stock (`readStockPass`). A failed
     request is logged as `stock reads failed` (one line) and stored as `unread` readings; a
     failed call is one `stock calls failed` line for its stock, whose reading core judges from
     the answers it has; any other error the reader throws counts as a failed request, and a stop
     (the pipeline's signal) ends the step with the signal's reason. One `read stocks` line counts
     the statuses. An empty stock list sends no request.
  3. With the pass's final prices: `poolReference` for every snapshotted pool with a stock, with
     its ±2 % sides and `feePips`, and `quoteIndependent = quoteRouteAvoids(prices.get(quote).via,
     ids)`, `ids` being every pool of the pass's overviews (`views`) that holds the stock, tracked
     or not, since every overview is an edge of the price graph. `withReference(snapshot, pool,
     inputs)` sets it on the built snapshot, since it needs the snapshot's own ±2 % sides;
     `buildSnapshot` itself stores `null` and keeps its signature.
  4. Per stock, `summarizeStock` over the pass's snapshots of its pools (volume `null`) gives the
     reading's `StockPassDepth` (`stockReadingRecords`). A stock without a pool in the pass
     stores the aggregate of none (`sidesKnownPools` 0, `no-pool`), so the step never stores a
     null pass depth.
  5. In the storing transaction: `stocks.replaceAll(stock list rows)`,
     `stockReadings.insertMany(readings with their pass depth)` (one per stock and block, `OR
     IGNORE`), the snapshots with their `reference`. The list's `updatedAt` is the block's
     timestamp, as the `prices` table's; the readings are stored, as the prices are, in a pass in
     which every pool failed; `SnapshotResult.stockReadings` counts the rows stored.
- **Score**: `HealthInputs.transfersPaused = latest.reference?.transfersPaused === true`.
- **Prune**: `stock_readings` is not pruned. At ten rows a pass it holds about 30,000 rows a year
  at the refresh workflow's 3 h cadence, and it is the only record that outlives the snapshots
  (`DEPTHWATCH_KEEP_DAYS=8` there), so the deferred off-hours series (§8) can be computed from the
  first pass on.
- `run`, `start`, `volume`, `positions`: no change; stock pools are tracked pools. The demo world
  gets no stock in the MVP (§8), so `demo` and `export --demo` answer the stock routes empty:
  `createDemoChain` passes an empty stock list (`DEMO_STOCKS`), so no stock read is sent.

## 5. Storage (`packages/db`, schema version 8, one appended migration)

```sql
ALTER TABLE snapshots ADD COLUMN reference_json TEXT;
CREATE TABLE stocks (token TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT NOT NULL,
  decimals INTEGER NOT NULL, ticker TEXT NOT NULL, feed TEXT, feed_decimals INTEGER,
  heartbeat_seconds INTEGER, deviation_threshold_bps INTEGER, feed_hours TEXT,
  updated_at INTEGER NOT NULL);
CREATE TABLE stock_readings (token TEXT NOT NULL, block_number TEXT NOT NULL,
  timestamp INTEGER NOT NULL, status TEXT NOT NULL, reference_usd REAL, feed_age_seconds INTEGER,
  feed_round_id TEXT, feed_answer TEXT, feed_updated_at INTEGER, oracle_multiplier TEXT,
  oracle_paused INTEGER, token_multiplier TEXT, paused_features TEXT, error TEXT,
  pass_depth_json TEXT, PRIMARY KEY (token, block_number));
CREATE INDEX stock_readings_timestamp ON stock_readings(timestamp);
CREATE INDEX stock_readings_token_timestamp ON stock_readings(token, timestamp);
```

bigints are decimal TEXT; `paused_features` is the names comma-separated in ordinal order (`''`
for none, NULL when unread); `reference_json` is `PoolReference` and `pass_depth_json` is
`StockPassDepth` (no bigint). `feed_age_seconds` stores the reading's `feedAgeSeconds` as core
computed it: its `null` cases (no feed, `unread`, a bad `updatedAt`) are core's rule, which a read
must not derive again from `timestamp` and `feed_updated_at`. `transfersPaused` is not stored: a
read gives core's `isTransferPaused` of the stored features, exactly what `evaluateStockReading`
set. Repositories: `stocks` (`replaceAll(stocks, updatedAt?)`, `list()` by ticker then address,
`get(token)`, `count()`; a `StockListEntry` is a `StockInfo` with the list's `updatedAt`),
`stockReadings` (`insert` → whether it stored the row, `insertMany(records)` → how many, a
`StockReadingRecord` being `{ reading, passDepth: StockPassDepth | null }`; `latestFor(token)` and
`latestForMany(tokens)` → the newest `StockReading` by timestamp, then block number, since five
blocks share a second after Denim, each one search of the `(token, timestamp)` index
(`latestForMany` loops over `latestFor`: the never-pruned table makes a window over every row of
the stocks grow without limit, about 0.6 s at two years of `start`; a review fix, in migration 8
since it had not shipped); `seriesFor(token, fromTs, toTs?)` → the records oldest first,
used by the deferred history; `count()`), and on `snapshots`: `reference` round-trips and
`latestReferences(poolIds) → Map<poolId, PoolReference | null>`. The db fixtures add
`fixturePoolReference(overrides?)` (METRICS.md's +25.06 bps example) for the API's tests. `seriesSummaryForPool` is unchanged: history points carry only `health.total`, which
`transfersPaused` does not change (it changes `rated` and `unratedReason`). `schema.test.ts` pins
the new migration's sha256; DESIGN.md "Storage" lists the tables.

The generic depth sums leave a paused pool out as they leave a stale quote out (METRICS.md, "Stock
tradability"): `PAUSED_SQL = COALESCE(json_extract(s.health_json, '$.unratedReason') =
'transfers-paused', 0) = 1` beside `STALE_SQL` in `repos/scoreStats.ts` (NULL-safe like
`STALE_SQL`: a score without a reason is not paused, where `NOT (NULL)` would drop it from the
sums), joined with it as `LEFT_OUT_SQL` where `STALE_SQL` filtered a sum (`statsByDex`,
`scores.tokenDepth`); a depth sort still puts only the stale quotes last. In the web, `lib/depthSums.ts`
(`countsInDepthSums`: no stale quote, `unratedReason` not `transfers-paused`) is the one test the
butterfly's totals, segments and shares (`ButterflyRow.paused`, "left out of Base's total:
transfers paused", the Show-data table's reason), the mock's stats and token depth, and the token
page's Pools takeaway (whose deepest pool is taken among the pools the API's total sums) apply.

## 6. Tests (hermetic; the API and web tests are in stocks-api.md §6)

- core: every status and its order, every `deviationNull` and its order (`thin` right after
  `hooked`), the 90,000 s boundary, the weekly close on both sides of each edge and across both
  daylight-saving changes, the four METRICS.md off-hours readings, `withinTolerance` at, inside and
  outside the band and with `feePips` null, signs on both orientations, `decodePausedFeatures`,
  `rateDepth` order (`hooked`, `transfers-paused`, `unpriced`), `summarizeStock` (stale and paused
  left out, v4 TVL, ties, shares, no pool), the multiplier never applied (5.38 bps for NVDAc's);
  `workedExamples.test.ts` reproduces METRICS.md.
- chain: `reader.stocks.test.ts` on the fixture transport: answers; a reverted or malformed
  `getOracleParams` → `unread`; an oracle paused answer → `paused`; a reverted `pausedFeatures`
  or `multiplier` → those fields null and the status unchanged; a failed request → `raw: null`;
  the block passed through. `reader.seedStocks.test.ts`: cross pairs only, no stock × stock key,
  candidate counts, ETH only on v4. `stocks.test.ts` keeps the trade-allowlist and subpath pins.
- db: migration 8 on a v7 file (old snapshots read `reference: null`), the sha256 pin, both repos
  (unique token and block, latest, series bounds), `latestReferences`, `PAUSED_SQL` in the stats
  and a token's depth.
- cli: `tracking.test.ts` (the moved cases, the $10,000 floor at and below it);
  `snapshot.stocks.test.ts` (tracked whatever the rank from the floor; reading and pass depth
  stored; `held`, `paused` and `thin` give `null`; a quote priced through an untracked stock pool
  → `quote-unpriced`; a failed read stores `unread` and the snapshot succeeds; `pausedFeatures`
  [0] → score unrated `transfers-paused`); `seed.stocks.test.ts`; prune leaves readings. The
  snapshot cases run over the synthetic world with a synthetic stock list in which cbBTC stands
  in for a stock; `thin`, `hooked` and `quote-unpriced` are in `pipeline/stocks.test.ts` on built
  Uniswap v4 pools (`apps/cli/src/testing/v4Pools.ts`), since every synthetic pool is quoted in
  USDC, an anchor, and deep.

## 7. MVP: cut, effort and phases

The refresh workflow publishes the static site from `main` only, and builds on the 200 ms block
schedule of PR #32. The sooner the MVP is on `main`, the more weekends and holidays (Thanksgiving,
Thursday 2026-11-26) the stored readings cover; the deferred off-hours figures (§8) are computed
later from those readings. The MVP was built in phases, each passing `pnpm check:all`, and merges
once, after phase G. Effort per item (new files: +):

**A. Core (6.5 h).**
- 3 h: `packages/core/src/stocks/{types,hours,reference,aggregate}.ts` +, the barrel (§2).
- 2.5 h: `packages/core/src/stocks/*.test.ts` +, `workedExamples.test.ts` + (§6).
- 1 h: `transfers-paused` and `BIGINT_KEYS`: `packages/core/src/{types,json}.ts`,
  `metrics/health.ts` (+test), the web's `lib/rating.ts` (+test, `PoolCells.test.tsx`), the
  openapi `UnratedReason` enum, AGENTS.md's reason list and the README's, DESIGN.md "Shared types".

**B. Chain (4.5 h).**
- 0.5 h: `packages/chain/src/stocks.ts` (`StockList`, `BASE_STOCKS`, `resolveStockList`,
  `stockInfos`; `stocks.test.ts`), `abi/{chainlinkFeed,b20,coinbaseOracleRegistry}.ts` +.
- 1 h: `internal/stocks.ts` +, `reader.ts` (`readStocks`, the `stocks` option),
  `internal/swapScans.ts` (the sort that leaves `reader.ts`), the package barrel.
- 1.5 h: `seed/{index,candidates,aero}.ts` (`crossTokens`, seeders take pairs),
  `fixtures/seedWorld.ts` (`crossTokens`).
- 1.5 h: `fixtures/stocks.ts` +, `reader.stocks.test.ts` +, `reader.seedStocks.test.ts` +;
  DESIGN.md "Chain adapters".

**C. Storage (3.25 h).**
- 2.5 h: migration 8 in `packages/db/src/schema.ts` (+ the sha256 pin, the upgrade test),
  `database.ts`, `repos/{stocks,stockReadings}.ts` + (+tests), `repos/snapshots.ts` (+test);
  `PoolSnapshot.reference` (null from every builder) in core `types.ts`, its openapi property and
  the web's `api/types.ts`; DESIGN.md "Shared types" and "Storage".
- 0.75 h: `PAUSED_SQL` in `repos/{scoreStats,scores}.ts` (+tests), the web's
  `components/charts/butterflyModel.ts` (+test) and `api/mock.ts`.
- Done with them: `stock_readings.feed_age_seconds` (§5); `repos/snapshots.reference.test.ts` +
  (`snapshots.test.ts` is at 399 lines) and the version-7 case of `database.upgrade.test.ts`, every
  older rollback there and in `database.processes.test.ts` undoing version 8; the openapi schemas
  `PoolReference`, `ReferenceStatus` and `ReferenceNullReason`, which `PoolSnapshot.reference`
  needs (phase E adds the others), and an `agentDocs.test.ts` case serving a live and a held
  reference; the paused clause ("left out of the depth sums") in the openapi `UnratedReason`, the
  stats' and a token's depth descriptions, AGENTS.md, the README, DESIGN.md, `dto.ts` and the
  web's `api/types.ts`, METRICS.md's "A token's depth" (its definition unchanged: "Stock
  tradability" already left paused pools out of it), ia-v3.md §6 and visual-v4.md §6.2; the
  web's `lib/depthSums.ts` +, `components/charts/ChartTables.tsx` and `pages/token/tokenText.ts`
  (§5), with a paused case in `pages/Token.test.tsx`; the schema-8 refusal and upgrade note in
  docs/DEPLOY.md "Upgrading" (pinned by `apps/cli/src/start/docs.test.ts`) and the two tables in
  docs/ARCHITECTURE.md's storage model.

**D. Pipeline (3 h).**
- 0.5 h: `apps/cli/src/pipeline/tracking.ts` + (+test), `snapshot.ts`, `snapshot.test.ts` (the
  move, `stockPoolIds`).
- 2.5 h: `pipeline/stocks.ts` + (+`snapshot.stocks.test.ts`), `score.ts`, `prune.test.ts` (§4:
  reads, references, pass depth, score).

Done with them: `poolTvlUsd` moved into `tracking.ts` with the ranking; `withReference` sets
the reference on the built snapshot instead of a `buildSnapshot` parameter (§4, step 3); the
log lines and error rules of `readStockPass` and the never-null pass depth (§4, steps 2 and 4);
`SnapshotResult.stockReadings`; `DEMO_STOCKS` in `apps/cli/src/demo.ts`; the test pools of
`apps/cli/src/testing/v4Pools.ts` + (`snapshot.test.ts` uses them too) and
`pipeline/stocks.test.ts` +; a `scorePool` case in `score.test.ts` (paused, not paused, and
unknown, which is not a pause); in `apps/cli/src/main.test.ts` the fake RPC world answers the ten
stocks, since over HTTP a read the fixture lacks is an internal error that the reader retries;
the prune comment; DESIGN.md "CLI (apps/cli)".

**E. API and its documents (6.25 h).**
- 2 h: `apps/api/src/{stocks,stockDto}.ts` +, `dto.ts`, `routes/stocks.ts` +, `routes/index.ts`,
  the `caching.ts` header comment (stocks-api.md §1).
- 1 h: `apps/api/src/testing/stocks.ts` +, `routes/stocks.test.ts` +, `routes/agentDocs.test.ts`.
- 2.5 h: README `## API`, DESIGN.md `## API (apps/api)`, `agentDocs/openapi.json`,
  `agentDocs/AGENTS.md` (the route sections, the stock section, the Errors row), `llms.txt`.
- 0.75 h: `StaticBundle` in `apps/api/src/dto.ts` and its mirror in the web's `api/types.ts`,
  `apps/cli/src/export.ts` (+test), docs/design/web-v2.md §4.

Done with them (stocks-api.md §1, §2 and §4 say how): `updatedAt` is the stock list's; the pools
are read page by page up to `total` rather than one page of 200; the shared 400 body
`INVALID_ADDRESS` in `apps/api/src/query.ts`; `comparePoolRows`, `compareStocks`, `listStocks`,
`stockDetail`, `seedStocks` and the stock DTO types exported from the API's barrel (the CLI's
export test seeds stocks); the web's `api/stockTypes.ts` + (the wire types the bundle mirror
names); `StockDetail` repeating `StockSummary`'s properties in openapi, a `stocks` tag, and the
`info`, `BadRequest` and `NotFound` texts; the README's 404 sentence and a paragraph on
`referenceUsd`, the valuation convention and eligibility; `export --bundle` keeping an older
bundle without the stock keys, with its test; `apps/api/src/routes/webhookSecret.test.ts`, which
reads every GET route for the webhook canary, seeds the stocks and reads both stock routes too.

**F. Dashboard (7.25 h).**
- 1.5 h: `apps/web/src/api/{stockTypes,mockStocks}.ts` +, `api/{client,mock,static}.ts`.
- 3 h: `pages/{Stocks,Stock}.tsx` +, `pages/stock/*` +, their css (stocks-api.md §3).
- 1 h: the routes and the fifth tab: `App.tsx`, `routeData.ts`, `components/shell/{Nav,Dock}.tsx`,
  `styles/shell.css`, `components/Layout.test.tsx`, `App.test.tsx`, docs/design/ia-v3.md §1.2 and
  §2, docs/design/visual-v4.md §5.1.
- 0.75 h: the pool page's stock row and eligibility line, the gate test (`pages/pool/*`,
  `poolPage.test.tsx`, `tradeSection.test.tsx`), the footer line (`components/shell/Footer.tsx`,
  `Footer.test.tsx`, visual-v4.md §5.1 "Footer"), and "Transfers paused" in the Methodology page's
  list of unrated reasons (`pages/docs/content.tsx`, `Methodology.test.tsx`).
- 1 h: `pages/{Stocks,Stock}.test.tsx` +.

Done with them (stocks-api.md §3, "As written", says how): `StockApi` in `api/stockTypes.ts`, which
`ApiClient` extends (`types.ts` stays at 493 lines), with `stockPath` and both calls in the HTTP,
pending, mock and static clients, `useStocks` and `useStock`, the prefetch keys and `cachedStock` in
`routeData.ts` (`components/routeIntent.test.tsx`); the static client's envelope check of the two
optional keys and `testing/staticBundle.ts` reading them (`api/staticStocks.test.ts` +); the mock's
seven stocks, one per status, and its stock pools out of the generic lists, with `buildPool(seed,
now, { tokens, transfersPaused })` in `api/mockPools.ts`, the seeds in `api/mockStockSeeds.ts` +
(`api/mockStocks.test.ts` +); the shared words in `lib/stockText.ts` (+test) and the pages'
sentences in `pages/stock/stockPageText.ts`; the pool page's stock row as the first row of its
sections sheet (`pages/pool/PoolStock.tsx` +) and the valuation label in About this pool's "Prices
used"; `DESIGN.md` "Dashboard (apps/web)" and docs/ARCHITECTURE.md's web row; the boot budget of
`src/tradeBundle.test.ts`, re-based for the two pages (578,257 → 604,213 bytes, server build);
`testing/noTrade.ts` +, the check that no link or button of a stock surface offers a buy, a trade or
a swap; the paused pools' sentence in the Methodology page's depth section.

**G. Switch on (1 h).** `crossTokens` in `apps/cli/src/pipeline/seed.ts` and `stockPoolIds` in
`snapshot.ts` (+`seed.stocks.test.ts`, the tracking case of `snapshot.stocks.test.ts`);
docs/ARCHITECTURE.md (the stock seed counts and the data flow) with their pins in
`architecture.test.ts`; DEPLOY.md ("A free static copy"); ROADMAP.md.

Done with them: the `stocks=<n>` fields of the seed's and the tracked set's log lines (§4); the
tracking case runs at `--top 0` and `--top 3` (the synthetic stock pool ranks fourth) and with a
stock list without cbBTC, while the $10,000 floor itself stays in `tracking.test.ts`, since every
synthetic pool ranks far above it; the seed worlds of `pipeline/seed.test.ts`,
`pipeline/seed.refresh.test.ts` and `secrets.test.ts` answer the ten stocks' cross pairs
(`registerSeedWorld({ crossTokens: BASE_STOCKS.tokens })`), since their default reader now asks
for them and a pair the fixture lacks fails the seed (over HTTP it is retried with backoff), the
first's Uniswap v3 candidate count derived as (3 + 10 × 3) × 7; the stock seed counts in
ARCHITECTURE.md's "Seeded discovery", pinned against `seedPairs`, `BASE_STOCKS`, the tiers and
`DEFAULT_MAX_CALLS_PER_MULTICALL` in `pipeline/architecture.stocks.test.ts` + (in
`architecture.test.ts` they would take it past 400 lines; both read the page through
`apps/cli/src/testing/architectureDoc.ts` +), its data-flow diagram and steps 1, 4 to 7, and its
"Budget at the defaults" (the stock multicall, the stock pools beside the 200, the stocks' seed
calls); the
seed and snapshot sentences of the README, DESIGN.md "CLI (apps/cli)" and its opening, and the
served AGENTS.md's coverage sentence; the Refresh site workflow's first-run comment; ROADMAP.md's
"After Layer 1: tokenized stocks" and three non-goals (no stock in the swap panel, no stock price
of Depthwatch's own, the feeds read on chain); `apps/web/src/pages/stockPoolLists.test.tsx` +,
which renders Home, Pools, Gaps and both token pages with a stock pool in their lists, as the API
answers them from this phase on, and finds the eligibility line in each page's footer, outside
`<main>` (every route is a child of `Layout`, whose footer is outside the route error boundary;
the boot's service-down and bundle-error screens show no pool).

In all about 32 hours (6.5 + 4.5 + 3.25 + 3 + 6.25 + 7.25 + 1), a little over the 25–30 h
target. If time runs short, `PAUSED_SQL` (0.75 h: no pause has occurred, and the stock pages leave
a paused pool out already; METRICS.md's "Stock tradability" then names the stock aggregates only)
and the list page's venue bar (stocks-api.md §3) move to §8 first. No
new dependency (DESIGN.md "May import" unchanged); no file above about 400 lines (`snapshot.ts`,
`reader.ts`, `dto.ts`, core and web `types.ts` delegate to new files).

Why this order: A to C add code that nothing calls yet; in D the pipeline stores readings, pass
depth and references, for stock pools that are tracked anyway (none before G, since no seed asks
for a stock pair); E adds the API and its documents, F the dashboard; G switches seeding and the
forced tracking on, last, so the commit that first brings stock pools into the generic lists is
one that already has their pages and eligibility lines.

## 8. Deferred (not in the MVP)

1. **History route** `GET /api/stocks/:token/history?window=24h|7d` (default `7d`), with its
   cache header, rule-8 documents and the bundle's `stockHistory`: stocks-api.md §5.
2. **Off-hours depth** and `heldToLive`, computed from the stored readings' pass depth; their
   definition is in stocks-api.md §5 and moves to METRICS.md in the change that implements them.
3. **Token-page stock marker** (`TokenDetail.stock` or a link, a schema change) and the
   eligibility line on the token page; until then the footer line covers it (stocks-api.md §3).
   The valuation label is not deferred: a stock's token page names its price "valuation price"
   with the label (from `GET /api/stocks`, no schema change).
4. **`isAuthorized(policyId, pool)`** per stock pool and snapshot (one call per pool; every pool
   checked was authorized under policy 5, a BLOCKLIST).
5. **A synthetic stock in the demo world** (`DEMOc` with a USDC pool on Slipstream and a feed 30
   bps below it, `HELDc` with a feed 40 h old), so `demo` and `export --demo` show both states.
6. **The issuer API's 71 minted tokens**, from a first-party list only (§9).
7. **A Methodology section** for the stock metrics; meanwhile the stock pages link to
   METRICS.md's "Reference deviation" on GitHub, as the Methodology page links its documents.
8. **A prune floor** for `stock_readings`, with the history route.

## 9. Open questions

1. **Flag to Base:** base.org's "full list" against the issuer API's 71 minted tokens; "precompiles
   hold no bytecode" against `eth_getCode` 0xef; the list page's "including the Onchain Registry"
   against the `/chains` endpoint; Base's "nights" against Chainlink's overnight session (the
   feeds update overnight); no document gives the oracle registry's ABI.
2. **Holidays.** A weekday holiday reads mostly `live` (METRICS.md, "Off-hours"). Thanksgiving's
   stored readings show whether it follows Labor Day's pattern; only a first-party session signal
   would close the gap without a maintained calendar.
3. **Stock pools as price hops** stay in the price graph; revisit if one becomes a token's route.
