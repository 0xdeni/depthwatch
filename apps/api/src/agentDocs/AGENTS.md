# Depthwatch API: guide for agents

Depthwatch measures executable liquidity on Base mainnet (chain id 8453). For every Uniswap v3,
Uniswap v4, Aerodrome v2, Aerodrome Slipstream, Aero v2 and Aero Slipstream pool it tracks, it
reports how much capital moves the price by 1, 2 and 5 % in each direction, what a $1k / $10k /
$100k / $1M round trip costs with fees included, how concentrated the liquidity is, how stable it
has been over 24 h and 7 d, and a 0–100 Liquidity Health Score. This server answers read-only JSON
over HTTP.

Typical use: an agent about to trade on Base checks how deep the pool is on the side it will
trade and what a round trip costs at its size, then verifies onchain and executes elsewhere.
This API does not execute, route or quote trades, Depthwatch holds no funds, and its USD prices
are a valuation convention, not an oracle.

Every Depthwatch server (`depthwatch serve`, `depthwatch start`, `depthwatch demo`) serves three
documents for agents: `GET /AGENTS.md` (this file), `GET /llms.txt` (a short index) and `GET
/openapi.json` (an OpenAPI 3.1 description of every GET route and its response schema). Metric definitions with
worked examples: <https://github.com/0xdeni/depthwatch/blob/main/docs/METRICS.md>. Source code:
<https://github.com/0xdeni/depthwatch> (MIT).

## Quick start

The examples use `DW` for the server's base URL. A local server listens on port 8787 unless its
operator set `DEPTHWATCH_PORT`.

```sh
DW=http://localhost:8787
curl -s "$DW/api/health"
```

```json
{
  "ok": true,
  "poolCount": 8,
  "trackedCount": 8,
  "latestSnapshotAt": 1792713600,
  "latestScoredAt": 1792713600,
  "snapshotAgeSeconds": 0,
  "latestBlock": "52950000",
  "source": "demo"
}
```

Read `source` before anything else:
- `demo`: the server runs `depthwatch demo`, a synthetic world built offline. Token addresses
  are real Base tokens (WETH, USDC, …) but the pools, their addresses and every number are made
  up, and the API clock is pinned to the synthetic chain's time. Never trade on demo data.
- `live`: the data come from the operator's database, filled from Base mainnet by the
  `depthwatch` pipeline.

The project status is MVP: the math is unit-tested against hand-computed values, but numbers
from a live deployment have not yet been validated against Base mainnet at scale. Which pools a
deployment covers depends on how its operator discovers them: factory log scans find every pool
of the six DEXes, `depthwatch discover --seed` only the pools between the reference tokens (the
major Base tokens plus any the operator adds). A pool missing from `/api/pools` may simply not be
indexed; `GET /api/stats` counts the pools found, tracked and scored.

Aerodrome moved to a new platform, Aero, on 2026-10-21: new factories, a new AERO token and new
gauges. Aerodrome's pools still trade and keep their ids (`aerodrome-v2`, `aerodrome-slipstream`);
Aero's pools have ids of their own (`aero-v2`, `aero-slipstream`), so liquidity that moved shows up
as a different pool, not as a change to the old one.

## Conventions and units

- **Pool id**: `<dex>:<pool address>`, for example
  `uniswap-v3:0x77ebf3fa47dacd6c5ab06f521057260dea765327`. Uniswap v4 pools have no address of
  their own: `uniswap-v4:<poolId>` (0x + 64 hex). `dex` is one of `uniswap-v3`, `uniswap-v4`,
  `aerodrome-v2`, `aerodrome-slipstream`, `aero-v2`, `aero-slipstream`. Ids are lowercase and
  matched exactly, so copy them from a response. The colon may be sent as is or percent-encoded
  (`%3A`).
- **Addresses** are lowercase `0x` + 40 hex. `GET /api/tokens/:address` accepts any case and
  lowercases it. Native ETH in Uniswap v4 pools is `0x0000000000000000000000000000000000000000`
  with symbol `ETH`.
- **Symbols are not unique; the address is the identity.** Aerodrome's AERO
  (`0x940181a94a35a4569e4529a3cdfb74e38fd98631`) and Aero's AERO
  (`0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee`) both answer `AERO`, and copycats reuse any symbol.
  Every token object (`pool.token0`, `pool.token1`, `token`) carries `label` for display: the
  symbol when no other token of a scored pool (nor, on a pool, the pool's other token) shares it,
  else `SYMBOL (name)` (`AERO (Aerodrome)`, `AERO (Aero)`), else `SYMBOL (0x3f5b…a4ee)` when the
  name is shared too. A label can change as pools are scored; match tokens by address, never by
  symbol or label. There is no peg between the two AEROs and no synthetic edge ties their USD
  prices; a pool that pairs them (Aero v2's stable AERO/AERO pool) is an ordinary price route,
  used only when it is the widest one for a token (`via` on the token says which pools priced it).
- **Price orientation**: `price` is always token1 per token0, decimal adjusted. Read
  `pool.token0` and `pool.token1` before interpreting it: in a WETH/USDC pool where WETH is
  token0, `price` is USDC per WETH.
- **Sides**: `up` is buy pressure on token0: the input is token1 and the price rises. `down` is
  sell pressure on token0: the input is token0 and the price falls. Buying token0 is the up side;
  buying token1 (selling token0) is the down side.
- **Depth at ±p %** (p = 1, 2, 5): `latest.depth[].up.amountIn` is the raw token1 amount, fee
  included, that moves the price up by p %; `down.amountIn` is the raw token0 amount that moves
  it down by p %. `amountOut` is what the trader receives on the way. `reached: false` means
  the known tick range ended before the target (or the pool cannot move): the amounts are then
  totals to that point, not depth. A stretch with no liquidity inside the known range costs
  nothing to cross, as it does onchain, so the target is reached and a 5 % amount equal to the 2 %
  amount means no liquidity sits between them. `latest.depthUsd[]` holds `upUsd`, `downUsd` and
  `totalUsd` (both sides summed; only the priced side when one token has no USD price) per level.
- **`depth2Usd`** (pool lists, history, gaps, stats) is the ±2 % total: up side plus down side
  (only the priced side when one token has no USD price).
- **Stale quotes**: `priceDeviationBps` (pool lists, and `latest` on `GET /api/pools/:id`) is
  `|price / (token0Usd / token1Usd) − 1| × 10,000`, how far the pool's own price is from the one
  its tokens' USD prices imply (`null` when a token has no USD price). From 500 bps the pool's
  quote is stale (`staleQuote: true` in pool lists): its depth is measured at a price nobody
  trades, so the stats and a token's `depth2UsdTotal` leave it out of their depth sums and a depth
  sort puts it last.
  For a trade in one direction, use that side, not the total: `depth2UpUsd` / `depth2DownUsd` in
  pool lists (the newest snapshot's ±2 % `upUsd` / `downUsd`, `null` for an unpriced side), or
  `latest.depthUsd[]` on `GET /api/pools/:id` for every level and the `reached` flags.
- **Raw amounts** (`amountIn`, `amountOut`, `activeLiquidity`) and block numbers (`blockNumber`,
  `latestBlock`, `createdAtBlock`) are decimal strings, because they exceed JSON number
  precision. Raw amounts are in the token's smallest unit: `human = raw / 10^decimals`.
- **USD**: token USD prices are derived from the pools themselves by a widest-path search
  anchored at USDC and other stables (USD = 1). `via` lists the pool ids a price came through,
  plus `wrap:weth` for the 1:1 native ETH ↔ WETH step; that entry and any other non-pool source
  is not a pool id and gives 404 on `GET /api/pools/:id`. A token with no route to an anchor has
  no USD price, and every USD field that needs it is `null`.
- **bps**: basis points, 1 bp = 0.01 %. `spreadBps` is the cost of a round trip (buy, then sell
  the same USD notional) relative to the mid price, the swap fee and price impact included (the LP
  fee `feePips`, plus on Uniswap v4 the protocol fee, which `feePips` does not include), so even an
  infinitely deep pool shows about twice its swap fee. `spread10kBps` is the round trip at $10,000.
  A spread is `null` with `feasible: false` when either leg runs out of liquidity, yields
  nothing, a token has no USD price, or either leg's average price is more than 5,000 bps (50 %)
  from the mid price: a trade larger than the pool is not absorbed, however it fills. A feasible
  spread is therefore at most 10,000 bps.
- **Fees**: `feePips` in millionths: 500 = 0.05 %, 3000 = 0.30 %, 10000 = 1 %. It is the LP fee.
  Uniswap v4 depth and spread pay the LP fee combined with the direction's protocol fee from
  slot0 (`protocolFee + lpFee − protocolFee × lpFee / 1e6`, e.g. 625 pips for a 500-pip pool with
  a 125-pip protocol fee), so a v4 pool's spread floor is above twice its `feePips`.
  **Dynamic fees**: a Slipstream pool's fee (`dex` `aerodrome-slipstream` or `aero-slipstream`) can
  change every block: Aerodrome's fee module and Aero's swap hook set it (Aero's up to its cap,
  at most 5 %). Depth and spread use the fee read at the snapshot's block; `pool.feePips` is the
  latest snapshot's reading (for a pool never snapshotted, the reading at discovery),
  `latest.feePips` and each history point's `feePips` the fee that snapshot used (`null` before
  it was stored). A trade a block later can pay another fee, so on
  these pools check the fee onchain before sizing a trade. The dashboard marks them "dynamic".
  Aero v2 pools charge the factory's base fee in bps (× 100 here); MEV taxes and per-caller fee
  discounts are not modelled.
- **Concentration**, inside ±5 % of the mid price: `rangeHhi` (0..1, 1 = all in-band liquidity
  in one tick range), `activeRangeShare` (share in the range holding the current price) and
  `owners` (`count`, `top1Share`, `top3Share`, `hhi`, `coverage`; `null` when positions were not
  indexed for the pool). The shares are out of the indexed owners; `coverage` (0..1) is how much
  of the pool's in-band liquidity those owners account for, and a Slipstream gauge holding
  staked positions is not counted as an owner. A `top1Share` near 1 with a `coverage` near 1
  means one owner controls most of the depth and can withdraw it at once; with a low `coverage`
  it is a share of a small part of the pool only. `coverage` is `null` (unknown) in a snapshot
  stored before it was recorded.
- **Persistence**, over 24 h and 7 d of stored snapshots: `stability` = p10 / median of the
  ±2 % depth samples (0..1); `uptime` = share of samples with depth ≥ half the median (0..1);
  both `null` (unknown) with fewer than 3 samples or when the oldest and newest sample are less
  than a quarter of the window apart (6 h of 24 h, 42 h of 7 d), and both 0 when the median is 0
  (a dead pool).
- **Liquidity Health Score**: 0–100, the sum of depth (max 35), spread (max 25), concentration
  (max 20) and persistence (max 20); `components` holds the four parts and `notes` explains any
  part that was scored 0 or neutral for lack of data. `concentrationBasis` says what the
  concentration part rests on: `owners` (`20 × (1 − top1Share)`, owners covering at least 90 %
  of the in-band liquidity), `ranges` (`20 × (1 − rangeHhi)`, a concentrated pool without such
  owners) or `neutral` (10: an Aerodrome v2 or Aero v2 pool, or no data). Depth counts twice the
  thinner of the two ±2 % sides, so a one-sided pool scores 0 for it. **Rated pools** are those with
  both ±2 % sides known and the thinner at least $5,000 (`rated: true`); only they have a **grade**:
  A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, else F. The others have `grade: null`, keep their `total`, and say
  why in `unratedReason`: `thin` (neither side holds $5,000), `one-sided` (the deeper side does, the
  thinner does not), `unpriced` (a side has no USD price) or `hooked` (a pool with a swap hook
  Depthwatch does not model, `pool.hooks` a non-zero address: a Uniswap v4 pool with a hook, or an
  Aero Slipstream pool off the reviewed swap hook or charging each block's first swap an initial
  fee; its swaps the pool's state does not describe, so no depth, spread or concentration is
  computed, those are empty or `null`, and the pool is not used to price tokens). `null` and the
  zero address `0x0000000000000000000000000000000000000000`, which every Uniswap v4 pool without a
  hook stores, mean no hook: such a pool is modelled and rated like any other.
- **Gap score**: `turnoverRatio = volume24hUsd / depth2Usd`;
  `gapScore = 100 × clamp(log10(turnoverRatio) / 2, 0, 1)`: 0 at a turnover of 1× or less, 50 at
  10×, 100 at 100× or more. A high gap score means a day's volume is large next to the ±2 %
  depth: trades of typical size there move the price. It ranks turnover, not fee income: what
  the volume pays LPs also depends on `feePips`.
- **TVL** (`tvlUsd`): reserves at USD prices, a lower bound when one token is unpriced. Uniswap
  v4 pools have no reserves of their own, so their `tvlUsd` is `null`. TVL is not a liquidity
  measure here; depth is.
- **Times** are unix seconds (UTC). **Freshness**: `updatedAt` (pool lists) and
  `latest.timestamp` / `latest.blockNumber` (pool detail) are the pool's newest snapshot;
  `scoredAt` is when its score was computed; `latestSnapshotAt` / `latestBlock` in
  `GET /api/health` are the newest snapshot of any pool and `snapshotAgeSeconds` its age by the
  server's clock, and `latestScoredAt` is the newest score (a pass writes it after its
  snapshots). Compare them with the current time before relying on a number. A gap in block
  numbers is not a duration: Base made a block every 2 s until block 53,556,127 and makes one
  every 200 ms since (2026-11-05 18:00:01 UTC), so compare timestamps.
- **`null` means not known (yet), never zero.**
- **Which pools appear**: the pipeline tracks the top pools by TVL (200 unless the operator set
  `--top` / `DEPTHWATCH_TOP_POOLS`; Uniswap v4 pools are ranked by ±2 % depth instead), plus
  pools the operator pins with `--pool`, plus every pool with an active market-maker mandate;
  pools with no USD price are not ranked, so they are tracked only when pinned or mandated. Only
  tracked pools are snapshotted and scored, and the listings (`/api/pools`, `/api/gaps`,
  `/api/tokens/:address`) contain scored pools only. Any discovered pool answers on
  `GET /api/pools/:id`, with `null` metrics until it is scored.

## Routes

Every route below is `GET` (`HEAD` works too) and needs no authentication. Query parameters are
optional; an empty value counts as absent, unknown parameters are ignored, and an out-of-range
value is a 400, not clamped. `/openapi.json` has the full response schemas.

### `GET /api/health`

Database counts and the newest snapshot. Fields: `ok`, `poolCount` (discovered pools),
`trackedCount`, `latestSnapshotAt` (unix seconds or `null`), `latestScoredAt` (unix seconds of
the newest score or `null`), `snapshotAgeSeconds` (the server's
clock minus `latestSnapshotAt`; `null` before the first snapshot), `latestBlock` (decimal string
or `null`), `source` (`demo` | `live`). Answers 503 with `ok: false`, zero counts and `error` when
the database cannot be read.

| Parameter | Values                     | Default | Effect                                                                                                                                                                     |
| --------- | -------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxAge`  | positive integer (seconds) | none    | Answers 503 with `ok: false` and `error: "stale: …"` (counts still filled) when `snapshotAgeSeconds` is `null` or above `maxAge`, so a liveness probe fails on stale data. |

`GET /api/health?maxAge=3600` is a probe that fails once the pipeline has not written a snapshot
for an hour (`depthwatch start` snapshots every 30 minutes by default).

### `GET /api/stats`

Totals per DEX and overall. `byDex` has one row per DEX in the fixed order `uniswap-v3`,
`uniswap-v4`, `aerodrome-v2`, `aerodrome-slipstream`, `aero-v2`, `aero-slipstream` (zeros for a DEX
without pools): `dex`, `pools` (discovered), `tracked`, `scored`, `rated` (scored pools that are
rated), `depth2Usd` (sum of ±2 % depth over scored pools, stale quotes left out), `depthKnownPools`
(the scored pools that sum covers: a known depth and no stale quote), `volume24hUsd` (sum over
scored pools with a known volume; `null` when none has one), `medianHealth` (median health total
over rated pools only, `null` when none is rated). `totals` has the same fields without `dex`, its
`medianHealth` taken over all rated pools.

### `GET /api/pools`

A ranked page of scored pools. Response: `{ items: PoolSummary[], total }`, where `total` is the
number of matching pools ignoring `limit` / `offset`.

| Parameter   | Values                                                     | Default  | Meaning                                                                                                                                |
| ----------- | ---------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `sort`      | `health`, `depth`, `volume`, `gap`, `tvl`, `spread`, `top` | `health` | Health total, ±2 % depth, 24 h volume, gap score, TVL, `spread10kBps` or `ownerTop1Share`. `null` values sort last in both directions. |
| `dir`       | `asc`, `desc`                                              | `desc`   | Ties are broken by pool id, ascending.                                                                                                 |
| `dex`       | one of the six `dex` values                                | all      | Keep one DEX.                                                                                                                          |
| `q`         | text, at most 100 characters                               | none     | Case-insensitive substring of either token's symbol or address, the pool address or the v4 pool id.                                    |
| `minVolume` | number ≥ 0 (USD)                                           | none     | Keep pools whose known 24 h volume is at least this; pools with unknown volume are dropped.                                            |
| `rated`     | `true`, `false`                                            | both     | `true` keeps only rated pools, `false` only unrated ones.                                                                              |
| `limit`     | integer 1–200                                              | 50       | Page size.                                                                                                                             |
| `offset`    | integer ≥ 0                                                | 0        | Rows to skip.                                                                                                                          |

`PoolSummary` fields: `pool` (pool metadata: `id`, `dex`, `kind` (`concentrated`,
`constant-product`, `stable-swap`), `address`, `poolId`, `token0` and `token1` (`address`, `symbol`,
`name`, `decimals`, `label`), `feePips`, `tickSpacing`, `stable`, `hooks`, `createdAtBlock`),
`price`, `tvlUsd`, `depth2Usd`, `depth2UpUsd` (USD of token1 that lifts the price 2 %, the buy
side), `depth2DownUsd` (USD of token0 that pushes it down 2 %, the sell side), `spread10kBps`,
`priceDeviationBps`, `staleQuote`, `health` (`total`, `grade`, `rated`, `unratedReason`,
`concentrationBasis`), `gapScore`, `volume24hUsd`, `ownerTop1Share` (the largest LP's share of the
pool, `null` unless indexed owners hold liquidity in the band and cover at least 90 % of it),
`updatedAt`. `health` is always present; `grade` is `null` for an unrated pool, and sorting by
health puts unrated pools after the rated ones in both directions; sorting by depth puts stale
quotes after the others. The two sides come from the newest snapshot's ±2 % level; a side is `null`
when its token has no USD price, and when the known tick range ends before 2 % it is the total up to
that point (`latest.depth[].up.reached` / `.down.reached` on `GET /api/pools/:id` say which).

### `GET /api/pools/:id`

One pool, scored or not; 404 `pool not found` for an unknown id. Fields:
- `pool`: pool metadata as above; `tracked`: whether the pipeline snapshots it.
- `latest`: the newest snapshot, or `null`: `poolId`, `blockNumber`, `timestamp`, `price`,
  `token0Usd`, `token1Usd`, `tvlUsd`, `activeLiquidity`, `depth` (raw amounts per level and
  side), `depthUsd` (USD per level and side), `spreads` (`notionalUsd` 1000 / 10000 / 100000 /
  1000000, `spreadBps`, `feasible`, `buyAvgPrice`, `sellAvgPrice`; snapshots stored before the
  $1M point have the first three), `concentration`, `priceDeviationBps`, `feePips` (the LP fee
  this snapshot's depth and spread used; `null` in snapshots stored before it).
- `score`: `total`, `grade` (`null` when unrated), `rated`, `unratedReason`,
  `concentrationBasis`, `components` (`depth`, `spread`, `concentration`, `persistence`), `notes`;
  `gap`: `volume24hUsd`, `depth2Usd`, `turnoverRatio`, `gapScore`.
- `persistence24h`, `persistence7d`: `windowHours`, `samples`, `depthUsdMedian`, `depthUsdP10`,
  `depthUsdMin`, `stability`, `uptime`.
- `volume24hUsd`: the score's 24 h volume (the 24 whole hours before the hour of the last block
  the latest volume pass read), `null` when the pool is not scored or was not part of that pass.
- `scoredAt`: when the score was computed.

`score`, `gap`, `persistence24h`, `persistence7d`, `volume24hUsd` and `scoredAt` are `null` until
the pool is scored.

### `GET /api/pools/:id/history`

| Parameter | Values      | Default |
| --------- | ----------- | ------- |
| `window`  | `24h`, `7d` | `24h`   |

Response: `{ window, from, to, points }`. The window ends at the pool's newest snapshot (`to`),
not at the current time, and `from = to − window`; both bounds are inclusive. `points` holds one
entry per stored snapshot in the window, ascending: `timestamp`, `price`, `depth2Usd`,
`spread10kBps`, `tvlUsd`, `health` (the score total recomputed for that snapshot), `feePips` (the
LP fee that snapshot used, `null` before it was stored: on a Slipstream pool it explains a spread
that moved with the fee). 404 `pool not found` for an unknown id. The response carries
`Cache-Control: public, max-age=60` (see [Caching](#caching-rate-limits-and-cors)).

### `GET /api/gaps`

The liquidity gaps feed: scored pools with a gap score and 24 h volume ≥ `minVolume`, highest gap
score first (ties by pool id). Response:
`{ items: [{ pool: PoolSummary, gap }], total, meaningful, minVolumeUsd }` with `gap` =
`volume24hUsd`, `depth2Usd`, `turnoverRatio`, `gapScore`; `total` the feed's pools and
`meaningful` those trading 3× their ±2 % depth or more (`turnoverRatio ≥ 3`), both over the whole
feed ignoring `limit` / `offset`; and `minVolumeUsd` the floor applied.

| Parameter   | Values           | Default |
| ----------- | ---------------- | ------- |
| `minVolume` | number ≥ 0 (USD) | 10000   |
| `limit`     | integer 1–200    | 50      |
| `offset`    | integer ≥ 0      | 0       |

### `GET /api/tokens/:address`

A token, its USD price and the scored pools that contain it. 400 for an address that is not
`0x` + 40 hex characters, 404 `token not found` for a token the database does not know.

| Parameter | Values                                                     | Default |
| --------- | ---------------------------------------------------------- | ------- |
| `sort`    | `health`, `depth`, `volume`, `gap`, `tvl`, `spread`, `top` | `depth` |
| `dir`     | `asc`, `desc`                                              | `desc`  |
| `limit`   | integer 1–200                                              | 50      |
| `offset`  | integer ≥ 0                                                | 0       |

Fields: `token` (`address`, `symbol`, `name`, `decimals`, `label`: told apart from the tokens of
scored pools even when this one has none), `usd` (`null` when unpriced), `via`
(pool ids the price was derived through, plus `wrap:weth` for the native ETH ↔ WETH step and
any other non-pool source; empty for an anchor stable or an unpriced token),
`priceUpdatedAt`, `pools` (`PoolSummary[]`, sorted as requested), `total` (scored pools with the
token, ignoring `limit` / `offset`), `poolCount` (every discovered pool with the token, scored or
not), `depth2UsdTotal` (the ±2 % depth, `depth2Usd`, summed over every scored pool of the token
with a known depth and no stale quote, whatever the page; `null` when none has one) and
`depthKnownPools` (how many pools that sum covers). A pool counts in full for each of its two tokens.

### `GET /api/mm`

Market-maker scorecards: a project registers a mandate (one pool, its market maker's addresses
and KPIs) and every snapshot of that pool is evaluated against the KPIs using only the liquidity
those addresses own. Response: `{ items: ScorecardSummary[] }`, active mandates first, then by
name. Parameters: `pool` (exact pool id, at most 200 characters) and `active` (`true` or
`false`, any case); without them every mandate is listed.

`ScorecardSummary` fields: `mandate` (`id`, `name`, `poolId` (lowercase, like every pool id),
`marketMaker`, `addresses`,
`kpis` (`minDepthUsd` per side, `bandPct`, `maxSpreadBps`, `spreadNotionalUsd`,
`targetUptime`), `alertWebhookConfigured`, `alertAfterSamples`, `active`, `createdAt`,
`notes`), `latest` (the newest sample or `null`), `uptime` (`h24`, `d7`, `d30`, each `windowHours`,
`samples`, `withinKpi`, `uptime`), `worst` (`minDepthUpUsd`, `minDepthDownUsd`, `maxSpreadBps`:
the worst excursion in 30 days or `null`), `streak` (`breached`, `samples`, `since`) and
`status` (`ok`, `breached`, `no-data`, `inactive`). Uptime is the share of evaluable samples
within KPI; a sample is not evaluable when a USD price was missing. `alertWebhookConfigured` is a
boolean: the mandate's alert webhook URL is a secret (whoever holds it can post through it), so
no route ever returns it, in any form.

### `GET /api/mm/:id`

One scorecard (`ScorecardSummary`) plus `pool`: the observatory's `PoolSummary` of the mandated
pool, `null` until that pool is scored. 404 `mandate not found` for an unknown id.

### `GET /api/mm/:id/samples`

| Parameter | Values             | Default |
| --------- | ------------------ | ------- |
| `window`  | `24h`, `7d`, `30d` | `7d`    |
| `limit`   | integer 1–10000    | 10000   |

Response: `{ window, from, to, points }`, with `to` the server's current time and points
ascending; when more than `limit` samples fall inside the window, the newest `limit` are
returned. A sample: `mandateId`, `poolId`, `blockNumber`, `timestamp`, `attribution` (`method`
`positions` | `lp-share` | `none`, `holdings`, `shareOfPool`, the market maker's `depthUpUsd` /
`depthDownUsd` / `spreadBps` and the whole pool's `poolDepthUpUsd` / `poolDepthDownUsd` /
`poolSpreadBps`), `withinKpi` (`true`, `false`, or `null` when not evaluable) and `breaches`
(`depthUp`, `depthDown`, `spread`, `noLiquidity`).

### `GET /api/mm/:id/badge.svg`

An SVG badge reading `depthwatch | <status> · 7d <uptime>%` (`image/svg+xml`, `Cache-Control:
public, max-age=300`); 404 JSON for an unknown id.

### Documents

`GET /AGENTS.md` (`text/markdown; charset=utf-8`), `GET /llms.txt` (`text/plain;
charset=utf-8`) and `GET /openapi.json` (`application/json`).

Two write routes exist for the operator: `POST /api/mm` and `DELETE /api/mm/:id` register and
remove mandates and need `Authorization: Bearer <token>` (`DEPTHWATCH_ADMIN_TOKEN`); a server
without a token answers them with 403, and a registration body over 64 KiB answers 413. They are
not part of this guide or of `/openapi.json`.

## Examples

Outputs below come from `depthwatch demo` (synthetic data), piped through `jq` and reformatted.

Find the WETH/USDC pools, deepest first: list the pools containing WETH and keep those whose other
token is USDC (`q` and `/api/tokens/:address` match one token, so the second one is filtered
client-side). Uniswap v4 pools hold native ETH as `0x0000000000000000000000000000000000000000`;
query that address too for ETH pairs.

```sh
WETH=0x4200000000000000000000000000000000000006
USDC=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
curl -s "$DW/api/tokens/$WETH?sort=depth&limit=200" | jq --arg usdc "$USDC" \
  '[.pools[] | select(.pool.token0.address == $usdc or .pool.token1.address == $usdc)
    | {id: .pool.id, depth2Usd, depth2UpUsd, depth2DownUsd, spread10kBps, grade: .health.grade,
       updatedAt}]'
```

```json
[
  {
    "id": "aerodrome-slipstream:0xdf5433c05c6bcde6d1ce8520689c105f555e34d5",
    "depth2Usd": 11181646.081658844,
    "depth2UpUsd": 6079641.564088,
    "depth2DownUsd": 5102004.517570845,
    "spread10kBps": 10.384831875477806,
    "grade": "A",
    "updatedAt": 1792713600
  },
  {
    "id": "aero-slipstream:0x0d89706050d77de3c23b79a963b403be3d608d55",
    "depth2Usd": 9329158.619842798,
    "depth2UpUsd": 5030253.01868,
    "depth2DownUsd": 4298905.601162797,
    "spread10kBps": 37.30624555010988,
    "grade": "A",
    "updatedAt": 1792713600
  },
  {
    "id": "uniswap-v3:0x77ebf3fa47dacd6c5ab06f521057260dea765327",
    "depth2Usd": 5276721.133927226,
    "depth2UpUsd": 2964808.046273,
    "depth2DownUsd": 2311913.0876542255,
    "spread10kBps": 10.77486194497076,
    "grade": "A",
    "updatedAt": 1792713600
  }
]
```

Read one pool's depth per side, its spread ladder and how durable the depth is:

```sh
curl -s "$DW/api/pools/uniswap-v3:0x77ebf3fa47dacd6c5ab06f521057260dea765327" | jq \
  '{pair: "\(.pool.token0.symbol)/\(.pool.token1.symbol)", feePips: .pool.feePips,
    price: .latest.price, block: .latest.blockNumber, at: .latest.timestamp,
    depthUsd: .latest.depthUsd, reached: [.latest.depth[] | {pct, up: .up.reached, down: .down.reached}],
    spreads: [.latest.spreads[] | {notionalUsd, spreadBps}],
    top1Share: .latest.concentration.owners.top1Share, uptime24h: .persistence24h.uptime}'
```

```json
{
  "pair": "WETH/USDC",
  "feePips": 500,
  "price": 2460.3179121319013,
  "block": "52950000",
  "at": 1792713600,
  "depthUsd": [
    {
      "pct": 1,
      "upUsd": 1291487.181859,
      "downUsd": 1304499.8108537977,
      "totalUsd": 2595986.9927127976
    },
    {
      "pct": 2,
      "upUsd": 2964808.046273,
      "downUsd": 2311913.0876542255,
      "totalUsd": 5276721.133927226
    },
    {
      "pct": 5,
      "upUsd": 6720984.630476,
      "downUsd": 5338239.981258249,
      "totalUsd": 12059224.611734249
    }
  ],
  "reached": [
    { "pct": 1, "up": true, "down": true },
    { "pct": 2, "up": true, "down": true },
    { "pct": 5, "up": true, "down": true }
  ],
  "spreads": [
    { "notionalUsd": 1000, "spreadBps": 10.079739320059604 },
    { "notionalUsd": 10000, "spreadBps": 10.77486194497076 },
    { "notionalUsd": 100000, "spreadBps": 17.724762294089828 },
    { "notionalUsd": 1000000, "spreadBps": 87.09151895527575 }
  ],
  "top1Share": 0.6584035311406606,
  "uptime24h": 1
}
```

Reading it: WETH is token0, so buying WETH with USDC is the up side. A $250,000 buy is below the
up side's $1.29M at 1 %, so in this snapshot it moves the price by less than 1 %; the $100k round
trip costs 17.7 bps with the 0.05 % fee included. One owner holds 66 % of the in-band liquidity
and could withdraw most of the depth at once. Depth as a raw amount: the
`latest.depth` entry with `pct: 2` has `up.amountIn` `"2964808046273"`, USDC with 6 decimals, so
2,964,808.05 USDC moves this pool's price up 2 %.

Other calls:

```sh
curl -s "$DW/api/pools?sort=depth&dex=aerodrome-slipstream&limit=10"    # deepest Aerodrome Slipstream pools
curl -s "$DW/api/pools?q=aero&minVolume=100000"                         # pools with AERO, >= $100k volume
curl -s "$DW/api/pools/uniswap-v3:0x77ebf3fa47dacd6c5ab06f521057260dea765327/history?window=7d"
curl -s "$DW/api/gaps?minVolume=50000&limit=20"                         # volume outrunning depth
curl -s "$DW/api/stats"
curl -s "$DW/api/mm?active=true"                                        # market-maker scorecards
curl -s "$DW/api/mm/demo-aero-usdc-aero/samples?window=24h&limit=12"
curl -s -o badge.svg "$DW/api/mm/demo-aero-usdc-aero/badge.svg"
```

## How to pick a pool for a trade

Say the trade is: buy token X with N USD worth of token Y on Base.
1. **Check the server.** `GET /api/health`: `source` must be `live` and `snapshotAgeSeconds` small
   (`depthwatch start` snapshots every 1800 s by default, `run` every 300 s; the operator sets the
   interval); `?maxAge=<seconds>` makes the server answer 503 itself when the data are older.
2. **List the candidates.** `GET /api/tokens/<X address>?sort=depth&limit=200`, keep the pools
   whose other token is Y. If X has more than 200 scored pools, page with `offset` up to `total`.
   Each listed pool already carries its ±2 % depth per side (`depth2UpUsd`, `depth2DownUsd`) for
   a first ranking by the side you need (step 3).
   Pools that are not tracked are not listed; no listed pool means Depthwatch has no measurement
   for the pair, not that the pair has no liquidity.
3. **Work out the side.** If X is the pool's `token0`, buying X is the **up** side and your input
   (Y) is token1. If X is `token1`, buying X is the **down** side and your input is token0.
4. **Read the side's depth.** `GET /api/pools/:id`, then `latest.depthUsd[]`: `upUsd` or
   `downUsd` at 1, 2 and 5 %. If N is below the side's depth at 1 %, the trade moves the pool
   price by less than 1 % in that snapshot's state, so your average price is worse than
   `latest.price` by at most about 1 % plus the pool fee (`feePips`; on a Slipstream pool, the fee
   read at that snapshot's block, which the next block can change). If a level's
   `latest.depth[].up.reached` or `.down.reached` is `false`, the pool cannot move that far
   within known liquidity: treat it as too thin at that level.
5. **Read the cost.** `latest.spreads[]` is the round-trip cost in bps at $1k, $10k, $100k and
   $1M; a pool that is cheapest at a small size can be unable to absorb a large one. The
   API does not report one-way cost; half the round-trip spread at the nearest notional is a
   rough one-way estimate.
6. **Check that the depth is durable.** Prefer pools with `persistence24h.uptime` and
   `stability` near 1 (depth there whenever sampled) and with no single owner holding most of
   the in-band liquidity (`latest.concentration.owners.top1Share`; `null` means unknown). The
   health grade combines these; a low score's `notes` say what is missing. A pool with
   `health.rated: false` has no grade: `unratedReason` says it is too thin, one-sided, unpriced
   or hooked (not modelled), and it is not a pool to size a trade against.
7. **Check freshness and prices.** `latest.timestamp` against the current time; `token0Usd` /
   `token1Usd` come from Depthwatch's own price graph (`GET /api/tokens/:address` shows `via`).
   A pool with `latest.priceDeviationBps` of 500 or more quotes a stale price: skip it.
8. **Verify onchain, then execute elsewhere.** Every number describes the pool at
   `latest.blockNumber`, and the pool's state can change with every Base block, five a second (a
   snapshot 30 minutes old is 9,000 blocks behind). Before trading, read the pool's current state
   or a DEX quote through an RPC endpoint, and set a slippage limit from that, not from Depthwatch.

## Errors

Every error body is JSON: `{ "error": "<message>" }`, plus `issues: [{ path, message }]` on query
validation errors.

| Status | When                                                                                                                                              | `error`                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 400    | A query parameter is invalid (one `issues` entry per parameter)                                                                                   | `invalid query: <path>: <message>; …`                    |
| 400    | `/api/tokens/:address` with a malformed address                                                                                                   | `invalid token address: expected 0x + 40 hex chars`      |
| 404    | Unknown pool id, token or mandate id                                                                                                              | `pool not found`, `token not found`, `mandate not found` |
| 404    | Unknown `/api` route (any unknown path when the dashboard is not served)                                                                          | `not found`                                              |
| 500    | Unexpected server error                                                                                                                           | `internal error`                                         |
| 503    | `GET /api/health` only: the database cannot be read, or `maxAge` was given and the newest snapshot is older or missing (body is the health shape) | the database error, or `stale: …`                        |

Example: `curl -s "$DW/api/pools?limit=500"` answers 400 with
`{"error":"invalid query: limit: Too big: expected number to be <=200","issues":[{"path":"limit","message":"Too big: expected number to be <=200"}]}`.
The `message` wording comes from the validator and may change; match on status and `path`.

## Caching, rate limits and CORS

- The server has no rate limiting, no API keys and no response cache of its own; an operator may
  put a proxy in front that adds either. Every request reads the database directly.
- Pool data only change when the pipeline writes a new snapshot or score, so polling faster than
  the snapshot interval returns the same numbers; compare `latestSnapshotAt` and `latestScoredAt`
  to detect new data (a pass stores its snapshots first and its scores, the health, gap and
  24 h volume, at its end).
  Scorecards are computed over windows that end at the server's clock; the server keeps the last
  summary per mandate and serves it again until the mandate changes, a new sample is stored or a
  minute has passed, so two requests within a minute see the same numbers.
- Responses are gzip- or deflate-compressed when `Accept-Encoding` allows it (`Vary:
  Accept-Encoding`), and every `GET` response carries an `ETag`: send it back as `If-None-Match`
  and an unchanged answer is a bodiless 304.
- `Cache-Control`: successful `GET /api/*` responses say `public, max-age=30`, except
  `/api/pools/:id/history` (`public, max-age=60`: a week of points is the most expensive read),
  `/api/mm/:id/badge.svg` (`public, max-age=300`) and `GET /api/health`, which sends none so a
  probe always sees the server as it is. The dashboard's hashed `/assets/*` files are
  `public, max-age=31536000, immutable`; `index.html` and the other files are `no-cache`, and so
  is `index.html` when it answers a page load of a missing `/assets/*` path.
- `/api/*` allows any origin (`Access-Control-Allow-Origin: *`) for `GET`, `HEAD` and `OPTIONS`,
  with preflight responses cached for 600 s. The documents at the root carry no CORS headers.

## Base network reference

Depthwatch indexes Base Mainnet only. For onchain verification:
- Base Mainnet: chain id `8453`, public RPC `https://mainnet.base.org` (rate-limited), explorer
  `https://basescan.org` (pools at `https://basescan.org/address/<pool address>`).
- Base Sepolia (`84532`, `https://sepolia.base.org`, `https://sepolia.basescan.org`) is not
  indexed by Depthwatch.
- For Base concepts, network setup and trading integration, use Base's own documentation first
  (<https://docs.base.org/llms.txt>, <https://docs.base.org/build-on-base/integrate-defi/integrate-trading.md>);
  use RPC endpoints and explorers to verify, not to explain.
