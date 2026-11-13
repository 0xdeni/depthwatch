# Dashboard v2: design, demo history and the static build (contract)

Goal: the dashboard reads as a designed product a first-time visitor, a protocol team or a market
maker understands in ten seconds, works properly on a phone, shows real-looking trends in the
demo, and can be published as a static site (no server) that anyone opens from a link.

Visual identity (palette, type, logo, component rules) was decided in `docs/design/visual.md`.
This file fixes everything else.

Status: §1 (information architecture) and §2 (layout) are superseded by [`ia-v3.md`](ia-v3.md),
[`principles.md`](principles.md) and [`visual-v3.md`](visual-v3.md); §3 (demo history), §4 (static
bundle and build modes) and §5 (tests) remain the contract and are cited by DESIGN.md.

## 1. Information architecture

| Route              | Page                                                                |
| ------------------ | ------------------------------------------------------------------- |
| `/`                | **Home** (new): what Depthwatch is and the live headline numbers    |
| `/pools`           | **Pools** explorer (the v1 Overview: DEX summary + top-pools table) |
| `/pools/:id`       | Pool detail (unchanged path)                                        |
| `/gaps`            | Liquidity gaps (unchanged path)                                     |
| `/tokens/:address` | Token (unchanged path)                                              |
| `/mm`, `/mm/:id`   | Scorecards list and detail (unchanged paths)                        |
| `/methodology`     | **Methodology** (new): plain-language metric definitions            |

Header: logo + wordmark (links to `/`), nav **Pools · Gaps · Scorecards · Methodology**, data
freshness on the right (block, "updated … ago"). On phones the nav stays one row (scrollable if
needed) and freshness moves under it or into the footer. Footer on every page: "Open source ·
no token · no custody · read-only", repository link (`https://github.com/0xdeni/depthwatch`), data
source line ("Synthetic demo world" in demo/static demo mode, else "Base mainnet").

**Home** sections, in order:
1. Hero: one-sentence promise (what it measures and for whom), a secondary line (Base-only;
   Uniswap v3/v4 and Aerodrome), primary action "Explore pools" → `/pools`, secondary
   "How it's measured" → `/methodology`.
2. Headline numbers from `/api/stats` totals: pools scored, total depth ±2 %, 24 h volume,
   median health (grade chip).
3. "Biggest liquidity gaps": top 5 from `/api/gaps` with volume, depth ±2 %, turnover and gap
   score, link to `/gaps`. One sentence explaining a gap.
4. "Market-maker scorecards": up to 3 cards from `/api/mm` (name, pool, status, 7 d uptime,
   badge), link to `/mm`. One sentence explaining a scorecard.
5. "What we measure": four short items (depth, spread, concentration, persistence) linking to
   `/methodology#<anchor>`.

**Methodology**: static content summarising `docs/METRICS.md` and `docs/SCORECARDS.md` in plain
language with the exact formulas in small print: depth, effective spread, concentration,
persistence, health score and grades, gap score, scorecard evaluation and uptime. Anchors:
`#depth`, `#spread`, `#concentration`, `#persistence`, `#health`, `#gaps`, `#scorecards`.

Every internal link that pointed at `/` for the pools table now points at `/pools`.

## 2. Layout fixes (all pages)

- No table hides columns silently. At ≥ 1024 px every table column fits or the table sits in a
  scroll box with a visible fade/shadow affordance. The Home and Pools gaps panels show gap
  score and turnover.
- Below 640 px, the pools, gaps, tokens and scorecards tables render as stacked rows: pair +
  DEX chip + grade on the first line, 3–4 key metrics with labels on the second. Tapping the row
  opens the detail page (whole row is one `<a>`).
- Pools page on phones: the per-DEX summary is one compact block (segmented control or
  horizontal scroller), not five full-height cards before the table.
- Charts with fewer than 2 points show an explicit "not enough history yet" state instead of a
  lone dot.
- Touch targets ≥ 44 px, text contrast ≥ 4.5:1 in light and dark, no horizontal page scroll at
  320 px.

## 3. Demo history (apps/cli + packages/chain)

`pnpm depthwatch demo` must show seven days of history produced by the **real pipeline**, never
by writing snapshot rows directly:
- `createSyntheticFixture` gains a time dimension: `opts.epochTimestamp` (and block) selects a
  state of the synthetic world at that moment, with deterministic variation: pool liquidity
  follows smooth daily cycles plus seeded noise (±10–25 %), prices drift (ETH within ±4 %), swap
  volume varies by hour. Scripted events: the USDC/AERO market maker (`SYNTHETIC_OWNERS[0]`) pulls
  most of its LP on a schedule so its scorecard alternates between breached and within KPI (7 d
  uptime roughly 30–60 %); the Slipstream market maker dips below its KPI once for about 6 h and
  recovers (one breach streak, then ok). Same seed ⇒ identical output.
- `runDemoPipeline` runs discover once, then for each point from `now − 7 d` to `now` every 2 h
  (85 points): positions (cheap on the fixture), snapshot (with mandate sampling), and finally
  volume and score at `now`. Pipeline clock = the point's timestamp.
- Budget: the whole demo pipeline ≤ 20 s on a developer laptop; an option `historyPoints` lets
  tests run a short history (e.g. 4 points).
- Persistence and uptime are then non-neutral; history charts show lines.

## 4. Static bundle and build modes

### Bundle (`StaticBundle`, defined in `apps/api/src/dto.ts`, mirrored in `apps/web/src/api/types.ts`)

```ts
interface StaticBundle {
  v: 1
  generatedAt: number // unix seconds
  source: 'demo' | 'live'
  note?: string // depthwatch export --note; absent without the flag (demo exports)
  updates?: 'several-times-a-day' // depthwatch export --updates; absent: no schedule claimed
  features?: { trade: TradeFlags } // the trade switch (DEPTHWATCH_TRADE); absent = off
  health: HealthResponse
  stats: StatsResponse
  pools: PoolSummary[] // every scored pool (all pages of /api/pools)
  poolDetails: Record<string, PoolDetail> // key = pool id
  history: Record<string, { '24h': HistoryResponse; '7d': HistoryResponse }>
  gaps: GapItem[] // full /api/gaps at the default minVolume
  gapsMinVolumeUsd: number
  tokens: Record<string, TokenDetail> // every token in `pools`, key = lowercase address
  scorecards: ScorecardSummaryDto[] // /api/mm, active and inactive
  scorecardDetails: Record<string, ScorecardDetail>
  samples: Record<string, { '24h': SamplesResponse; '7d': SamplesResponse; '30d': SamplesResponse }>
  badges: Record<string, string> // SVG text per mandate id
  stocks?: StockSummary[] // /api/stocks; absent from older bundles = no stock
  stockDetails?: Record<string, StockDetail> // /api/stocks/:token, key = lowercase address
}
```

Built by `apps/cli/src/export.ts` `buildStaticBundle(db, { now, source })` **through the real
API** (`createApp(db, { now }).request(...)` for each route), so the static site shows exactly
what the server would. The two stock keys (docs/design/stocks-api.md §2) are optional so that a
bundle exported before the stock routes still parses: the static client then answers
`{ items: [] }` and 404 `stock not found`. Every export writes them (the demo's empty, since the
demo world has no stock), and `export --bundle` keeps an older bundle without them.

### CLI

- `depthwatch export --out <file>`: bundle of the configured database (`source: 'live'`).
- `depthwatch export --demo --out <file>`: runs the demo pipeline in memory, then exports it
  (`source: 'demo'`).
- `--note <text>` (export only, not empty, trimmed) sets the bundle's `note`: what the exporter
  wants a reader to know about the data (coverage, how it was read, caveats). Blank lines split
  it into paragraphs. Without the flag the key is absent, so a demo export is unchanged.
- `--updates several-times-a-day` (export only, the one value) sets the bundle's `updates`: the
  publisher replaces the copy on that schedule, which a live snapshot's site then states. The
  Refresh site workflow passes it; a copy exported once leaves it out and claims no schedule.
- Every export writes the trade switch, `DEPTHWATCH_TRADE`, as the bundle's `features.trade` and
  as `flags.json` next to the bundle (`{ "trade": … }`); `--bundle <file>` writes an exported
  bundle again with only `features` changed (docs/DEPLOY.md, "Trade switch").

### Web build modes

- Default (`vite build`): BrowserRouter and `/api`. The in-repo mock is not part of this build: it
  is used only with `VITE_MOCK=1` or by the Vite dev server when `/api/health` does not answer
  (`resolveClient` in `src/api/client.ts`; the import of `mock.js` sits behind `import.meta.env.DEV
  || VITE_MOCK === '1'`, so a production bundle has neither the client nor its JSON, and
  `src/productionBundle.test.ts` builds it to check). When the probe fails in a production build,
  `liveBoot.tsx` renders `ServiceDownState` (`components/ui/States.tsx`): the sentence "The data
  service is not answering.", what to do, and a "Try again" button that runs the probe again
  (the loading shell is skipped while it waits). Static and demo modes are unchanged.
- **Static** (`VITE_STATIC=1`, script `build:static` in apps/web, output `apps/web/dist-static`):
  `base: './'`, HashRouter, client = `createStaticClient(bundle)` loading `./data/bundle.json`
  at startup. The build ships the trade switch as `./data/flags.json` next to the bundle (it
  fails when the file is missing or differs from `features.trade`) and `public/_headers` for
  Cloudflare Pages (`plugins/securityHeaders.ts`). The static client implements the whole `ApiClient` with the API's semantics
  (pools: sort health|depth|volume|gap|tvl, dir, dex, q as core's search (a pasted pool id,
  `<dex>:<0x hex>` such as `uniswap-v3:0xd0b5…`, also with `%3A` for the `:` or as the pool's
  whole link, lists the pools on that DEX whose address or v4 pool id starts with that hex; any
  other text is search terms split on spaces, `/`, `-`, `:` and `,`, every one matching a token's
  symbol or address, the pool address or v4 pool id, or a word start in a token's name, never the
  DEX; at most 200 characters), minVolume, limit default 50 max 200, offset;
  gaps: limit/offset/minVolume; token: sort/dir/limit/offset; scorecards: pool/active; samples:
  window/limit;
  unknown ids → `ApiError` with the API's status and message). A small "Demo data — synthetic
  Base world" banner shows when `source === 'demo'`. The Embed block shows the badge preview and
  explains that embeddable URLs need a running server.
- **Live snapshot** (static build of a `source: 'live'` bundle, `snapshotOf` in
  `apps/web/src/api/static.ts`). The page is a copy of Base mainnet at one moment that never
  updates. The header says when its data was read and how old that is on the reader's own clock,
  counted again every minute and when the tab is shown again, so the age never goes stale on
  screen; the pages themselves keep absolute times (below). The snapshot time is
  `health.latestSnapshotAt` (`generatedAt` before any snapshot).
  - The demo line's slot (visual-v4.md §5.1, a 32 px line at the top of the banner) reads "Data
    from 25 Oct 2026, 08:14 UTC, 5 h ago. Updated several times a day.", its last sentence only
    when the bundle states its publisher's schedule (`updates`). Below 840 px the link reads
    "About" and the sentence "Data from 08:14 UTC, 5 h ago, updated several times a day", giving
    up the clock time below 440 px and the schedule instead below 375 px; without a schedule,
    "Data from 25 Oct, 08:14 UTC, 5 h ago", dropping the day below 360 px (both popovers keep the
    date). Should it still not fit, the text takes the ellipsis, not the link. While the bundle
    loads, an empty line of the same height holds the slot.
  - Its quiet link "About this snapshot" opens a popover with the `note` in paragraphs (or, with
    no note, "Every number was read from Base mainnet by the Depthwatch pipeline and exported to
    this static copy.") and then "Read at block 53,063,332. Exported 25 Oct 2026, 08:16 UTC."
  - Freshness shows the block with a grey dot (not the Green `ok` dot of live data), Tan once the
    data is more than 8 hours old when the bundle states a schedule (a copy exported once is
    never late); its name is "Block 53,063,332, data from 25 Oct 2026, 08:14 UTC, 5 h ago". Its
    popover lists Data from, Block, Pools tracked and Exported, with the year, then the schedule
    or, without one, "This copy keeps the data it was exported with."
  - The footer's data line reads "Data: Base mainnet snapshot".
  - Every other relative time on the pages (the Updated column and caption, Scored, price
    updated, scorecard "since …") reads as its absolute UTC time: the data clock is
    `SNAPSHOT_CLOCK` (`apps/web/src/lib/format.ts`).
  - A demo bundle keeps its frozen clock at `generatedAt` and the demo line, as before.
  - Publishing one: `depthwatch export --out apps/web/static-data/bundle.json --note "<text>"`
    over the live database (with `--updates several-times-a-day` when it is replaced on that
    schedule), then `pnpm --filter @depthwatch/web build:static`.
- Root script `build:static` = export the demo bundle to `apps/web/public-static/data/bundle.json`
  (or the path the web build reads) and run the web static build. `dist-static` and the
  generated bundle are git-ignored.

## 5. Tests

- chain: the time-varying fixture is deterministic and the scripted events happen at the
  stated times.
- cli: demo with a short history yields ≥ 3 snapshots per tracked pool and samples per mandate
  with both statuses for the AERO mandate; `export` produces a bundle whose every section is
  filled and whose numbers equal the API's responses.
- web: static client semantics (sorting, filters, paging, 404s) against a small bundle; Home and
  Methodology render; stacked-row layout at phone width; empty-history chart state; routes.
