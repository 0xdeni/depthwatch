# Tokenized stocks: API, dashboard and agent documents

The second half of the design contract in [stocks.md](stocks.md), which holds the decisions, the
core, chain, pipeline and storage contract and the plan (MVP, phases, effort, deferred). The
numbers are defined in [METRICS.md](../METRICS.md), "Reference deviation" and "Stock aggregates".
Everything here is in the MVP except §5.

## 1. API (`apps/api`, core and db only)

Routes, layer 1, with the default `Cache-Control` (`API_CACHE_CONTROL`, 30 s: readings change at the
snapshot cadence, as pool data do; the header comment of `caching.ts` says "pool and stock data"):
- `GET /api/stocks` → `StocksResponse` `{ items: StockSummary[] }`: every stored stock, with pools
  or not, by `depth2BuyUsd + depth2SellUsd` descending (nulls last), then ticker. No parameters.
- `GET /api/stocks/:token` → `StockDetail`: the summary plus `pools: StockPoolRow[]`, every scored
  pool of the stock, `{ pool: PoolSummary, stockIs: 'token0' | 'token1', depth2BuyUsd,
  depth2SellUsd, counted: boolean, reference: PoolReference | null }`. Order: the pools that count
  in the sums first (`countsInStockSums`), then `min(depth2BuyUsd, depth2SellUsd)` descending with
  an unknown minimum last, then the pool id. 400 `invalid token address: expected 0x + 40 hex
  chars` for a malformed address, as `/api/tokens/:address` answers; 404 `{ error: 'stock not
  found' }` for a token the `stocks` table lacks, in the house style of `pool not found` and
  `token not found`.

`StockSummary` = `{ stock: { token: TokenDto (labelled), ticker, feed: StockFeedInfo | null },
reading: Jsonified<StockReading> | null, ...Omit<StockAggregate, 'token'>, updatedAt }`, where
`updatedAt` is the stock list's (`StockListEntry.updatedAt`: the block time of the newest snapshot
pass, which writes the list). Built in `apps/api/src/stocks.ts` from `scores.topBy('depth', {
token })`, read in pages of `MAX_LIMIT` (200) up to the result's `total` so that every scored pool
is summed however many there are, `snapshots.latestReferences` and `stockReadings.latestForMany`
over the stock list (one indexed search per stock: a pool of two stocks needs both readings),
through core `summarizeStock` over the stock's pools as the lists show them (`toPoolSummary`),
each with `pausedByNewerReading` from core's `newerReadingPauses(latest.blockNumber, the readings
of its two tokens)`; the detail's sides and `counted` are core's `stockSides` and
`countsInStockSums`. (Review fix: a pool whose newest snapshot predates a reading that finds the
transfers paused counts no more, as METRICS.md's "While the stock's transfers are paused none of
its pools counts" says; the row keeps its snapshot's own `reference`.) The route tests
(`routes/stocks.test.ts`) pin that case, the resumed one, and a stock with `MAX_LIMIT + 1` scored
pools summed past the first page. Row shapes (`StockDto`, `StockReadingDto`, `StockSummary`, `StockPoolRow`)
live in `apps/api/src/stockDto.ts`; `dto.ts` declares `StocksResponse` (an interface) and
`StockDetail` (a type) itself, because `docs.test.ts` matches `export (interface|type) Name` in
that file. The 400 body is `INVALID_ADDRESS` of `query.ts`, shared with `/api/tokens/:address`.
`PoolDetail.latest` carries `reference` through `PoolSnapshotDto`. The pass depth stored with each
reading (stocks.md §5) is not served before the history route (§5).

_Why routes of their own, not a category filter on `/api/pools`._ The unit is the stock: the
reading, the venue shares and the deepest pool's deviation belong to a token across its pools,
which a pool list cannot carry, and a stock-only column would be `null` in nearly every
`PoolSummary`. `/api/tokens/:address` is generic and pinned by its schema; it keeps working for
stocks, and its `usd` for a stock is the price graph's valuation convention (§4).

## 2. Rule-8 documents and the static bundle

In the same change as the routes (rule 8; `docs.test.ts` and `agentDocs.test.ts` pin them):
- README `## API`: two rows (`docs.test.ts`: every route `createApp` registers).
- DESIGN.md `## API (apps/api)`: two bullets naming `StocksResponse` and `StockDetail`
  (`docs.test.ts`: the layer-1 routes, and types that `dto.ts` exports). Its caching sentence
  stands: both routes use the default.
- `openapi.json`: two paths under a `stocks` tag; schemas `StocksResponse`, `StockSummary`,
  `StockDetail`, `StockPoolRow`, `StockReading`, `StockFeedInfo`, `StockVenue` and the enums
  (`StockDeviationNull`, `PausableFeature`); `PoolSnapshot.reference` with `PoolReference`,
  `ReferenceStatus` and `ReferenceNullReason` (stocks.md phase C); `UnratedReason` with
  `transfers-paused` (phase A). The test's schema subset has no `allOf`, so `StockDetail` repeats
  `StockSummary`'s properties beside `pools`, as `ScorecardDetail` repeats the scorecard's. The
  `info` description gains one sentence (the stock routes, no stock price, the Reg S line), and
  the shared `BadRequest` and `NotFound` responses name the stock route and `stock not found`.
  `agentDocs.test.ts`: exactly the GET routes, responses conforming, every property documented,
  over the stock seed (a live, a held and a paused stock, one with no pool, one with no feed and
  one with no reading yet), with the 400 and 404 bodies.
- AGENTS.md as in §4; `llms.txt` a Stocks line (only served routes), and its AGENTS.md line names
  the new section.
- ARCHITECTURE.md's route pointer and docs/design/scorecards.md §6 stay true unchanged.

**Static bundle.** `StaticBundle` (`apps/api/src/dto.ts`, mirrored in `apps/web/src/api/types.ts`,
listed in docs/design/web-v2.md §4) gains optional `stocks?: StockSummary[]` and `stockDetails?:
Record<string, StockDetail>` (key: lowercase address); `export` reads them through `createApp`, as
every key (the demo's `stocks: []` and `stockDetails: {}`), and `export --bundle` keeps a bundle
exported before them without them. Optional, so such a bundle still parses: the web's static
client then answers `{ items: [] }` and 404 `stock not found`. The web mirror's stock types are in
`apps/web/src/api/stockTypes.ts` from phase E on, since the bundle names them (§3). The refresh
workflow needs no new secret or variable (stocks.md §4, "Seed").

## 3. Dashboard (`apps/web`)

Data from the API only (`packages/chain/src/stocks.ts` is not on the browser-safe subpath).
`ApiClient` gains `stocks()` and `stock(address)`; types in `src/api/stockTypes.ts` (`types.ts` is
at 493 lines; phase E wrote the wire types there, phase F adds what the client needs), the mock in `src/api/mockStocks.ts` (a live, a held and a paused stock, scored by
core), the static client from the bundle. The texts below live in `src/lib/stockText.ts`.

**Words on every stock surface.**
- The eligibility line: "Coinbase tokenized stocks are only available to persons in eligible
  jurisdictions outside of the U.S. Depthwatch measures their markets; it does not offer, route or
  recommend trades in them."
- A stock's price-graph USD price, wherever it shows (depth and TVL in USD, a pool's prices):
  "Valuation price from Depthwatch's price graph, used for depth and TVL; not a stock price."
- `referenceUsd`: "Chainlink's answer", always with its status and age.
- A deviation: signed, two decimals, with its band. Inside: "+25.06 bps, within the feed's 0.5 %
  band plus the pool's 0.05 % fee". Outside: "+152.28 bps, outside the feed's 0.5 % band plus the
  pool's 0.05 % fee". None: "—" and the reason in words (Hooked pool, Too thin to compare, Two
  stocks, No feed, Feed not read, Feed paused, Feed invalid, Off-hours, Quote unpriced, No pool).
- Never "Buy", "Trade" or a link to a swap. Coinbase and Base are named in text only, no marks
  (CONTRIBUTING.md brand rules).

**Where the eligibility line appears.** On `/stocks` and `/stocks/:token`; on the pool page of a
stock pool (`latest.reference !== null`); and in a site-wide footer line, `FOOTER_STOCKS`, a
paragraph of its own after the promise, so `FOOTER_PROMISE`, its tests and the quotes of
visual-v4.md §5.1 stay exact (visual-v4.md quotes the new line and `Footer.test.tsx` checks the
quote). The token page gets no marker in the MVP (stocks.md §8), and the lists (Home, Pools, Gaps)
none at all: the footer line covers them. A stock's token page does carry the valuation label:
its facts row names the price "valuation price", with the label as the row's note, once `GET
/api/stocks` lists the token (review fix: the headline "USD price" was the one unlabelled
appearance of Depthwatch's price of a stock; `stockPoolLists.test.tsx` pins it).

**`/stocks`.** One row per stock, in the API's order: ticker and name; Chainlink's answer with its
age; the status chip in words (Live, Off-hours, Paused, Invalid, Unread, No feed) and a
"Transfers paused" chip when so; ±2 % buy and sell depth; the best $10k spread; the deepest pool's
deviation with its band; depth share by DEX as a bar with a text equivalent; TVL; pools.

**`/stocks/:token`.** Name, address on Basescan, the multiplier as "1 token = 1.000538 shares"; the
reference panel: the feed's description and address, Chainlink's answer, `updatedAt` in UTC and its
age, the status explained (held: "The feed holds its value from <time>, <age> ago: its market is
closed for the weekend or a holiday, or the feed stopped. The pools are the only market now; no
deviation is computed."); a banner while transfers are paused ("Transfers of NVDAc are paused:
every swap in its pools reverts. Their depth is shown as measured and left out of the totals.");
facts; venues (depth and volume shares); the pools in the API's order (DEX, quote, the stock's buy
and sell sides, $10k spread, deviation with its band, grade or unrated reason, stale and paused
flags), each linking to its pool page; a link to METRICS.md's "Reference deviation" on GitHub.

**Pool page of a stock pool.** A "Tokenized stock" row with the deviation and its band, the status
and the feed's age, and a link to the stock, then the eligibility line. Its swap section never
appears: `tradeGate` requires both tokens in `TRADE_TOKENS`; a test pins it with the switch on.

**Navigation.** `NAV_ITEMS` becomes Pools, Stocks, Gaps, Scorecards, Methodology; `/stocks` and
`/stocks/:token` make Stocks current. Label widths in the site's Hanken Grotesk at weight 700,
from its advance widths without kerning (to be confirmed in a browser): at 15 px Pools 36.8, Stocks
46.0, Gaps 34.9, Scorecards 77.6, Methodology 89.3 px; at 14 px Scorecards 72.5, Method 48.6,
Scores 43.5 px.
- Phone tab strip, below 840 px (each tab padded 10 px a side, 2 px apart, 16 px gutters): four
  tabs need 324.6 px and five 392.6 px. At 320 px the strip shows 288 px, so it scrolls with four
  already and keeps scrolling with five, with its trailing fade. The fade's query (`max-width:
  22.49em`, the 360 px where four fit) moves to where five fit, about 425 px (`26.56em`: five tabs need 392.6 px plus two 16 px gutters, 424.6 px), and
  ia-v3.md §1.2 and visual-v4.md §5.1 ("scrolls sideways below 360 px") say so.
- Bottom dock, installed app only: `repeat(4, …)` becomes `repeat(5, …)`. At 320 px a tab is
  (320 − 16 − 16) / 5 = 57.6 px wide, too narrow for Scorecards (72.5 px), which gets
  `short: 'Scores'`; its `aria-label` stays "Scorecards", as the dock already does for
  Methodology. The comments of `NAV_ITEMS`, `Dock.tsx` and `shell.css` and visual-v4.md's "four
  48 px tabs" say five.
- Desktop bar from 840 px: five items 28 px apart; the browser check confirms that the wordmark,
  the nav and the freshness button still fit at 840 px.
- Pins: `components/Layout.test.tsx` (the nav's links in order; the dock's labels `['Pools',
  'Stocks', 'Gaps', 'Scores', 'Method']`) and `App.test.tsx` (ia-v3 §2's routes, `/stocks` and
  `/stocks/<address>` current on Stocks); ia-v3.md §2's route table gains both routes, with no
  parameters.

`lib/rating.ts` gains `transfers-paused` (stocks.md phase A). Times are absolute in a static `live`
build.

As written (phase F):
- **Client.** `StockApi` (`stocks()`, `stock(address)`) lives in `stockTypes.ts` and `ApiClient`
  extends it, so `types.ts` stays at 493 lines. The address is lowercased before the request
  (`stockPath`); the mock and the static client answer the API's 400 and 404 bodies. Prefetch on
  intent reads `['stocks']` and `['stock', address]`, and a stock's page takes its title from the
  list while it loads (`cachedStock`).
- **Mock.** Seven synthetic stocks (`mockStockSeeds.ts`; core's `makeStock`, at `0xb2…`; no real
  address is copied), one per status (NVDAc live, AMZNc held, AAPLc paused, METAc invalid, MSFTc
  unread, COINc no feed, TSLAc live with its transfers paused) and seven pools built like every
  mock pool (`buildPool(seed, now, { tokens, transfersPaused })`), each with core's
  `poolReference`. The stock pools answer `pool`, `history` and their stocks' `token`, but stay
  out of `pools`, `stats`, `gaps` and the quote tokens' pages, so no figure another page pins
  changes.
- **Words.** The shared texts are `lib/stockText.ts`; the pages' answers and the reasons behind a
  "—" are `pages/stock/stockPageText.ts`. Status shapes: Live a circle (ok), Off-hours and Paused a
  square (warn), Invalid and Unread a triangle (bad), No feed a ring; "Transfers paused" a
  triangle; a stock with no reading yet reads "No reading yet". The list's deepest-pool deviation
  names the band as "the feed's 0.5 % band plus the pool's fee", since `StockSummary` carries no
  tolerance; the stock's page and the pool page name both parts from the pool's reference
  (`deviationThresholdBps`, `feeBps`, as core publishes them; review fix: the web had subtracted
  one from `toleranceBps`). A
  feed's age is a duration at the reading's block ("30 min old"), so it reads the same in a static
  build.
- **`/stocks`.** One block over the band: a caption (the count and the valuation label), a column
  header from 1024 px, and one row per stock whose cells each carry their own label (value first),
  two or four to a line below 1024 px. A stock with no scored pool shows one cell in place of
  depth, spread, deviation and venues. The venue bar draws the largest venue in ink, the second in
  `--text-2` and the rest hatched; its accessible name lists every venue, and the row names the
  largest. The band holds the eligibility line and the link to METRICS.md's "Reference deviation".
- **`/stocks/:token`.** The title section (symbol, name, status chips, answer); the band is the
  reference panel (Chainlink's answer, its age at the block, the status explained, the paused
  banner, the eligibility line, the METRICS.md link); the facts row (buy and sell sides, the best
  $10K spread with its pool, the deepest pool's deviation) with the valuation label as its note;
  the sections sheet (venues; pools, whose table takes the sheet's width from 1024 px, and whose
  last column says where each pool stands from the API's `counted` and sides: "Counted",
  "Counted, one side unpriced: not in the depth sums", or the stale or "Transfers paused" chip with
  "left out of the sums", while the takeaway counts `sidesKnownPools` as "in the depth sums";
  review fix: the column had read the health's unrated reason); about this
  stock (address, multiplier, paused features, feed and its terms, the latest round, the oracle
  registry's flag, the reading and its error).
- **Pool page.** The stock row is the sheet's first section, "tokenized stock": the deviation and
  its band as the finding (the reference's `deviationThresholdBps` and `feeBps`), then the stock's
  link, Chainlink's answer with status and
  age, the pool's mid in dollars, the deviation and band, the stock's valuation price with its
  label, and the eligibility line. About this pool's "Prices used" carries the label too.
- **Footer.** `FOOTER_STOCKS` is `ELIGIBILITY_LINE`, a second paragraph in the footer's text column
  (`.foot-text`), so `.foot-say` keeps the promise word for word.
- **Boot size.** The two pages add about 26 KB to the boot script (578,257 → 604,213 bytes in the
  server build, 584,358 → 610,568 in the static one); `src/tradeBundle.test.ts`'s budget moved to
  616,000 and 623,000, about 2 % above, which still fails on the panel's 182 KB chunk.


## 4. Agent documents (`apps/api/src/agentDocs/AGENTS.md`)

- `### GET /api/stocks` and `### GET /api/stocks/:token`, one section per route.
- Conventions: a stock is identified by address, never by symbol (Base: "Metadata is mutable
  onchain"); `buy` and `sell` are oriented to the stock; the deviation's sign; `toleranceBps` and
  `withinTolerance`; the statuses, the two-part off-hours rule and `feedAgeSeconds`. Not an oracle:
  `referenceUsd` is Chainlink's answer passed on with its status and age; a stock's `usd`,
  `token0Usd` and `token1Usd` are the price graph's valuation convention for depth and TVL; neither
  is a price to settle, mark or liquidate against, and Depthwatch publishes no stock price.
- A section **"How to read a stock's liquidity"**, with no ranking of pools for a buy, no cost step
  and no execution step:
  1. First, its Reg S line: "Coinbase tokenized stocks are offered under Regulation S and are only
     available to persons in eligible jurisdictions outside of the U.S. Depthwatch measures their
     markets; it does not offer, route or recommend trades in them, and nothing here is a way to
     trade them."
  2. `GET /api/health`: `source: live` and the snapshot's age.
  3. `GET /api/stocks`: the stocks with their depth, spread and venue shares; take a stock's
     address from there or from base.org/stocks.
  4. `GET /api/stocks/<address>`: `reading.transfersPaused` (true: no pool of the stock can trade,
     and its depth is out of every total), `reading.referenceStatus` and `feedAgeSeconds`.
  5. Each pool's `reference`: `deviationBps` with `withinTolerance` (inside the feed's 0.5 % band
     plus the pool's fee is no sign of mispricing); `deviationNull` when there is none (`held`: the
     feed holds a closed market's value; `thin`: the pool is too thin for its price to mean
     anything); a `live` reading with a large age may be a quiet market or a holiday.
  6. Verify onchain before relying on any of it: `latestRoundData()` on `stock.feed.address`,
     `pausedFeatures()` on the token, the pool's state. Never settle against Depthwatch's numbers
     or a held feed.
- "How to pick a pool for a trade" opens with: "This recipe does not cover tokenized stocks: `GET
  /api/stocks` lists them, and 'How to read a stock's liquidity' says what the data mean."
- "Errors": the 404 row reads "Unknown pool id, token, stock or mandate id" and lists `stock not
  found`; the 400 row names `/api/stocks/:token` beside `/api/tokens/:address`.
- The caching bullet stands (both routes use the default); the `UnratedReason` list gains
  `transfers-paused` (phase A).

As written (phase E): the Reg S line opens the section as its first paragraph, word for word, and
steps 2 to 6 above follow it as steps 1 to 5. Beside the items above, the guide's opening says the
stocks are measured only and points to the section; the conventions bullet quotes Base's
"Tokens should be identified by address rather than ticker or symbol. Metadata is mutable onchain"
(docs/research/base-contracts.md `## stocks`); `GET /api/pools/:id` lists `latest.reference`;
"Other calls" gains `curl -s "$DW/api/stocks"`; and the caching bullet says "Pool and stock data".

## 5. Deferred: the history route and off-hours depth

Not in the MVP (stocks.md §8); written here so that the stored readings carry what they need.
- `GET /api/stocks/:token/history?window=24h|7d`, default `7d` (pools default to `24h`; off-hours
  needs a weekend) → `StockHistoryResponse` `{ window, from, to, points, offHours: OffHoursDepth
  }`, the window ending at the newest reading. A point per reading, `{ timestamp, blockNumber,
  referenceStatus, feedAgeSeconds, referenceUsd, ...StockPassDepth }`, read from `stock_readings`
  alone, since the pass depth outlives the snapshots. `HISTORY_CACHE_CONTROL` (60 s), with the
  `caching.ts` comments ("a pool's or a stock's history"), DESIGN.md's caching sentence and the
  AGENTS.md caching bullet; the rule-8 documents (a README row, a DESIGN.md bullet naming
  `StockHistoryResponse`, the openapi path with `StockHistoryResponse` and `OffHoursDepth`, an
  AGENTS.md section); the bundle's `stockHistory?: Record<string, { '24h'; '7d' }>`; a history
  section on `/stocks/:token` (7 d depth with held periods shaded, the deepest pool's deviation,
  the `heldToLive` sentence).
- `OffHoursDepth { windowHours; heldPoints; livePoints; heldMedianUsd; liveMedianUsd; heldToLive
  }` from `computeOffHoursDepth(points, windowHours, newestTimestamp)` in
  `packages/core/src/stocks/offHours.ts`. This definition moves to METRICS.md in the change that
  implements it (rule 4):
  - Points: the stock's readings with `timestamp` in `(t − W × 3,600, t]`, `t` the newest
    reading's timestamp (`newestTimestamp`, no wall clock), W 24 h or 7 d, whose status is `live`
    or `held` and whose pass depth has `sidesKnownPools > 0`.
  - A point's value is its pass depth's `depth2BuyUsd + depth2SellUsd`: every pool holding the
    stock that the reading's pass snapshotted at that block, whether tracked now or not, counted as
    in "Stock aggregates". Its deviation is the pass depth's (its deepest pool at that block, with
    `withinTolerance` and `deviationNull`), and `sidesKnownPools` is its count.
  - With the medians computed as for persistence (linear interpolation): `heldMedianUsd` and
    `heldPoints` over the `held` points, `liveMedianUsd` and `livePoints` over the `live` ones;
    `heldToLive = heldMedianUsd / liveMedianUsd`, `null` with fewer than 3 points in either class
    or a live median of 0. With the weekly close the held points begin at Friday 20:00 New York
    time; a weekday holiday's points read mostly `live` (METRICS.md, "Off-hours").
  - Example: held points of $60,000, $62,000, $58,000, $64,000 and $61,000 and live points of
    $95,000, $100,000, $105,000, $110,000, $115,000 and $120,000: `heldMedianUsd = $61,000`,
    `liveMedianUsd = $107,500`, `heldToLive = 0.5674`. With only two held points it is `null`.

## 6. Tests (hermetic)

- api: `routes/stocks.test.ts` through `app.request()` on `openDatabase(':memory:')`, over a seed
  with stocks (`apps/api/src/testing/stocks.ts`, as `aero.ts` seeds Aero): the list order (depth,
  nulls, ticker); the detail and its pool order (counted, thinner side, id); 400; 404 `stock not
  found`; an empty database (`{ items: [] }`); a stock with no pool; a paused stock (no pool
  counts); `PoolDetail.latest.reference`. `agentDocs.test.ts` with the stock seed;
  `apps/cli/src/export.test.ts` (both keys, and a bundle without them).
- web, on the mock client and jsdom: the list and the detail render the live, held and paused
  stocks, every status chip, the deviation's sign and band in words (inside and outside), "—" with
  the reason; the eligibility line on `/stocks`, `/stocks/:token`, a stock pool's page and in the
  footer; no element of a stock surface names a buy, a trade or a swap; `tradeGate` refuses a
  stock pool with the switch on; the static client with and without the stock keys; the nav and
  dock pins of §3.
