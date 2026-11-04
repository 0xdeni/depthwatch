# Architecture

This page describes how Depthwatch is put together: the packages, the data flow from factory logs
to the dashboard, what each step costs in RPC calls, how data is stored, how the chain code is
tested without a network, and how to add a DEX adapter. [DESIGN.md](../DESIGN.md) is the contract;
this page explains it.

## Principles

- **Base mainnet only.** `chainId` is hard-wired to 8453. Supporting another chain is a non-goal.
- **Pure core.** `@depthwatch/core` has zero dependencies and does no I/O. Every metric lives there
  and nowhere else, so a number on the dashboard is reproducible from a `PoolState` and a few USD
  prices.
- **Raw amounts are `bigint`.** Swap simulation and depth are exact integer math with the same
  rounding as the contracts. Conversion to `number` happens once, at the human-facing edge
  (`rawToHuman`), never in the middle of a computation.
- **Hermetic tests.** Chain code is exercised through a fixture transport that answers JSON-RPC
  requests from recorded data. `pnpm test` never reaches the network: the only sockets are loopback
  servers on `127.0.0.1` that a test starts itself (the API, `serve` and `start` servers, a webhook
  receiver, a fixture JSON-RPC endpoint).
- **Never extrapolate.** A pool state carries the tick range it is known for. Simulations stop at
  the boundary and report `complete = false` rather than invent liquidity.

## Packages

| Package             | Depends on                                                                                         | What it owns                                                                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@depthwatch/core`  | nothing                                                                                            | `types.ts` (shared types), tick math, sqrt-price math, swap simulation (concentrated, constant product, stable swap), metrics (depth, spread, concentration, persistence, health, gap, TVL), price graph, JSON bigint helpers, test builders; `mm/`: mandate parsing, attribution, KPI evaluation, scorecard summaries |
| `@depthwatch/chain` | core, viem                                                                                         | Base addresses and ABIs, `ChainReader` (discovery, overview, state, positions, swaps, LP holdings and gauge-staked owners), fixture and recording transports                                                                                                                                                           |
| `@depthwatch/db`    | core                                                                                               | `openDatabase`, migrations, repositories (`pools`, `tokens`, `snapshots`, `volume`, `positions`, `prices`, `scores`, `syncState`, `mandates`, `mmSamples`, `mmAlerts`), fixture builders for other packages' tests                                                                                                     |
| `@depthwatch/api`   | core, db, hono, zod                                                                                | `createApp(db, { staticDir, adminToken })`: REST routes, validation, static SPA serving; `/api/mm` scorecards and badge                                                                                                                                                                                                |
| `@depthwatch/web`   | core, chain (`./addresses` only), react, tanstack-query, react-router, viem (lazy swap panel only) | Dashboard (pools, gaps, tokens, scorecards); HTTP client and mock client behind one `ApiClient` interface; the lazy swap panel (`src/trade/`), off unless the trade switch is on                                                                                                                                       |
| `@depthwatch/cli`   | everything                                                                                         | `depthwatch` commands (`mm …` included), the mandate sampling hook and alert delivery; the only place that wires chain → core → db → api                                                                                                                                                                               |

There is no build step for Node packages. Package entry points are `src/index.ts`, `tsx` runs
TypeScript directly, and workspace imports resolve through each package's `exports` map. Only the
dashboard is built (Vite) and only so that `depthwatch serve` can serve static files.

## Data flow

```
                 ┌────────────┐
  factory logs ─►│  discover  │─► pools, sync_state
                 └────────────┘
                        │ all pools
                        ▼
                 ┌────────────┐     ┌────────────┐     ┌────────────┐
                 │  overview  │────►│   prices   │────►│    rank    │─► tracked = top N by TVL
                 └────────────┘     └────────────┘     └────────────┘
                   slot0/reserves     widest-path USD          │
                        │                                      ▼
                        │                               ┌────────────┐     ┌────────────┐
                        │                               │   state    │────►│  metrics   │─► snapshots
                        │                               └────────────┘     └────────────┘
                        │                             tick-bitmap walk    depth / spread /
                        │                                                 concentration / TVL
                        ▼
                 ┌────────────┐                         ┌────────────┐
  Swap events ─►│   volume   │─► volume_hourly ───────►│   scores   │─► scores
                 └────────────┘                         └────────────┘
                                                        persistence / health / gap
                                                               │
                                                               ▼
                                                      ┌────────────┐     ┌────────────┐
                                                      │    API     │────►│    web     │
                                                      └────────────┘     └────────────┘
```

Each step reads what the previous one stored, so any step can be rerun on its own.
1. **discover** (`depthwatch discover`). For each DEX, scan the factory's creation event from the
   last processed block (`sync_state` key `discover:<dex>:lastBlock`, or `--from-block`) to the
   head in windows of 50 log chunks; after each window its pools are upserted and the cursor
   advanced in one transaction, with a progress line (blocks done of total, %, pools, elapsed,
   ETA), so an interrupted first scan resumes at the failed window. Decode the event into a `PoolMeta`, resolve token metadata (`symbol`, `name`,
   `decimals`, cached in `tokens`; bytes32 symbols and missing metadata fall back to a derived
   symbol), lowercase every address and upsert. Uniswap v4 pools have no address: they are keyed
   by `poolId` and `currency0 == 0x0` is native ETH. Without a logs endpoint that serves wide
   ranges, `depthwatch discover --seed` finds the pools of every pair of the reference tokens
   instead, from factory views at the head, and dates each by binary search over archive state
   (see [Seeded discovery](#seeded-discovery-factory-views-and-archive-state)); it records
   `seed:<dex>:lastBlock` and leaves the log cursors alone.
2. **overview** (first half of `snapshot`). For every pool, read the cheap state in one pass:
   `slot0` and `liquidity` for concentrated pools, `getReserves` for Aerodrome v2 and Aero v2,
   `getSlot0` / `getLiquidity` from StateView for v4, plus token balances for TVL. Calls are batched
   through Multicall3, at most 500 calls per request.
3. **prices**. Every overview with a positive price and depth on both sides of it becomes a
   `PriceEdge` (token0, token1, price, its ±2 % depth sides); a hooked pool is no edge.
   `derivePrices` runs a widest-path search from the anchors (USDC = 1, other stables = 1),
   weighing each edge in USD by its thinner side when it reaches it: the route chosen for a token
   is the one whose weakest pool is strongest, so a USD price comes through the deepest route and
   a token with no route to a stable gets no price.
   The result is stored in `prices` with the `via` chain of pool ids, plus `wrap:weth` for the
   native ETH ↔ WETH step.
4. **rank**. Pools are ranked by `tvlUsd`, a Uniswap v4 pool (no reserves of its own, so no TVL)
   by the USD value of its ±2 % depth and a hooked pool not at all; the top N
   (`DEPTHWATCH_TOP_POOLS`, default 200) are marked `tracked`, plus the pools named with `--pool`
   and those of active mandates. Everything downstream runs for tracked pools only; untracked pools still have
   an overview, a price and a TVL.
5. **state** (second half of `snapshot`). For each tracked pool, read a full `PoolState`.
   Concentrated pools need the initialised ticks around the current price: walk `tickBitmap`
   words covering at least ±10 % (twice the 5 % concentration band), then read `ticks()` for every
   initialised tick, all multicall batched. The resulting `ConcentratedState` carries
   `tickLowerBound` / `tickUpperBound` so the simulator knows where its knowledge ends. Reserve
   pools are complete after `getReserves`.
6. **metrics**. Pure calls into core: `computeDepth` at 1 / 2 / 5 %, `depthToUsd`,
   `computeEffectiveSpread` at $1k / $10k / $100k / $1M, `computeConcentration` (or
   `computeConcentrationForReserves`), `tvlUsd`. The output is one `PoolSnapshot` per pool.
7. **snapshots**. Inserted with the block number and block timestamp. Three denormalised columns
   (`depth2_usd`, `spread10k_bps`, `owner_top1_share`) are filled from the JSON so that the
   dashboard's sorts are plain SQL; `owner_top1_share` only where the owners cover the pool (core's
   `poolOwnerTop1Share`, NULL otherwise). A read does not trust `spread10k_bps`: a row stored before the
   price impact cap holds the uncapped number, so the repositories take the $10k spread, and every
   point of `spreads_json`, through core's `feasibleSpreadBps` rule.
8. **volume** (`depthwatch volume`). `Swap` events for tracked pools over the last 24 h (or
   `--hours`), chunked `getLogs`, bucketed per hour; token amounts stay `bigint`, the USD value
   uses the `prices` table. Upserted into `volume_hourly`, so reruns are idempotent. Incremental:
   a later pass starts at the hour that held the previous pass's head (per-pool coverage in
   `sync_state`, `volume:<pool>:lastBlock` and `volume:<pool>:fromTs`; the head's block and
   timestamp in `volume:lastBlock` and `volume:lastTs`).
9. **scores** (`depthwatch score`). For each tracked pool: the snapshot series over 24 h and 7 d
   → `computePersistence`; the 24 h volume (`computeVolume24hUsd`: the 24 whole hourly buckets
   before the hour of the last block the volume pass read, anchored to that block rather than to
   the scoring clock, see METRICS.md "24 h volume"); `computeHealthScore` from the
   latest snapshot (its two ±2 % sides, so the pool is rated or says why not) and the 24 h
   persistence; `computeGap`. One row per pool in `scores`, with
   `health_total` and `gap_score` denormalised for sorting. Rows of pools that are no longer
   tracked are deleted in the same transaction, so the API only ever serves the current set.
10. **API** (`depthwatch serve`). Hono routes over the repositories. Every query is validated with
    zod; every response is JSON with bigints as decimal strings (`toJsonSafe`). When
    `apps/web/dist` exists it is served with an SPA fallback to `index.html`.
11. **web**. React dashboard. It reads `/api` through an `ApiClient` interface that has an
    HTTP implementation and a mock implementation (`VITE_MOCK=1`, or the dev server when the API
    is down; never a production build) backed by JSON in `apps/web/src/mock`. Bigint strings are formatted with BigInt arithmetic in `lib/format.ts`.
    The static build reads the exported bundle instead and also serves `data/flags.json`, the trade
    switch, with `public/_headers` (no framing, a Content-Security-Policy, that file uncached). The
    optional swap panel (`src/trade/`, lazy), off unless the switch is on, is the one part that
    talks to anything else: the reader's own wallet (EIP-1193), for its reads and the transactions
    the reader signs (DESIGN.md, "Dashboard (apps/web)").

`depthwatch positions` is a separate, less frequent step (`run` folds it into every pass for the
concentrated pools of active mandates, `run --with-positions` for every tracked pool): it indexes
LP positions (owner, range, liquidity) for tracked concentrated pools, and
for concentrated pools with an active mandate whether or not they are tracked yet, so that the next
`snapshot` can compute owner concentration and attribute the mandates; it also records each
Slipstream pool's gauge, whose staked positions count as uncovered rather than as one owner.
Without it `concentration.owners` is null and the health score falls back to the structural range
HHI, as it does when the indexed owners cover under 90 % of the in-band liquidity (an Aerodrome
v2 or Aero v2 pool scores the neutral 10).

## Market-maker scorecards

Layer 2 ([SCORECARDS.md](SCORECARDS.md)) adds no pipeline step. A mandate (`mandates` table) names
one pool, the market maker's addresses and its KPIs; sampling runs inside `snapshot`, alerts are
delivered right after, and the API summarises the samples (once per mandate, new sample or minute).

```
                 ┌────────────┐                     ┌────────────┐
  mandates ─────►│  snapshot  │─► snapshots         │    API     │─► /api/mm, badge.svg
  (active pools  │  + sample  │─► mm_samples ──────►│  summarize │
   always        │  + alerts  │─► mm_alerts         └────────────┘
   tracked)      └────────────┘       │                    │
                   state, positions   ▼                    ▼
                   prices, holdings   webhook (POST)      web /mm, /mm/:id
```

### Sampling hook inside `snapshot`

1. **Tracking.** Before ranking, `snapshotStep` adds the pool ids of every active mandate
   (`db.mandates.list({ active: true })`) to the explicitly requested set, so a mandated pool gets
   a full state read whether or not it ranks in the top N. A mandate whose pool is not in the
   database yet (not discovered) is logged and skipped, never fatal.
2. **Attribution.** Right after `buildSnapshot`, for each pool that has mandates,
   `sampleMandates` (`apps/cli/src/pipeline/mm.ts`) produces one `MmSample` per active mandate
   from the same `PoolState`, prices and stored positions the snapshot used:
   - concentrated pools: the stored positions of the pool; on Slipstream, when any position is
     owned by the pool's `CLGauge`, `resolveStakedOwners` asks the gauge
     `stakedContains(candidate, tokenId)` for each registered address and rewrites the owner to the
     depositor (one read for the addresses of every mandate of the pool; when it fails, one read
     per mandate, and a mandate whose read fails is an attribution failure, never sampled with its
     staked liquidity missing); then `filterPositionsByOwners` → `buildMmConcentratedState`. No
     stored positions means attribution method `none` (a breach by rule 1);
   - Aerodrome v2 and Aero v2: `readLpHoldings` reads `balanceOf` / `totalSupply` on the LP token
     and `Gauge.balanceOf` when the pool has a gauge (Aerodrome v2: `Voter.gauges(pool)`; Aero v2:
     `FactoryRegistry.targetToGauge(pool)`, since Aero's Voter has no pool views), at the snapshot
     block → `buildMmReserveState`;
   - then `computeMmAttribution` (depth at `bandPct`, spread at `spreadNotionalUsd`, on the
     market-maker-only state and on the whole pool) → `evaluateKpis` → the sample;
   - a hooked pool (a Uniswap v4 hook, or an Aero Slipstream pool off its reviewed swap hook) is
     not modelled: each of its mandates is an attribution failure, never a sample.
3. **Storage.** The samples are inserted in the same transaction as the snapshots and the
   `prices` rebuild, so a snapshot and its samples share one block and either both exist or
   neither does. An attribution failure is logged per mandate and does not fail the snapshot.

`depthwatch mm sample` runs the same hook on demand: latest block, `readState`, stored positions,
one sample per active mandate, no snapshot row.

### Alert delivery

`apps/cli/src/pipeline/alerts.ts` runs after the samples are stored, for each mandate with a
webhook URL. It computes the current streak over the mandate's last `alertAfterSamples + 1`
samples; when the streak is breached, at least `alertAfterSamples` long, and the latest recorded
alert is not already a `breach` for a streak with the same `since`, it posts a `breach` event;
when the latest recorded alert is a `breach` and the mandate is now within KPI, it posts
`recovered`. The body is JSON (`event`, `mandateId`, `name`, `poolId`, `timestamp`, `blockNumber`,
`streakSamples`, `breaches`, `attribution`, `scorecardUrl` built from `DEPTHWATCH_PUBLIC_URL` or
`http://<host>:<port>`), sent with the global `fetch` (injectable for tests) and a 5 s timeout.
Every attempt is recorded in `mm_alerts` with
`delivered`, the response status and the error message; delivery never throws into the pipeline
and a failed attempt is not retried. The CLI tests run a webhook receiver on `127.0.0.1` to check
the breach-after-N, recovery and failure-recorded paths.

### Cost of sampling

Sampling reuses the snapshot's state read, so a concentrated mandate adds no RPC calls unless
Slipstream positions are gauge-staked: then one `stakedContains` call per gauge-owned position and
registered address, multicall batched. An Aerodrome v2 or Aero v2 mandate adds `totalSupply`, one
gauge lookup (`Voter.gauges` or `FactoryRegistry.targetToGauge`) and one or two `balanceOf` per
address, in one multicall. The positions themselves come from
the `positions` table, which `run` and `start` refresh for mandated pools (`run --with-positions`
or a separate `depthwatch positions` schedule covers every tracked pool), so that is what keeps
concentrated attribution current.

## RPC cost model

The pipeline is designed around three facts about Base: blocks every 2 seconds (43,200 per day),
`eth_getLogs` ranges capped by most providers, and Multicall3 making hundreds of `eth_call`s
cost one request. Numbers below are estimates for sizing; the recording transport (see
[Transports](#transports)) gives exact counts for a real run.

Two endpoints split the cost: every `eth_getLogs` goes to the logs endpoint
(`DEPTHWATCH_LOGS_RPC_URL`, `createChainReader({ logsRpcUrl })`, default: the main one) and
nothing else does; multicalls and block headers go to the main endpoint (`DEPTHWATCH_RPC_URL`).
Log requests are only ever `discover`, `volume` and `positions`.

### Discovery: chunked `getLogs`

One `eth_getLogs` per factory per chunk of `logChunkSize` blocks with the factory address and the
creation topic; with the default addresses that is eight filters: one per factory (Uniswap v3,
Uniswap v4, Aerodrome v2, the three Aerodrome Slipstream deployments and the Aero Slipstream
CLFactory) and one over Aero v2's volatile and stable factories, whose shared `PoolCreated` has no
`stable` flag, so the factory that emitted a log gives the pool's kind. The `depthwatch` CLI
defaults to 2,000 blocks per chunk (`DEPTHWATCH_LOG_CHUNK` / `--log-chunk`; Base's public RPC
rejects larger spans) and always passes its value to the reader, so 10,000 is only the library
default of `createChainReader`. Incremental runs cover a day (43,200 blocks) in about 22 chunks per
factory at 2,000 blocks, or about 5 at 10,000. The first run starts at each factory's deployment
block (`startBlock` in `addresses.ts`, or `--from-block`) and spans tens of millions of blocks: on
the order of tens of thousands of requests per factory at the CLI default, a few thousand at 10,000,
so raise `--log-chunk` for the backfill if the provider allows it. A scan of more than 100,000
chunks per factory logs a warning before it starts. The cursor advances every 50 chunks (100,000
blocks at the CLI default), so a failure costs at most one window on the next run. Token metadata is
resolved once per token through multicall and cached in `tokens`.

### Seeded discovery: factory views and archive state

`discover --seed` (`ChainReader.seedPools`, `packages/chain/src/seed/`) sends no `eth_getLogs`.
It asks each DEX for the pools of every pair of the reference tokens in `addresses.ts`, plus any
tokens given with `--seed-token` / `DEPTHWATCH_SEED_TOKENS`, at one block (the head), through
Multicall3 (at most 500 calls per request):
- Uniswap v3: `feeAmountTickSpacing` for the candidate tiers (seven are enabled on Base: 100,
  200, 300, 400, 500, 3000, 10000), then `getPool(token0, token1, fee)` per pair and tier.
- Aerodrome v2: `PoolFactory.getPool(token0, token1, stable)`, stable and volatile.
- Aero v2: `getPool(token0, token1)` (two arguments: its factories have no `stable` flag) on the
  volatile and on the stable PoolFactory; the factory that answers gives the kind.
- Slipstream, Aerodrome's three deployments and Aero's: `tickSpacings()` of each CLFactory, then
  `getPool(token0, token1, tickSpacing)`. For an Aero Slipstream pool the builder also reads its
  swap hook (`getPoolSwapHook`) and the hook's `dynamicFeeConfig`, for every pool it finds, new or
  stored. Stored Aero Slipstream pools outside the seeded pairs (found by log discovery, or
  tracked with `--pool` or a mandate) are read again too (`ChainReader.refreshPoolMetas`: the
  factory's `getPool` for the stored key, then the same build), so a rerun picks up a changed hook
  on every stored pool.
- Uniswap v4: StateView `getSlot0` of the PoolKey id for (currency0, currency1, fee,
  tickSpacing, no hooks) over (100, 1), (500, 10), (3000, 60) and (10000, 200), native ETH as
  `address(0)`; a pool counts once its sqrtPriceX96 is not zero.

With the 15 reference tokens (14 ERC-20s and native ETH) that is 91 ERC-20 pairs and 105
currency pairs: 637 v3, 182 Aerodrome v2, 182 Aero v2, 420 v4 and one Slipstream call per pair
and enabled spacing of each factory (2,002 with the 22 spacings the three Aerodrome factories
enable today, 637 with the 7 of the Aero factory), about ten multicalls in all, plus token
metadata and fees for the pools found. Every non-zero answer goes through the same PoolMeta
builder as the creation log would. The six DEXes are asked independently: one whose factory reads fail is reported (`SeedResult.failed`) and gets no
`seed:<dex>:lastBlock`, while the others' pools are dated and stored; the command then exits 1
and the next seed asks that DEX again.

The creation block of each new pool is found exactly by binary search between its factory's
`startBlock` and the head: a contract pool exists at block N when `eth_getCode` at N is not empty;
a v4 pool once its slot0 word in the PoolManager (`extsload`, the word StateView decodes) holds a
non-zero sqrtPriceX96. The PoolManager is read rather than StateView because StateView was
deployed later (it has no code at the v4 `startBlock`). A search takes at most
⌈log2(head − start + 1)⌉ probes, 26 for a Uniswap v3 pool at a head near 53 M; the searches run in lockstep rounds with
`DEFAULT_SEED_CONCURRENCY` (4) requests in flight, each contract pool costs one `eth_getCode` per
round, and v4 probes that fall on the same block share one multicall. Pools already in the
database keep their creation block and are not searched, so a rerun, or each `run --seed` pass,
costs only the factory reads. The search runs in batches of `DEFAULT_SEED_BATCH` (50) pools, each
upserted as it completes, so an interrupted seed resumes with the pools it had not dated yet;
rate-limited and transient requests back off like `eth_getLogs` (1 s doubling to 30 s, eight
retries, `Retry-After` wins), each logged as a warning.

Measured on Base on 2026-10-25 against Alchemy's free tier (head 53,061,869; the whole run's
counts are in the README, [Measured on Base](../README.md#measured-on-base-2026-10-25)): the 2,782
candidates gave 580 pools (Uniswap v3 227, Uniswap v4 165, Aerodrome v2 87, Slipstream 101).
Dating them took 13,399 search requests, 15,388 HTTP requests in all (11,858 `eth_getCode` and
3,529 `eth_call`, retries included), in 616 s at the default concurrency; the endpoint answered
1,968 requests with HTTP 429, which the retries absorbed. At 26 compute units per answered
`eth_call` or `eth_getCode` that is about 349,000 units, once. A rerun with every pool stored
took 2 seconds. Spot checks of an earlier seed (head 53,056,975) against the creation logs of
five pools (one per contract DEX, two v4), read in 10-block `eth_getLogs` windows, matched the
searched blocks exactly ([base-contracts.md](research/base-contracts.md) §2.7).

### Overview: multicall batching

Three to four `eth_call`s per pool (`slot0`, `liquidity`, two `balanceOf`; or `getReserves` plus
`stable`), packed 500 per Multicall3 request. 10,000 pools are roughly 70 multicalls. This is the
only step that touches every pool, so its cost grows with the number of pools on Base, not with
how many are tracked. One batched read keeps at most four of its multicalls in flight
(`maxConcurrentMulticalls`); its further groups wait, so a large read (a first positions scan
reads every token a position manager touched) queues instead of bursting at a rate-limited
endpoint.

### State: tick-bitmap walks

For a concentrated pool, a `tickBitmap` word covers 256 × `tickSpacing` ticks. A ±10 % band is
about ±953 ticks (ln 1.1 / ln 1.0001), so a pool with tick spacing 10 needs one to three words and
a tick spacing 1 pool about eight. The words are read in one multicall; the set bits name the
initialised ticks; `ticks()` for each of them goes in a second multicall (several hundred ticks
fit in one request). Expect two to three round trips per pool and, for the default 200 tracked
pools, around 500 multicalls per snapshot. Reserve pools need nothing beyond the overview and
their fee.

Aero pools carry checks in the multicall that reads their state, so they cost no extra request.
An Aero v2 read sends `getBaseFee(pool, 0x0, 0, 0, 0, 0)` and `feeModule()` on the pool's own
factory with `getReserves`; an Aero Slipstream read sends the CLFactory's `isPool` and
`getPoolSwapHook` and the swap hook's `dynamicFeeConfig` with `slot0`, `liquidity`, `fee` and
`tickSpacing`. A fee module other than the pinned one, another swap hook, or a hook that charges
each block's first swap an initial fee throws `PoolConfigChangedError` (`fee module changed`,
`swap hook changed`, `initial fee enabled`): the snapshot fails that pool instead of publishing
depth modelled on a setup nobody reviewed, and logs the remedy (`poolConfigFix`,
[DEPLOY.md](DEPLOY.md#upgrading)). For a hook, `discover --seed` reads the hook of every stored
Aero Slipstream pool again and stores a pool off the reviewed setup as hooked (price only). A fee
module is pinned in code (`aeroV2.volatileFeeModule` / `stableFeeModule`), so seeding and log
discovery of Aero v2 fail the same way until a new build pins the reviewed module. Every
Slipstream pool's `fee()`, Aerodrome's and Aero's, is a reading at the snapshot block, which the
snapshot stores with it (`PoolSnapshot.feePips`) and writes to the pool row's fee column alone
(`pools.setFees`), so a seed that rewrote the row meanwhile keeps its write; once a pool has a
snapshot, discovery and seeding leave its fee alone. A tracked pool without a usable mid price (a
zero reserve) has no price to store: the snapshot logs it as empty and skips it.

### Volume: chunked `getLogs` on many addresses

`Swap` events for the tracked pools of one event source are requested together (one address
array, one topic) per block chunk, so a chunk costs one `getLogs` per source with tracked pools.
Slipstream's CLPool emits Uniswap v3's `Swap` event unchanged (same signature, same topic0, pinned
by a test), so Uniswap v3 and Slipstream pools share one filter, and Aero v2 pools emit Aerodrome
v2's `Swap`: three sources for six DEXes.
Uniswap v4 swaps are read from the PoolManager filtered by the `id` topic.
The step logs its progress at info level every 30 s (blocks scanned of the total, chunks served of
the total, percent, elapsed time, ETA, rate-limit and transient backoffs), since a 24 h scan at 10
blocks per request takes about half an hour. Percent and ETA count blocks, and the chunk total is
an estimate (the blocks left divided by the mean span of the chunks served so far), because the
reader shrinks its chunks below `--log-chunk` once a provider states a smaller range cap. The window is `--hours` × 1,800
blocks plus a 2,100-block margin, so a 24 h window is about 45,300 blocks: about 23 chunks at the
CLI default of 2,000 blocks, or about 5 at 10,000. Swap timestamps are interpolated between anchor
headers on the main endpoint, independent of the log chunk: the multiples of 10,000 blocks around
the swaps plus the scan's last block (`DEFAULT_TIMESTAMP_SPAN`), so a 24 h window needs at most
seven `eth_getBlockByNumber` whatever `--log-chunk` is, and later `run` passes reuse the cached
multiples. Base's 2 s cadence makes the interpolation exact; a segment whose endpoints show a
fractional cadence is bisected instead. Buckets are upserted, so rescanning is idempotent.

The step is incremental. Each pool's coverage (`volume:<pool>:lastBlock`, the last block in its
buckets, and `volume:<pool>:fromTs`, the first hour from which they are complete) lets a later
pass start at the first block of the hour that held `lastBlock`, computed exactly from Base's 2 s
blocks, less a 300-block margin (`VOLUME_JITTER_BLOCKS`): that hour, which the previous pass cut
short, is rewritten complete, the hours before it are kept as stored, and swaps in the margin are
dropped. A pool whose coverage does not reach back to the window's first hour (newly tracked,
untracked for a day, or a wider `--hours`) reads the whole window. Each event source is read once,
from the earliest start of its pools, since a log request costs the same for one pool or many. The buckets
a pass keeps are revalued from their stored token totals at the current prices, so the window is
valued as a full rescan would value it.

### Positions

Position events on the NonfungiblePositionManager (`IncreaseLiquidity`, `DecreaseLiquidity`,
`Transfer`) do not carry the pool address, so position indexing reads the events over a block
range, then `positions(tokenId)` through multicall to learn each position's pool, owner, range and
liquidity. This is the most expensive reader per block, so a default `run` pass reads it only for
the concentrated pools of active mandates: opt in for every tracked pool with
`run --with-positions`, or run `depthwatch positions` on its own schedule.
Uniswap v4 uses the PositionManager; Aero Slipstream's NonfungiblePositionManager emits a six-field
`IncreaseLiquidity` (with the position's range), read with its own ABI, since the four-field one
of the other managers would miss its increases. Aerodrome v2 and Aero v2 pools have no positions
(LP tokens are fungible) and return `[]`.

A pool's first scan starts at its creation block, so on a fresh database every tracked pool would
read its manager's whole history on its own range. `depthwatch start` runs positions in windows
instead (`POSITIONS_WINDOW_BLOCKS`, 500,000 blocks, 250 `eth_getLogs` at 2,000): pools less than a
window behind the head read from their cursors to the head as above, and pools further behind are
read in shared windows from the oldest cursor, so all the pools of a position manager share one
log scan and one set of `positions()` reads per window (the reader caches the latest range per
manager). A first scan that ends a window short of the head is kept under `<pool id>#catch-up` in
`positions`, with the cursor `positions:<pool>:catchUpBlock`, and becomes the pool's position set
only when a window reaches the head: the snapshot never computes owner concentration from part of
a history. A time budget stops a run between pools and windows; the next run resumes. A
concentrated pool with an active mandate whose positions are not published yet is read from its
cursor (its creation block) to the head on its own range whatever its distance, as the plain
command does, so one run publishes it: until then the snapshot samples none of its mandates (an
attribution failure, never a `none` sample and its false `noLiquidity` breach), and `start` runs
positions in the pass that finds it.

### Per cycle

A 5-minute `run` with 10,000 known pools and 200 tracked pools is roughly: 8 `getLogs` for
discovery (one per filter: one per factory, and one for the two Aero v2 factories; 150 new blocks
fit in one chunk at any chunk size), ~70 multicalls for
the overview, ~500 multicalls for state, 1 to 2 `getLogs` per event source with tracked pools for volume (a
pass rereads the hour that held the previous head, the new blocks and the margin: at most about
2,250 blocks) plus a handful of block headers. The first pass, and a DEX with a newly tracked pool,
read the whole window: ~23 `getLogs` per source at 2,000 blocks. Comfortably inside a free-tier
budget per cycle; the state step is the lever (`--top`), and `--log-chunk` is the volume lever on
a provider that accepts wider spans.

### Rate limits, range limits and free plans

- **Rate limits.** A request answered with HTTP 429, a rate-limit code (429, -32007) or
  message (Base's public endpoint: -32011 "request limit reached"), or a transient failure (a
  timeout, no answer, or a gateway's 408 / 5xx such as a 504 "upstream request timeout" or
  Cloudflare's 520-524) is sent again after 1, 2, 4, 8, 16, 30, 30 and 30 s (`Retry-After`
  wins when sent), each backoff logged as a warning naming the request (method and block, never
  its body); after eight retries it fails with `RetryExhaustedError`, an ordinary failure. One
  backoff (`internal/backoff.ts`) serves every request: `eth_getLogs` (retried on the same range,
  which is not split), the main endpoint's multicalls and block headers (so a free-tier 429 during
  `readState` costs a wait, not the pool), and the seed's archive probes. A `run` pass logs a
  failed step and goes on (`run --once` then exits 1, naming the step; the loop stops with exit 1
  after three passes in a row in which every step that reads the chain failed, so a supervisor
  notices a revoked key). A gateway's answer is never read as a rejected
  range, whatever its text says ("timed out"): viem raises `HttpRequestError` only for a body that
  is not a JSON-RPC error, so it comes from a proxy, not from the node. Both HTTP transports the
  reader builds from URLs have viem's own retries off, so a rate-limited endpoint is not hit again
  at once.
- **Range limits.** A rejected range is split, never below min(100 blocks, `--log-chunk`). The
  provider's text is read from the JSON-RPC error's message and, for a -32602, from its `data`,
  where Tenderly's public gateway and Pocket put the reason behind a bare "invalid params"; another
  code's `data` (a -32603's "context deadline exceeded") never turns a retry into a split. A
  provider that states its maximum (Alchemy's free tier, HTTP 400 / -32600: "you can make
  eth_getLogs requests with up to a 10 block range"; Tenderly's public gateway, in `data`: "maximum
  1000 blocks") is split to that size when it is at or above the floor, and otherwise stops the
  command at once with one error naming the limit and the two fixes: a logs endpoint that accepts
  larger ranges, or `DEPTHWATCH_LOG_CHUNK` set to the limit for small scans. Without a stated
  maximum the range is halved: "more than 20000 results", Pocket's "scan work too large", and
  viem's `ResponseBodyTooLargeError` (an answer over the transport's `maxResponseBodySize`, 10 MiB
  by default), read by its name. A chunk the endpoint accepts is never split, so `--log-chunk 10`
  on a 10-block plan works. `run` stops on that error too, since no later pass could succeed. Scans
  already started each send their first request: one per event source for `volume`, one per
  factory for `discover`, and `positions` starts no further pool once one has failed this way.
- **A 10-block plan.** `snapshot` and `score` need no logs. `volume` for 24 h is 45,300 blocks:
  4,531 `eth_getLogs` per event source with tracked pools plus at most seven headers, about 13,600
  requests with all six DEXes (three sources) tracked (on a plan that meters about 75 compute
  units per `eth_getLogs`, about 1 M units) on a first pass. The pass measured on 2026-10-25
  ([README](../README.md#measured-on-base-2026-10-25)) predates the shared filter: four scans,
  18,131 answered requests and about 1.36 M units, 4,192 more answered HTTP 429. Later passes
  start at the hour of the previous head (about 100 requests per source for a pass 5 minutes
  after the last, about 300 an hour after, about 1,200 six hours after), but keeping volume
  current still reads each block at least once per source: at least about 4,320 requests per
  source a day, about 1 M units a day with three, more than a 30 M-unit month, and a 5-minute
  loop pays the reread hour on every pass, about ten times that.
  So a looping `run` does not fit a free plan of that size: run single passes
  (`run --seed --once`) when fresh numbers are needed.
  A first `discover` from the factories' deployment blocks (around 50 M blocks, about 5 M requests
  per factory at 10 blocks) and `positions` are not practical there: run them against a logs
  endpoint that takes 2,000-block spans. `discover --seed` needs no logs and finds the
  reference-token pools on such a plan (see
  [Seeded discovery](#seeded-discovery-factory-views-and-archive-state)).

## Running as a service

`depthwatch start` is the one command a server runs ([DEPLOY.md](DEPLOY.md) has the setup, with
the Docker image the root `Dockerfile` builds). One Node process serves the API and the dashboard
exactly as `serve` does, listening before the pipeline sends its first request, even on an empty
database, and runs the pipeline against the same database on a schedule (`apps/cli/src/start/`).
`node:sqlite` is synchronous and every write is one short transaction, so the API answers between
them while a step waits on the network.

### The pass

Every `DEPTHWATCH_SNAPSHOT_INTERVAL` (default 30 min) the scheduler runs one pass. Its steps run
one after the other, so no two steps ever overlap:

```
[seed] → snapshot → [volume] → score → [positions] → [discover] → [prune]
```

- **seed** (`discover --seed`) opens every pass until one has succeeded. On an empty database the
  first pass seeds (about 640 pools in some 10 minutes on Alchemy's free tier, see
  [Seeded discovery](#seeded-discovery-factory-views-and-archive-state)), snapshots and scores, so
  the site has data within minutes.
- **snapshot** and **score** run every pass.
- **volume** runs once `DEPTHWATCH_VOLUME_INTERVAL` (default 1 h) has passed since its last run,
  between snapshot (whose prices it uses) and score (whose 24 h window ends at the volume head).
- **positions** runs once `DEPTHWATCH_POSITIONS_INTERVAL` (default 6 h; `off` disables it) has
  passed, for at most `DEPTHWATCH_POSITIONS_BUDGET` (default 10 min), in windows (see
  [Positions](#positions)), and whatever the cadence in a pass that finds an active mandate on a
  concentrated pool whose positions are not published yet: the snapshot does not sample such a
  mandate (an attribution failure, no sample), and that pool is read to the head on its own
  range so it publishes in one run. While pools are still catching up it runs again the next
  pass.
- **discover**, the log scan from the factories' deployment blocks, runs every pass for at most
  `DEPTHWATCH_DISCOVER_BUDGET` (default 15 min; `off` leaves discovery to the seed). It resumes at
  its cursors, so a first full discovery spreads over passes; once it reaches the head a pass costs
  one request per factory.
- **prune** closes the pass once a day (`prune:lastRunAt` a day old or unset): the retention of
  the [storage model](#storage-model), database only, no budget (a day's snapshots delete in
  seconds).

A cadence is rounded up to a pass (volume every other pass at the defaults). Budgets are also cut
to the time left before the next pass, and a step with under 30 s left waits for the next pass. A
budget stops a step from starting more work (a discovery window, a positions pool or window); the
unit in flight finishes, so a pass can overrun by one unit, and the next pass then starts at once
(missed passes are not queued). The last run of volume and positions is kept in `sync_state`
(`start:<step>:lastRunAt`, unix ms), so a restart keeps their cadence; a run that found no
tracked pool (the first snapshot failed, so nothing was tracked yet) records no run and the step
is due again at the next pass.

### Failures and stopping

A step that throws is logged as an error with the CLI's one-line description (a logs endpoint that
cannot serve the chunk names its two fixes) and the pass goes on; the step is tried again at its
next slot: the seed and the per-pass steps at the next pass, volume and positions one interval
after the failed attempt. Unlike `run`, no error stops `start`: the site keeps serving the last
good data.

SIGTERM or SIGINT aborts the chain reader (`createChainReader({ signal })`): the HTTP request in
flight is cancelled, a backoff wait ends, nothing more is sent, so the current step ends within
moments, and no further step starts. The same signal reaches the pipeline (`PipelineContext.signal`):
the concurrent pool reads start no further pool, and a step checks it before its storing
transaction, so a stop in the middle of a snapshot stores no snapshot, prices or cursor (no
partial snapshot enters the history), a stopped volume run stores no buckets, and a stopped
discovery keeps only the windows it completed; the step's line reads `stopped for shutdown`
whether it threw or returned. `start` waits for it at most `DEPTHWATCH_SHUTDOWN_GRACE` (default
8 s, under Docker's 10 s stop timeout), abandons it after that, closes the server and the
database, and exits 0. A second signal exits at once (130).

Before it listens, `start` writes and deletes a probe row: a database the process cannot write
(a file restored as root and run as the `node` user, a mount that refused the entrypoint's
chown) ends the start with `database is not writable: <path>` and exit code 1, where a host's
restart policy shows it, instead of a healthy-looking site whose every pass fails.

### Request accounting

The chain reader reports every request it sends (`createChainReader({ onRequest })`, retries
included) with its endpoint: `logs` for `eth_getLogs`, `main` for everything else. Each step's
`done` line carries `requests`, `main` and `logs`, and, when an endpoint is Alchemy, `alchemyCu`:
compute units estimated at the rates measured for this project, 75 per `eth_getLogs`, 26 per
`eth_call` (a multicall is one) and 16 per block header, with other methods (the seed's
`eth_getCode`) at the `eth_call` rate. Requests to other endpoints are counted, not priced. The
first step of each UTC day logs `daily total` for the day before, with `alchemyCuMonthPace` (the
units of a 30-day month at that day's rate) and `alchemyFreeTierPct` (of 30 M); stopping logs
`usage today`. The host's log viewer is enough to follow the budget.

### Budget at the defaults

For Alchemy's free tier (about 30 M compute units a month) on `DEPTHWATCH_RPC_URL`, Base's public
RPC on `DEPTHWATCH_LOGS_RPC_URL` from a server with its own IP, about 640 known pools and the
default 200 tracked:
- **Snapshots** dominate. A measured pass over 492 tracked pools took about 1,150 `eth_call`s,
  about 29,000 units; the overview of every known pool is a handful of multicalls and the state
  reads grow with the tracked pools. A `start` pass on 2026-10-25 with 200 of 580 pools tracked
  sent 528 requests, 13,718 units by the meter, HTTP 429 retries included. 48 passes a day make
  about 20 M units a month. Hourly passes (`DEPTHWATCH_SNAPSHOT_INTERVAL=1h`) halve that; 492
  tracked pools every 30 minutes would need about 42 M, more than the free tier, and about 21 M
  hourly.
- **Volume** sends its `eth_getLogs` to the logs endpoint; on Alchemy it costs only the block
  headers that time the swaps, a few per pass. Volume on Alchemy alone, at its 10-block ranges,
  would cost about 40 M units a month: the reason for the second endpoint.
- **Discovery** and **positions** read logs on the logs endpoint too. Discovery adds one header per
  pass and the metadata of new tokens. Positions add the `positions()` and `ownerOf()` multicalls
  of the tokens touched since the last run: one pass over each manager's history while catching
  up, then the tokens of six hours. Neither has been measured on mainnet: the `daily total` line
  shows them.
- **The seed** costs about 380,000 units with all six DEXes, once.

The logs endpoint sees about 20 `eth_getLogs` an hour once discovery is current (eight discovery
filters a pass, a few per event source for hourly volume), against the measured limit of about 5
requests a second per IP of Base's public RPC. A first full discovery is on the order of 100,000
requests, 5 to 6 hours of requests at that rate; at 15 minutes a pass it completes in about half a
day.

## Storage model

`node:sqlite` (`DatabaseSync`), one file (`DEPTHWATCH_DB`) or `:memory:`. `openDatabase` applies
migrations from `packages/db/src/schema.ts`; `MIGRATIONS[i]` brings the schema to version `i + 1`,
each entry is a batch of SQL run in one transaction and recorded in `schema_version`. Shipped
migrations are never edited, only appended; `packages/db/src/schema.test.ts` pins a sha256 of each.

| Table           | Key                     | Holds                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tokens`        | `address`               | symbol, name, decimals                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pools`         | `id`                    | `PoolMeta` columns, `tracked` flag, `first_seen_at`                                                                                                                                                                                                                                                                                                                                                                      |
| `snapshots`     | autoincrement `id`      | per pool and block: price, USD prices, TVL, active liquidity, `depth_json`, `depth_usd_json`, `spreads_json`, `concentration_json`, denormalised `depth2_usd`, `spread10k_bps`, `owner_top1_share`; `price_deviation_bps` (schema version 5) and `fee_pips` (the LP fee the snapshot used, schema version 7, NULL in older rows); indexes on `(pool_id, timestamp)` and `timestamp`, unique on `(pool_id, block_number)` |
| `volume_hourly` | `(pool_id, hour_start)` | token volumes (TEXT bigints), USD volume, swap count                                                                                                                                                                                                                                                                                                                                                                     |
| `positions`     | `(pool_id, token_id)`   | owner, tick range, liquidity, last updated block; rows under `<pool id>#catch-up` hold a first windowed scan until it reaches the head                                                                                                                                                                                                                                                                                   |
| `prices`        | `token`                 | USD price, `via_json` route, `updated_at`                                                                                                                                                                                                                                                                                                                                                                                |
| `scores`        | `pool_id`               | `health_json`, `gap_json`, `persistence_24h_json`, `persistence_7d_json`, `volume_24h_usd`, `depth2_usd`, denormalised `health_total`, `gap_score`                                                                                                                                                                                                                                                                       |
| `sync_state`    | `key`                   | pipeline cursors, e.g. `discover:uniswap-v3:lastBlock`, `positions:<pool>:lastBlock` (`:catchUpBlock` while a first windowed scan is staged), `start:volume:lastRunAt`, `prune:lastRunAt`                                                                                                                                                                                                                                |
| `mandates`      | `id`                    | name, `pool_id`, `market_maker`, `addresses_json`, `kpis_json`, `alert_webhook_url`, `alert_after_samples`, `active`, `created_at`, `notes`; index on `(pool_id)`                                                                                                                                                                                                                                                        |
| `mm_samples`    | autoincrement `id`      | per mandate and block: `pool_id`, `block_number` (TEXT), `timestamp`, `attribution_json` (`MmAttribution`), `within_kpi` (NULL = not evaluable), `breaches_json`; indexes on `(mandate_id, timestamp)` and `timestamp`, unique on `(mandate_id, block_number)`                                                                                                                                                           |
| `mm_alerts`     | autoincrement `id`      | per delivery attempt: `mandate_id`, `timestamp`, `kind` (`breach` / `recovered`), `streak_samples`, `payload_json`, `delivered`, `response_status`, `error`; indexes on `(mandate_id, timestamp)` and `timestamp`                                                                                                                                                                                                        |

Conventions:
- Bigints are stored as TEXT decimal strings; SQLite REAL would lose precision above 2^53.
- JSON columns hold the core types with bigints as strings. Serialisation is `toJsonSafe` /
  `jsonStringify`; revival is `reviveBigints(value, BIGINT_KEYS)`, which converts by property
  name (`amountIn`, `liquidity`, `sqrtPriceX96`, …), never by pattern, so a token symbol that
  happens to be digits is left alone.
- Addresses are lowercase on the way in (`normalizeAddress`) and compared as such.
- Timestamps are unix seconds. `hour_start` is aligned to the hour.
- Denormalised columns exist only for sorting and filtering in SQL (`scores.topBy`, `gaps`,
  `statsByDex`); the JSON columns remain the source of truth.
- Repositories expose typed methods (`pools.upsertMany`, `snapshots.insert`,
  `snapshots.latestForPool`, `snapshots.seriesForPool(poolId, fromTs)`, `volume.upsertBuckets`,
  `volume.sumUsd(poolId, fromTs)`, `scores.upsert`, `scores.topBy(sort, options)`,
  `scores.gaps`, `scores.statsByDex`, …) and never leak rows.

Several processes on one file: a deployment runs one writer (`start`, or `run` beside `serve`),
and `serve`, the `mm` commands or a one-shot step may open the same file meanwhile. `openDatabase`
sets `busy_timeout` (5 s) before anything else and retries the switch to WAL for as long, since
SQLite's busy handler does not cover it, so an open waits on another process's lock instead of
failing. A database at the current version is opened without a write lock; otherwise the
migrations take `BEGIN IMMEDIATE` before reading `schema_version`, so the first process applies
them and the others read the version it recorded. A snapshot of a pool, or a sample of a mandate,
at a block already stored is skipped (`INSERT OR IGNORE` on the unique indexes, schema version 3),
so a second writer at the same block adds nothing; at a later block it adds a row like any pass,
one more sample in streaks, uptime and persistence.

Retention: nothing reads past the 7 d persistence and history windows of the snapshots and the
30 d uptime window of the scorecard samples, but the tables grow for as long as the pipeline runs:
a snapshot row is about 1.4 KB (`depth_json`, `depth_usd_json` and `spreads_json` make most of
it), so 200 tracked pools every 5 minutes (`run` at its default interval) add about 80 MB a day,
about 2.5 GB a month, and every 30 minutes (`start`) a sixth of that. `depthwatch prune` deletes
snapshots and hourly volume older than `DEPTHWATCH_KEEP_DAYS` (default 30; snapshots keep at least
8 days), scorecard samples older than 35 days, alerts older than 90 (each mandate's newest
delivered alert is kept), and the volume cursors of
pools no longer tracked; a tracked pool's `volume:<pool>:fromTs` moves up to the cutoff so a later
`volume --hours` never trusts a pruned hour as covered. Snapshots are deleted in batches of 10,000
rows, each its own short transaction, so the API keeps answering between them under `start`;
`mm_samples` and `mm_alerts` carry `timestamp` indexes (schema version 4) so their deletes seek
instead of scanning. The run ends with `PRAGMA wal_checkpoint(TRUNCATE)`, which folds the deletes
into the main file and empties the WAL; the main file keeps its size (SQLite reuses the freed
pages, so it stops growing) unless an operator runs `VACUUM`. `run` and `start` prune once a day
(`prune:lastRunAt`), at the end of the pass.

## Transports

Chain access goes through viem `Transport`s, so the same `ChainReader` runs against a live RPC, a
recorded fixture or an in-memory stub.
- **Live:** `createChainReader({ rpcUrl, logsRpcUrl })` (HTTP transports; `eth_getLogs` on the
  second, default: the first). `onRequest` hears every request with its endpoint and `signal`
  stops the reader (`observeTransport`), which `depthwatch start` uses to count and to stop.
- **Fixture:** `createFixtureTransport(fixture)` answers each JSON-RPC request from a map keyed by
  method and params. Unknown requests throw, so a test that needs a call it did not record fails
  loudly instead of silently returning garbage. Every chain test and `depthwatch demo` use this.
  Its `history` entries answer a request at any block from the entry in force there (code that
  appears at a deployment block, a view whose answer changes), which is what the creation-block
  search of seeded discovery reads; `registerSeedWorld` builds such a world for the seeders.
- **Recording:** `createRecordingTransport(inner, sink)` wraps a live transport and writes each
  request/response pair into a fixture. This is how demo fixtures are produced from mainnet: run
  the pipeline once with recording enabled, commit the sink. Fixtures are plain JSON, deterministic
  and reviewable in a diff.

Because multicall is itself an `eth_call`, a fixture records the batched request, not the
individual calls; batch composition must therefore be deterministic (sorted inputs, fixed chunk
sizes), which the readers guarantee.

## API and dashboard

`createApp(db, { staticDir, adminToken })` returns a Hono app, so API tests run through
`app.request()` against an in-memory database with no server. Every route is listed in the README;
DESIGN.md lists the layer-1 ones and [design/scorecards.md](design/scorecards.md) §6 the scorecard
ones. The scorecard routes (`/api/mm…`) compute each `ScorecardSummary` from the mandate's
samples of the last 30 days through core's `summarizeScorecard`, keeping the last summary per
mandate until a new sample, a changed mandate or a new minute; the badge is an SVG with a
5-minute cache header. Responses are compressed when the client accepts it, carry an `ETag`, and
`GET /api/*` reads other than `/api/health` a 30-second `Cache-Control` (a pool's history: 60 s;
`apps/api/src/caching.ts`); `/api/health?maxAge=<seconds>` answers 503 when the newest snapshot
is older, so a probe can fail on stale data. `POST /api/mm` and `DELETE /api/mm/:id` require
`Authorization: Bearer <adminToken>` (`DEPTHWATCH_ADMIN_TOKEN`, which `serve` and `demo` pass
through; environment only, no flag, at least 32 characters); without a configured token they
answer 403, so a public deployment that does not set the token is read-only. `POST` reads at most
64 KiB of body (413 beyond). `createApp`'s `onRequest` hook is the access log: the CLI logs one
`request` line per request (method, path without the query string, status, milliseconds) and an
`admin request refused` warning with the reason and the peer address for every 401. `DELETE` removes the mandate's samples and
alerts in the same transaction. The root also serves the documents for AI agents
(`/AGENTS.md`, `/llms.txt`, `/openapi.json`, written once in `apps/api/src/agentDocs/`), registered
ahead of the dashboard's SPA fallback; the web build copies the files into `dist` unchanged and
into `dist-static` with a generated static-site note (`apps/web/plugins/agentDocs.ts`). The
dashboard is a Vite + React 19 app with TanStack Query; the dev server proxies `/api` to port
8787, the production build is served by the API. Light and dark themes follow
`prefers-color-scheme` with tokens on `:root`.

## Adding a DEX adapter

1. **Decide the pool kind.** If the new DEX is a Uniswap v3 style concentrated pool, a constant
   product pool or an Aerodrome style stable pool, it maps to an existing `PoolState` and no core
   change is needed. A new invariant means a new `PoolState` variant plus a swap simulator, a
   `midPrice` case and tests in core; that is a change to `types.ts` and must be reflected in
   `DESIGN.md` first.
2. **Add the `Dex` literal** to `DEXES` in `packages/core/src/types.ts` (appended, so the stats
   order and the swap-scan sources of the others stay) and to `DESIGN.md`. A new id rather than a
   new factory under an existing one gets cursors of its own, so its history is scanned. The
   type checker then lists every exhaustive site (`ADAPTERS`, `SEEDERS`, the web's `DEX_LABEL`
   and `DEX_SHORT`, the mock's counts), and the doc tests fail until the openapi `Dex` enum and
   pool-id pattern and the agent AGENTS.md name it.
3. **Addresses and ABIs** in `packages/chain/src/addresses.ts` and the ABI module. Only the
   functions and events the readers use; keep them minimal and typed.
4. **Discovery and seeding:** decode the factory's creation event into a `PoolMeta` whose `id` is
   `<dex>:<lowercase address>` (or `uniswap-v4:<poolId>`), with lowercase token addresses, the fee
   in pips, tick spacing or null, and the `stable` flag; a seeder asks the factory's views for the
   pools of the reference pairs and builds the same `PoolMeta`.
5. **Overview:** the cheap per-pool reads (price, liquidity or reserves, balances) as multicall
   entries that produce a `PoolOverview`.
6. **State:** produce a complete `PoolState`. For concentrated pools reuse the tick-bitmap walk
   with the DEX's `ticks()` struct layout (Slipstream differs from v3); for reserve pools map
   `getReserves` and the fee source.
7. **Swaps:** decode the `Swap` event into `SwapEvent` with amounts signed as emitted (positive =
   into the pool).
8. **Positions:** map the DEX's position manager to `Position[]`, or return `[]` with a comment
   when ownership is not observable cheaply.
9. **Fixtures and tests:** hand-build responses with viem's `encodeFunctionResult` /
   `encodeEventTopics`, record a small real fixture if needed, and add the DEX to the `demo` seed.
10. **Docs:** README table, this page, and METRICS.md if any convention differs (for example a fee
    expressed in bps).

## Testing

- **core:** hand-computed cases for every metric; TickMath against the Uniswap constants
  (`getSqrtRatioAtTick(0) = 2^96`, the `MIN_TICK` / `MAX_TICK` ratios); property tests that compare
  `simulateSwapToPrice` with many tiny exact-in swaps (`bruteForceSwapToPrice`) and check
  rounding is in the pool's favour.
- **chain:** fixture transport with hand-built responses; ABI round trips via viem encoders;
  `addresses.trade.test.ts` pins the trade routes, the token allowlist and the trade ABIs' signatures
  and selectors against their sources; `addressesExport.test.ts` walks the module graph of the
  browser-safe `@depthwatch/chain/addresses` entry (no `node:` import, no viem client);
  `createFakeRpcFetch` serves a fixture over viem's real `http()` transport and replays providers'
  HTTP errors (Alchemy's free-tier 400, Base's public 429) for the rate- and range-limit paths;
  seeded discovery against `registerSeedWorld`, its PoolMeta compared with log discovery of the
  same pools and its v4 PoolIds with `keccak256(encodeAbiParameters(PoolKey))`.
- **db / api:** in-memory SQLite; API tests through `app.request()`.
- **cli:** `demo` end to end against fixtures (both demo mandates produce samples, one `ok` and
  one `breached`); webhook delivery against a local HTTP server on `127.0.0.1`.
- **web:** component and client tests under jsdom against the mock client. The swap panel's
  tests run against a fake EIP-1193 wallet behind viem's `custom()` transport
  (`src/testing/fakeWallet.ts`, driven by `src/testing/tradeHarness.tsx`): it answers the pool,
  quoter, balance and allowance reads, mines what is sent (an ERC-4337 bundle for
  `wallet_sendCalls`) and records every request, so the tests assert the `to`, the calldata, the
  Builder Code suffix and the order of the switch's re-read and the signature request.
  `src/tradeBundle.test.ts` builds the site twice in memory and fails when wallet code reaches a
  boot chunk or the boot chunks pass their byte budget.

`pnpm test` runs all of it in a minute or two and needs no network.
