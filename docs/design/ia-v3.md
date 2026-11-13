# Depthwatch v3 information architecture

Status: **contract for the v3 redesign**.
- It defines what each screen is for, what the reader sees first and where everything else goes.
- Visual rules (type, colour, motion, numbers, charts) are in [`principles.md`](principles.md) and are cited here by ID.
- The reasons for each change are in [`critique-v2.md`](critique-v2.md).

**Amended screens.** The v3 visual spec changes some screens in this file ([visual-v3.md §2](visual-v3.md#2-rules-this-spec-adds-to-principlesmd-and-ia-v3md)). The new wording is carried in at the screen it changes, marked "amended", and wins over the older wording beside it. The amended rules are in [`principles.md`](principles.md). The v4 visual spec ([`visual-v4.md`](visual-v4.md)) keeps every screen, its order, the disclosure ladder, the states and the URL state of this file, and changes the look; where it amends a screen it is noted here as "v4 amended" and wins. Money examples written before the `N1` change show fewer figures ($5.1M); under principles `N1` money has 3 significant figures ($5.10M).

**Two constraints hold throughout:**
1. Every v2 route keeps working.
2. Every piece of data v2 shows stays reachable somewhere. §5 maps each one.

The examples use the synthetic demo world:
- 6 pools;
- $26.1M of ±2 % depth;
- one real gap, USDC / AERO at 50.8× turnover;
- 2 mandates, one breached and one within KPI.

---

## 1. The model

### 1.1 Readers and their questions

| Reader                                                                    | Arrives with                                                                 | Answered on                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Base ecosystem lead or outside reviewer (first visit, decides in seconds) | "What is this, and is it serious?" "How deep is Base, and where is it thin?" | Home, then Gaps, then one Pool                |
| Protocol team                                                             | "Is our token's liquidity healthy? Is our market maker delivering?"          | Token, Pool, Scorecard                        |
| Market maker                                                              | "Where is depth missing (opportunity)? What does my public scorecard say?"   | Gaps, Scorecard, Pools                        |
| Anyone checking a number                                                  | "How was this computed?"                                                     | Methodology (linked from every glossary term) |

NN/g measured that about 57 % of viewing time falls above the fold, and 74 % within the first two screenfuls ([NN/g, scrolling and attention](https://www.nngroup.com/articles/scrolling-and-attention/)). The first viewport therefore carries the answer, and the second carries the next step.

### 1.2 Navigation

- **Primary navigation:**
  - The logo goes to Home.
  - Then **Pools**, **Stocks**, **Gaps**, **Scorecards** and **Methodology**, in that order (`NAV_ITEMS`; Stocks added for the tokenized stocks, [stocks-api.md §3](stocks-api.md#3-dashboard-appsweb)). Pools stays current on pool and token pages, Stocks on `/stocks/:token`.
  - On phones: a 44 px tab strip under a 52 px top bar (`PH2`); below about 425 px the five tabs scroll sideways, the trailing edge fading. No hamburger menu. The installed app's dock shows five tabs, Scorecards and Methodology as "Scores" and "Method".
- **Entity links (the graph):**

  ```
  Home ── butterfly rows ─────────────► Pool ◄──── Pools rows, Gaps rows, Token butterfly
   │                                     │ ▲
   ├── gaps preview ──────────► Gaps ────┘ │ pair tokens ──► Token ── its pools ──┘
   └── scorecards preview ───► Scorecards ──► Scorecard ── mandated pool ──► Pool
                                               ▲
                Pool "Mandates on this pool" ──┘
  Every glossary term (D8) ──► Methodology#anchor
  ```

- **Rows are links.** Every row, bar row and pool cell is one link to its entity (`TB3`). Token symbols in a pool title link to the token page, shown as `text-1` with an underline on hover, not in link blue.

### 1.3 Page anatomy (every screen uses this skeleton, `D2`)

1. **Chrome:** the demo line (demo data only), then the header (§3).
2. **Title block:**
   - an h1 (`--t-h1`);
   - optionally one secondary line in `text-2`, `--t-data` (DEX and fee, the market maker, the token name).
3. **Answer sentence:**
   - Home uses `--t-display`.
   - Other pages use the `--t-h2` size at weight 400.
   - It holds the screen's key number (`P3`).
4. **Focal element:** the one visual (§4 per screen).
5. **Facts row:** 3–5 facts, value first, label second (`D3`).
6. **Sections:** in a fixed order. Each has one visual, one takeaway sentence and an optional "Details" disclosure (`D4`).
7. **About:** a definition list of identifiers and metadata, in mono for on-chain ids.

### 1.4 Disclosure ladder (at most two levels, `P5`)

| Level  | What lives there                                                                  | How it is reached                                                                                                   |
| ------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **L0** | Answer sentence plus focal element                                                | Visible on arrival                                                                                                  |
| **L1** | Facts row and section visuals with their takeaways                                | Visible on scroll                                                                                                   |
| **L2** | The numbers behind a visual: tables, components, token amounts, secondary series  | "Details" or "Show data" disclosure in the section; hover or focus tooltips; "Columns" menu; List/Table view switch |
| **L3** | Raw rows and identifiers: samples, block numbers, addresses, formulas, embed code | "About" list at the page end; "Show formula"; "Show samples"; Methodology                                           |

**Mechanism choice (`P6`):**
- A segmented control switches parallel views: time window, List/Table, chart side.
- A disclosure reveals detail.
- A tooltip only repeats or enlarges.
- "Show all N" extends a list.

### 1.5 Budgets per screen

| Screen           | Focal element                                    |                                                       First-viewport data numbers (`P2`) | Phone length (`P9`) |
| ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------: | ------------------: |
| Home             | Depth butterfly of Base's pools                  |                                                                                      ≤ 7 |             ≤ 2,100 |
| Pools            | Ranked pools table                               | header ≤ 3; each row has the 4 default numeric columns, because the table is the content |  ≤ 1,600 for 6 rows |
| Pool detail      | Mirrored depth curve                             |                                                                                      ≤ 8 |             ≤ 2,600 |
| Gaps             | Ranked gap rows with turnover bars               |                                                               header ≤ 3, plus 2 per row |             ≤ 1,600 |
| Scorecards list  | Mandate rows with 7 d uptime bullets             |                                                               header ≤ 3, plus 2 per row |             ≤ 1,600 |
| Scorecard detail | Market-maker depth per side against the KPI line |                                                                                      ≤ 7 |             ≤ 2,600 |
| Token            | Depth butterfly of the token's pools             |                                                                                      ≤ 6 |             ≤ 1,600 |
| Methodology      | Metric index                                     |                                                                       0 outside formulas |              exempt |

v4 amended ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the page lengths of [visual-v4.md §6.1](visual-v4.md#61-budgets) replace the `P9` column, and the first-viewport counts of §6.1 the `P2` column. Every page but Not found opens on a flat Base Blue band that carries its focal element (Pools: the square field and the DEX filter, whose five shares are labels exempt from `P2`; Scorecard: the KPI chart of the latest sample).

---

## 2. Routes and URL state

Every v2 route and query parameter keeps its meaning. New parameters are additive and optional, and defaults reproduce the clean first view. The static build keeps the hash router (`#/pools?sort=depth`).

| Route              | v2 parameters (kept)                                                                     | New in v3                                                                                                                             | Notes                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `/`                | —                                                                                        | —                                                                                                                                     | Home                                                    |
| `/pools`           | `q`, `sort` (`health,depth,volume,gap,tvl`), `dir`, `dex`                                | `cols` (comma list of optional columns), `page`, `rated` (`1` leaves the unrated pools out), `unrated` (pages of unrated pools shown) | DEX tiles become a filter control. `dex` still filters. |
| `/pools/:id`       | —                                                                                        | `window` (`24h` default, `7d`) for the "Over time" section                                                                            | The id stays URL-encoded `dex:address`.                 |
| `/gaps`            | —                                                                                        | `view` (`list` default, `table`)                                                                                                      |                                                         |
| `/tokens/:address` | — (v2 kept its sort in local state)                                                      | `sort`, `dir`                                                                                                                         | Same semantics as Pools.                                |
| `/stocks`          | —                                                                                        | —                                                                                                                                     | Tokenized stocks (stocks-api.md §3)                     |
| `/stocks/:token`   | —                                                                                        | —                                                                                                                                     | One stock by its lowercase address                      |
| `/mm`              | `active` (`true`/`false`)                                                                | `view` (`list` default, `table`)                                                                                                      |                                                         |
| `/mm/:id`          | — (v2 kept its window in local state)                                                    | `window` (`24h`, `7d` default, `30d`)                                                                                                 |                                                         |
| `/methodology`     | `#depth`, `#spread`, `#concentration`, `#persistence`, `#health`, `#gaps`, `#scorecards` | `#index`                                                                                                                              | Every anchor kept.                                      |
| `*`                | —                                                                                        | —                                                                                                                                     | Not found (§3.5)                                        |

---

## 3. Global chrome

### 3.1 Demo notice (only when `HealthResponse.source === 'demo'`, or in mock mode)

- It is one line, 28 px tall, in `well`, 12–13 px `text-2`, and never wraps.
- Text: **"Demo data: a synthetic week of Base"**, followed by a quiet link, **"About the demo"**. The link opens a popover that holds v2's full sentence, "Every number comes from the real pipeline run over a simulated week."
- It replaces the em-dash banner (tell 5).
- The word "demo" or "synthetic" appears nowhere else in the chrome. The footer's "Data:" line names the source once (`D7`).
- In mock mode it reads "In-repo mock data" (v2 `MockBadge`).

### 3.2 Header

- **Desktop, 56 px:**
  - left: the wordmark;
  - then the nav;
  - right: **freshness**, a 6 px status dot plus "Updated 2 min ago" in `text-3`.
- **The freshness item** is a button. Its popover (and title) shows:
  - "Block 52,950,000";
  - "6 of 6 pools tracked";
  - the full UTC time.
- **When the API is unreachable**, the dot turns to the `bad` triangle with "Offline". The popover shows the error and a "Retry" button (`ST7`).
- **Phones:**
  - a 52 px bar with the mark and the freshness dot (a 44 px button). There is no theme toggle: the app follows the system appearance, as v2 does;
  - then the 44 px tab strip.
- **The block number and "updated" time swap with no animation** (`M8`).

### 3.3 Footer

Three short groups, no middle dots:
1. The wordmark and "Open source and read-only. No token, no custody."
2. Links: Methodology, API, GitHub (`github.com/0xdeni/depthwatch`).
3. "Data: synthetic demo world", "Data: Base mainnet" or "Data: in-repo mock".

### 3.4 Loading and errors (all pages)

- **Loading.** Skeletons mirror each page's anatomy (`ST1`, `M10`). The title block renders as soon as the route resolves.
- **Section failures** stay inside the section: "Unable to load history. Retry". The page stays usable.

### 3.5 Not found (`*`, plus pool, token and scorecard 404s)

- The h1 states what was not found ("Pool not found").
- One sentence follows ("Depthwatch does not track this pool, or the link is wrong.").
- The requested id is shown in mono.
- Two links (for a pool: "Browse pools", "See liquidity gaps").
- This is the same content as v2's `notFound` props, with the same tone rules.

---

## 4. Screens

### 4.1 Home (`/`)

**Job.** Make a striking, calm first impression and answer, in one glance, "how deep is liquidity on Base, and where is it thin?" Then hand the reader to one next step.

**Focal element: the depth butterfly of Base's pools (`CH4`).**
- One row per pool:
  - sell side in blue to the left of a centre spine;
  - buy side in orange to the right;
  - the pair name in the centre column.
- All rows share one linear scale, sorted by ±2 % depth.
- At most 8 rows: the 7 deepest, plus the highest gap-score pool if it is not among them.
- The gap pool shows as a sliver next to the large pools. That sliver tells the "where are market makers missing" story without words. It carries a quiet `text-2` "Gap" marker that links to `/gaps`.
- Labels (amended; it was "exactly two direct value labels, on the deepest row ($5.1M and $6.1M); every other row shows its values on hover or focus"):
  - "Exactly two direct value labels, on the total row ($11.8M and $14.3M, which sum to the H1)". The total row is the "All of Base" row that closes the butterfly (principles `CH4`); pool rows show their values on hover, focus or tap (the lens).
  - "A 'Show data' disclosure follows the figure."
  - The first-viewport count is unchanged at 7: H1 1, lead pool count 1, total labels 2, facts 3.
- The first-visit grow-from-spine animation is the product's one orchestrated moment (`M6`).
- v4 amended ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the butterfly sits on the band, the sell side white on Blue and the buy side Yellow; the total row draws the 7 deepest pools as segments with a hatched rest, and a bracket states the deepest pool's share. The first view plays on whichever route a session lands on, not only Home (`M6`).

**Answer and facts (L0–L1). 7 data numbers in total (`P2`):**
- **H1, display:** "$26.1M sits within 2 % of the price on Base."
- **Lead, `text-2`, 18 px:** "Depthwatch measures what it costs to move each of 6 Uniswap and Aerodrome pools, and grades them A to F." When some pools are too thin to rate: "…each of 492 Uniswap and Aerodrome pools, and grades the 50 deep enough to rate A to F."
- **Actions:**
  - one primary button, **"Browse pools"**;
  - one quiet link, **"How it's measured"**.
- **Facts row (3):**

  | Value               | Label                                                                  |
  | ------------------- | ---------------------------------------------------------------------- |
  | $28.2M              | traded in 24 h                                                         |
  | 82 plus the A glyph | median health across 105 rated pools (rated pools only; "—" with none) |
  | 51×                 | USDC / AERO, the biggest gap                                           |

**Above the fold:**

```
desktop 1440×900                                                         phone 390×844
┌ Demo data: a synthetic week of Base   About the demo ───────────┐ 28    Demo data: a synthetic week of Base  About  28
│ ▮▮ Depthwatch   Pools  Gaps  Scorecards  Methodology   ● 2 min ago │ 56   ▮▮ Depthwatch               ●  52
                                                                  (48)    Pools  Gaps  Scorecards  Methodology 44
  $26.1M sits within 2 % of the                          display 56       $26.1M sits within            36 px
  price on Base.                                                          2 % of the price
  Depthwatch measures what it costs to move each of 6    lead 18          on Base.
  Uniswap and Aerodrome pools, and grades them A to F.                    Sell side          Buy side   12 px
  [ Browse pools ]   How it's measured                                    WETH / USDC
                                                                  (40)       █████████│███████████     52 px rows
        Sell side, price down     │     Buy side, price up      12 px      WETH / USDC
   $5.1M ███████████  WETH / USDC  ████████████ $6.1M           36 px rows       ████│█████
              █████   WETH / USDC  ██████                                 … (≤ 8 rows)
               ████    ETH / USDC  ████                                   (the lead, 3 lines)           lead 16
               ████  USDC / cbBTC  ████                                   [ Browse pools ]              44 px
                  █  USDC / USDbC  █                                      How it's measured
                  ▏   USDC / AERO  ▏  Gap                                 ───── fold ─────
                                                                  (32)    $28.2M   traded in 24 h
  $28.2M              82 ● A              51×                    kpi 40   82 ● A   median health
  traded in 24 h      median health       USDC / AERO, the biggest gap    51×      USDC / AERO, the biggest gap
```

On phones the butterfly comes straight after the H1, and the lead and actions follow it (`PH6`).

As amended, the sketch's two labels sit on the "All of Base" total row under the pool rows rather than on the deepest row, and "Show data" follows the figure.

**Below the fold (L1), in order:**
1. **"Where liquidity is thin"** (the gaps preview).
   - Takeaway: "1 pool trades 3× its depth or more every day." With none: "No pool trades 3× its depth today."
   - At most 3 rows of pools with a **meaningful gap**: turnover of 3× or more, which is a gap score of 24 or more. The same threshold is used on every screen. Each row shows:
     - the pool cell (pair, then "Aerodrome v2, 0.3 %" in `text-2`);
     - "Trades 51× its depth a day";
     - a 64 px gap-score bar with its number.
   - With fewer than 3 such pools, show only those, then one quiet line, "Every other pool trades less than 3× its depth".
   - Link: "See all gaps".
2. **"Market makers on the record"** (the scorecards preview).
   - Takeaway: "1 of 2 mandates is within its KPIs right now."
   - At most 3 rows. Each row shows:
     - the mandate name;
     - "Alice Markets (synthetic) on USDC / AERO" in `text-2`;
     - the status word with its shape (no fill);
     - the 7 d uptime value with a bullet bar against the target tick.
   - Link: "See all scorecards".

Then the footer. There is no "What we measure" section: Methodology's metric index carries that content, and the hero's "How it's measured" link leads there.

**What moves behind disclosure, or out of Home:**

| v2 on Home                                             | v3                                                                                       |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Slogan H1, "We measure…" lead, audience note           | Replaced by the answer sentence and a one-sentence lead (`CP5`). The audience note goes. |
| Board: pools scored (of tracked)                       | Count in the lead ("each of 6"). Tracked-of-total moves to the freshness popover.        |
| Board: depth ±2 %, 24 h volume, median health          | H1 and the facts row. Captions go, and the definitions become glossary tooltips.         |
| Gaps table, 5 rows × 6 numbers                         | ≤ 3 real gaps, 2 numbers each. The full feed is on `/gaps`.                              |
| Scorecard cards (KPI, now, 7 d uptime, barcode, badge) | One row each: status plus 7 d uptime bullet. Everything else is on `/mm/:id`.            |
| "What we measure" cards                                | Methodology's metric index (§4.8)                                                        |
| Section dividers                                       | Removed. Space separates sections (`S2`: 64–96 px on Home).                              |

**States:**
- **No scored pools:**
  - H1 "No pools are scored yet."
  - Lead: "6 pools discovered. Scores appear after the first snapshot."
  - The butterfly is replaced by a static outline of the spine, and there is no fake data.
- **One pool:** a butterfly of one row, no "Show all".
- **Live mainnet with hundreds of pools:** 8 rows plus "Show all 312 pools", which links to `/pools?sort=depth`.
- **No meaningful gap:**
  - The butterfly has no "Gap" marker.
  - The third fact becomes the highest turnover, e.g. "1.6×" with the label "ETH / USDC, the highest turnover".
  - The gaps section shrinks to its takeaway and the link.
- **No mandates:** the scorecards section shrinks to one line, "No market-maker mandates registered yet. How scorecards work", with no empty box.

**Data:** `useStats` (totals), `usePools({sort:'depth', limit: 8})`, `useGaps({limit: 3})` and `useScorecards()`. Per-side depth: see §6.1.

---

### 4.2 Pools (`/pools`)

**Job.** Find any pool and compare it with its peers.

**Focal element: the ranked pools table.** This is the one screen where a table is the answer (`TB1`).

**Answer and facts:**
- **H1:** "Pools".
- **Answer (`--t-h2`, 400):** "6 pools on 4 DEXes hold $26.1M within 2 % of the price." It updates with the DEX filter: "Aerodrome Slipstream: 1 pool, $11.2M within 2 % of the price, median health 88 (A)."
- No separate facts row: the table is the facts.

**Controls (one row, above the table):**
- **Search:** 280–360 px wide, not full width. Placeholder "Search by symbol or address". Stored in `q`.
- **DEX filter:**
  - Desktop: a segmented control with All, Uniswap v3, Uniswap v4, Aerodrome v2 and Aerodrome Slipstream (`dex`).
  - Phone: a "Filter" button that opens a sheet.
- **Sort:**
  - Desktop: header clicks.
  - Phone: a "Sort" button that opens a sheet. This replaces v2's native `<select>`.
- **Rating:**
  - Desktop: a segmented control with "All pools" and "Rated only" (`rated=1`), after the DEX filter.
  - Phone: the same two options in the Filter sheet.
- **"Columns" menu:** checkboxes for the optional columns (`cols`).

**Default columns (desktop, `TB2`):**

| Column         | Content                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------- |
| Pool           | Pair in `text-1` 500, then "Aerodrome Slipstream, 0.05 %" (and "stable pair" when true) in `text-2` |
| Health         | Grade glyph plus truncated score (`N6`); "Not rated" chip, no score, for a pool with no grade       |
| Depth ±2 %     | Value plus an 80×20 butterfly glyph on the table's shared scale                                     |
| Spread at $10K | bps                                                                                                 |
| 24 h volume    | USD                                                                                                 |

**Optional columns (Columns menu):** TVL, gap score, top LP share, price, updated. When every row has the same updated value, it becomes the caption "All pools updated 2 min ago" (`TB6`).

**Phone:** rows of 52 px or more, each with the pool cell, the value of the current sort metric (labelled once in the sort button) and the grade glyph, or the "Not rated" chip (`TB7`).

**Below the table:**
- **"Show more"** (pages of 50, `page`).
- **"Show 442 unrated pools"** (once every rated pool is on screen, unless "Rated only" is on): one toggle button that adds the unrated pools under an "Unrated pools" heading row (`unrated`, pages of 50) and, once open, reads "Hide unrated pools" (`aria-expanded`). It stays where it is and keeps focus; "Show 50 more unrated pools" sits beside it. The caption counts them: "15 rated pools, plus 50 of 442 unrated".
- **"Compare DEXes"** (a disclosure, L2): a 7-column table with, per DEX:
  - DEX;
  - pools scored;
  - tracked;
  - discovered;
  - depth ±2 %;
  - 24 h volume;
  - median health.

  It also has an "All DEXes" totals row. This is where every `StatsResponse.byDex` field lives, including 24 h volume per DEX, which v2 never showed.

**Removed from Pools:**
- the five DEX tiles (now the filter plus Compare DEXes);
- the duplicate gaps table (gap score is an optional column and sort, and `/gaps` holds the feed);
- the "Top pools" heading;
- the DEX and "stable" chips.

**States:**
- **No results:** "No pools match "xyz"." followed by a "Clear search" button.
- **Loading:** a skeleton of 6 rows.
- **Refetching:** keep the rows, dim them, and show the 2 px bar (`M10`).

**Data:** `usePools`, `useStats`.

---

### 4.3 Pool detail (`/pools/:id`)

**Job.** Answer "Is this pool deep and healthy enough, and on which side is it thin?" in one look, then show why.

**Focal element: the mirrored depth curve (`CH3`).**
- Sell side to the left of mid, buy side to the right.
- Measured points at ±1, 2 and 5 % on a log-spaced axis.
- The ±2 % band shaded.
- Direct labels at ±2 % only.
- A dot texture behind it.
- 340 px tall on desktop, 240 px on phones.
- The tooltip on each point shows:
  - the % move;
  - USD;
  - the token amount (v2's permanent second label);
  - "reached" or "liquidity runs out".
- "Show data" (L2) opens the 3×2 table of USD and token amounts per level and side.

**Title block and answer:**
- **H1:** "WETH / USDC". The token symbols link to their token pages.
- **Secondary line:**
  - "Aerodrome Slipstream, 0.05 % fee", then "1 WETH = 2,460.32 USDC";
  - a text toggle, "Show price in WETH", flips to the inverse (`N2`): words, not the ⇄ glyph,
    so nothing beside the price reads as a swap button;
  - where the swap panel is on for the pool, a small primary "Swap" button that brings "trade in
    this pool" into view, opens it and moves focus into it.
- **Answer:** "It takes $6.1M of buying to lift WETH 2 % and $5.1M of selling to push it down."
- **Variants:**
  - **Unpriced side:** "The buy side is unknown: USDC has no USD price."
  - **Exhausted side:** "Liquidity runs out before a 2 % move: $812K empties the buy side."

**Facts row (4):**

| Value                          | Label          |
| ------------------------------ | -------------- |
| 88, A glyph, 80×4 weighted bar | health         |
| 10.4 bps                       | spread at $10K |
| $9.8M                          | traded in 24 h |
| $85.3M                         | TVL            |
- **Gap callout.** When the pool has a meaningful gap (turnover ≥ 3×), a fifth item appears as a quiet sentence: "Liquidity gap: trades 51× its depth daily". It links to `/gaps`.
- **Count:** price 1, answer 2, facts 4, callout 1, for at most 8 (`P2`). The two ±2 % chart labels repeat the answer's numbers.

**Above the fold:**

```
desktop 1440×900
  WETH / USDC                                                             h1
  Aerodrome Slipstream, 0.05 % fee  1 WETH = 2,460.32 USDC  Show price in WETH  text-2
  It takes $6.1M of buying to lift WETH 2 % and $5.1M of selling         answer, h2 size, 400
  to push it down.
  ┌──────────────── mirrored depth curve, 340 px, dot texture, no box ────────────────┐
  │ sell (blue area) ◄  −5 %   −2 %  −1 %   │mid│   +1 %  +2 %   +5 %  ► buy (orange) │
  │                         $5.1M ● ░░░░░░ ±2 % band ░░░░░░ ● $6.1M                    │
  └─────────────────────────────────────────────────────────────────────────────────────┘
  88 ● A ▮▮▮▮▮▮▮▮▮▯▯   10.4 bps           $9.8M              $85.3M          kpi 28–40, 400
  health               spread at $10K     traded in 24 h     TVL             13 px text-2
```

On phones the order is: title block, answer, curve (240 px), then the facts as a 2×2 grid without uppercase labels.

v4 amended ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the curve sits on the band in flat white (sell) and Yellow (buy) areas with ringed square points and its two ±2 % labels above the plot; the facts are one ink block over the band's lower edge; an eyebrow (mono caps, the one exception to `T11`) names the DEX and fee above the title.

**Sections (L1), in order.** Each section is a heading, one visual, one takeaway, and "Details" (L2).
1. **Health.**
   - Visual (amended, without the repeated score): "the weighted bar with component names and weights", the 35/25/20/20 bar at 8 px with each component's name and weight under its segment. The score and grade glyph stay in the facts row. (It was the bar with the score at `--t-kpi`, the grade glyph and the component names.)
   - Takeaway: names the weakest component, e.g. "Concentration is the weak part: one LP holds 53 %."
   - The API's `score.notes` show as one muted line ("Persistence neutral: fewer than 3 samples").
   - Details: components as `score / max` with 1 decimal, plus the 1-decimal total.
   - A link to `Methodology#health`.
2. **Cost to trade.**
   - Visual: a 3-point dot plot of effective spread at $1K, $10K and $100K, in bps on a shared axis, with each point labelled directly.
   - Takeaway: "A $100K round trip costs 13.8 bps."
   - An infeasible notional shows as a hollow point labelled "Not fillable".
   - Details: notional, spread, buy average and sell average.
3. **Who provides it.**
   - Visual: one 100 % bar split into top LP, the next two LPs and everyone else (from `top1Share` and `top3Share`), plus "4 owners in band" as text.
   - Takeaway: "One LP holds 53 % of the liquidity near the price."
   - When owners are not indexed, the takeaway uses the range: "21 % of the liquidity sits in the active range".
   - Details: band ±5 %, range HHI, active range share, owner HHI and owners in band, with HHI explained in a glossary tooltip.
4. **Over time.**
   - Visual: small multiples sharing the x axis, with a 24 h / 7 d segmented control (`window`):
     - depth ±2 %, 160 px, with the 7 d persistence p10–median band shaded behind it;
     - spread at $10K, 120 px.

     No dual axes.
   - Takeaway, from persistence: "Depth stayed above half its median in 100 % of 84 snapshots."
   - Details:
     - the persistence table: window, samples, median, p10, min, stability and uptime, for 24 h and 7 d;
     - a series picker that adds health, TVL and price as further small multiples (`HistoryPoint` already carries them).
5. **Mandates on this pool.** Shown only when `useScorecards({pool: id})` returns items. One row per mandate in the Scorecards-list style. Not in v2; it is a new cross-link.
6. **About this pool** (L3, definition list):
   - DEX and kind;
   - fee;
   - tick spacing;
   - "Stable pair" (Aerodrome v2);
   - hooks (v4, mono with Basescan);
   - contract address or v4 pool id (mono, copy button, Basescan link for addresses);
   - token0 and token1 (links);
   - tracked status ("Not tracked: discovered but not snapshotted");
   - created at block;
   - latest snapshot (relative time plus block, mono);
   - scored time;
   - the USD prices used for each token.

**Moved from the v2 pool page:**

| v2                                    | v3                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8 header stats                        | Price in the secondary line. A toggle inverts. TVL, spread, volume and health in the facts row. Depth in the answer. Gap score as a conditional callout, otherwise in About. |
| 7-fragment meta line                  | DEX and fee in the secondary line. Everything else in About.                                                                                                                 |
| Depth ladder with 12 permanent labels | Curve with 2 labels. Token amounts in the tooltip and "Show data".                                                                                                           |
| Equal 2×2 panel grid                  | Ordered sections, one visual each, no boxes                                                                                                                                  |
| Dual-axis history chart               | Small multiples                                                                                                                                                              |

**States:**
- **Unscored pool:** show the title block, "Not scored yet", the curve if a snapshot exists, and About.
- **No snapshot:** "No snapshot yet. Depth appears after the first snapshot."

**Data:** `usePool`, `usePoolHistory(id, window)`, `useScorecards({pool})`.

---

### 4.4 Gaps (`/gaps`)

**Job.** Show where demand outruns depth: the pools where market makers are missing.

**Focal element: ranked gap rows.** Each row's turnover bar sits on a shared log scale from 1× to 100×, which is the gap score from 0 to 100. Rows with a meaningful gap (turnover ≥ 3×, gap score ≥ 24) are drawn in `text-1`, with ink bars at full size. The rest collapse into one line, "Show 5 more pools that trade less than 3× their depth" (L2, expands in place).

**Answer and facts:**
- **H1:** "Liquidity gaps".
- **Answer:** "1 pool trades 3× its depth or more every day." With no meaningful gap: "No pool trades 3× its depth today." The threshold is the meaningful-gap rule (`TB9`).
- **One-sentence lead (`text-2`):** "A gap is a pool that trades far more each day than the liquidity near its price."
- **Caption on the list:** "Pools with at least $10K of 24 h volume" (the floor from `GapsResponse.minVolumeUsd`).
- The scoring formula moves to `Methodology#gaps`, behind a "How the score works" link.

**List row (`view=list`, the default):**
- rank;
- pool cell;
- sentence: "Trades 51× its depth a day";
- bar and gap score.

Two numbers per row. Volume and depth show on hover or focus as "$1.6M traded through $31.5K of depth".

**Table view (`view=table`, L2):** the full v2 columns:
- pool;
- 24 h volume;
- depth ±2 %;
- turnover;
- gap score;
- health;
- TVL.

All are sortable, with a sticky header.

**Phone:** rows show the pool cell, then "51×", then the score. The table view scrolls inside its wrapper with a sticky first column.

**Removed:** the 3-line formula lead, and health chips as a default column (health is in the table view).

**Data:** every page of `useGaps({limit: 200})` (`lib/useGapFeed.ts`); the answer counts the API's `meaningful`, over the whole feed.

---

### 4.5 Scorecards list (`/mm`)

**Job.** Show which market makers are meeting their mandates.

**Focal element: mandate rows.** Each row shows:
- the status word with its shape in the status colour (`C4`), with **no fill**. A filled status chip appears only on the scorecard's own page (`K5`), so a list of mandates never turns into a wall of red;
- the mandate name in `text-1` 500;
- "Alice Markets (synthetic) on USDC / AERO, Aerodrome v2" in `text-2`;
- the 7 d uptime value with a bullet bar and a target tick at 95 %;
- on desktop, when there are 10 mandates or fewer, a 7 d uptime strip with only breaches coloured (`CH8`).

**Answer and facts:**
- **H1:** "Market-maker scorecards".
- **Answer:** "1 of 2 mandates is within its KPIs right now."
- **Lead (one sentence):** "A scorecard checks the depth a market maker promised against what is on chain at every snapshot."
- The v2 lead's attribution and sample mechanics move to `Methodology#scorecards`.

**Controls:**
- **Filter:** All, Active, Inactive (`active`, unchanged).
- **View:** List or Table (`view`).

**Table view (L2):** every v2 column:
- scorecard and market maker;
- pool;
- status;
- uptime 24 h, 7 d and 30 d;
- market-maker depth up and down against the KPI;
- spread against the KPI, or "No KPI";
- last sample.

**Empty:** "No market-maker mandates registered yet. Mandates are added with `depthwatch mm add` or `POST /api/mm`. How scorecards work" (`ST2`).

**Data:** `useScorecards({active})` and `usePoolMetas` for pool cells. The strips need `useScorecardSamples(id, '7d')` per row (§6.3).

---

### 4.6 Scorecard detail (`/mm/:id`)

**Job.** Say whether this market maker is meeting its mandate right now, and how reliably over the window.

**Focal element: market-maker depth per side against the KPI.**
- A time series (default 7 d):
  - sell-side and buy-side market-maker depth as 2 px lines in `sell` and `buy`;
  - the KPI as a 1 px dashed `text-2` reference line labelled "KPI $50K per side";
  - breach episodes as `bad` bands at 12 % opacity. Under principles `CH7` as amended, the bands use `--bad-mark` at `--band-op` opacity instead.
- 24 h, 7 d and 30 d segmented control (`window`).
- Whole-pool depth is a toggle, "Show whole-pool depth", drawn as 1 px `text-3` context lines.
- Scrubbing rewrites the facts with that sample's values and time (`CH2`).
- "Show data" follows the focal chart: per sample for 24 h, per UTC day for 7 d and 30 d (amended).

**Title block and answer:**
- **H1:** the mandate name (data, kept verbatim).
- **Secondary line:** "Alice Markets (synthetic) on USDC / AERO, Aerodrome v2, 0.3 %". The pool links to its page.
- **Status chip** beside the h1: the only filled element on the page. On phones the status chip sits at the start of the meta line (amended).
- **Answer:**
  - "Breached for 8 consecutive samples, since 14 h ago."
  - "Within KPI for 29 consecutive samples, since 2 d ago."
  - For inactive mandates: "Inactive since …".
  - With no data: "No samples yet."

**Facts row (3).** There are at most 7 data numbers in the first viewport:
- the answer's streak length and time (2);
- the three facts (3);
- the two targets, the $50K KPI and the 95 % target uptime (2).

| Value                                           | Label (amended)                    |
| ----------------------------------------------- | ---------------------------------- |
| $7.8K and a bullet graph against the $50K tick  | sell side now, below the $50K KPI  |
| $7.7K and a bullet graph                        | buy side now, within the $50K KPI  |
| 42.9 % and a bullet graph against the 95 % tick | uptime, 7 d, below the 95 % target |
- The fact labels are "sell side now, below the $50K KPI", "buy side now, within the $50K KPI" and "uptime, 7 d, below the 95 % target" (amended; they were "sell side now (depth down)", "buy side now (depth up)" and "uptime, 7 d"). Each label states its comparison; the word follows the state ("below" when breached, "within" when met), and a breached value carries the triangle marker.
- The streak is not repeated as a fact, because the answer sentence carries it.
- If `maxSpreadBps` is set, a fourth fact appears, "Spread now, against KPI". The answer then drops its "since …" clause to stay within budget.

**Sections (L1), in order:**
1. **Uptime.**
   - Visual (amended, without the readout): "the strip for the selected window; the takeaway carries the counts". One cell per sample, with breaches coloured and within-KPI cells neutral. (A 24 h / 7 d / 30 d readout showing one value at a time is gone.)
   - Takeaway: "36 of 84 samples within KPI over 7 days (target 95 %)."
   - Details: all three windows as samples, within KPI and uptime. Unpriced samples are counted separately.
2. **Breaches.**
   - Visual: an **episode list**. Consecutive breached samples collapse into one row: start, duration, number of samples, sides breached as words ("both sides" or "sell side"), and the worst value.
   - The 5 newest are shown, then "Show all N".
   - Takeaway: "6 breach episodes in 7 days, the longest 14 h."
   - Details: "Show samples", the raw per-sample table of v2: time, sides, depth up, depth down, spread and block (mono, grouped).
3. **Worst moments (30 d).** Two or three lines, such as "Lowest buy-side depth: $7.3K, 4 d ago (KPI $50K)". The block number shows on hover and in Details.
4. **Spread.**
   - With a spread KPI, it is a chart with a KPI line.
   - Without one, it collapses to "No spread KPI. Show measured spread" (L2), which reveals the market-maker spread and whole-pool spread series.
5. **Embed badge.**
   - Badge preview (the shields pattern from v2).
   - Two buttons, "Copy HTML" and "Copy Markdown", with an inline "Copied" confirmation (`K8`).
   - "Show code" (L2) reveals both snippets and the badge URL.
   - The caching note ("Cached for 5 minutes") is one `text-3` line.
6. **Mandate** (L3, definition list):
   - market maker;
   - pool (link);
   - addresses (mono, Basescan links, copy);
   - KPIs: minimum depth per side, band, maximum spread, spread notional, target uptime;
   - attribution method and holdings ("LP share, 1 holder");
   - share of in-band liquidity;
   - whole-pool depth up and down at the latest sample;
   - alerts after N samples;
   - webhook on or off;
   - registered;
   - latest sample (time and block);
   - active;
   - notes.

**Removed or merged from v2:**

| v2                                        | v3                                 |
| ----------------------------------------- | ---------------------------------- |
| 3 KPI cards with red borders and ✕ icons  | Facts-row bullets                  |
| 3 uptime tiles                            | The Uptime takeaway and Details    |
| The up/down split barcode                 | One strip                          |
| 12-row breach table with 24 chips         | Episodes, with raw rows in Details |
| Excursions table                          | "Worst moments" lines              |
| Header 4-stat strip                       | Facts and the Mandate list         |
| The purple spread chart shown with no KPI | Collapsed                          |
| Embed code blocks always visible          | Behind "Show code"                 |

**Data:** `useScorecard`, `useScorecardSamples(id, window)` and `useBadge`. Episodes are derived on the client (§6.2).

---

### 4.7 Token (`/tokens/:address`)

**Job.** Show how liquid this token is on Base, where its liquidity sits, and where its price comes from.

**Focal element: the depth butterfly of the token's pools.** The same component as Home, filtered to pools that contain the token, on its own shared scale, at most 8 rows.

**Title block and answer:**
- **H1:** "WETH", with the secondary line "Wrapped Ether".
- **Answer:** "$16.5M sits within 2 % of the price across WETH's 2 scored pools." (the API's `depth2UsdTotal` over `total` scored pools)
- **Unpriced token:** "WETH has no USD price yet, so depth is shown in pool terms only."

**Facts row (3).** There are at most 6 data numbers in the first viewport:
- the answer (2);
- price and pools discovered (2);
- the butterfly's two value labels (2). Under principles `CH4` they sit on the total row, "All of WETH", not on the deepest row.

| Value                               | Label                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| $2,460.32                           | USD price                                                                                                                      |
| 2                                   | pools discovered. When fewer are scored than discovered, the label adds the scored count, e.g. "5 pools discovered, 2 scored". |
| "WETH / USDC, Aerodrome Slipstream" | priced through (the `via` route as words, steps joined by "then")                                                              |

For an anchor token the third label reads "Anchor".

**Sections:**
1. **Pools** (L1): the Pools table component with the same default columns, sort in the URL (`sort`, `dir`) and the Columns menu.
2. **About this token** (L3):
   - address (mono, copy, Basescan);
   - decimals;
   - price updated;
   - the full price route, with each step a link and `wrap:weth` shown as "ETH to WETH".

**Removed:** the 9-column default table, and "18 decimals" in the header meta.

**Sparse state:** a token with one pool shows one butterfly row, and the page is short by design.

**Data:** `useToken(address, {sort, dir, limit: 200})` and `usePoolMetas(via)`.

---

### 4.8 Methodology (`/methodology`)

**Job.** Let anyone verify how every number is made.

**Focal element: the metric index.** Directly under the h1, a definition list of the seven metrics. Each is one line with a plain definition and links to its section:

| Metric        | Definition                                                                   |
| ------------- | ---------------------------------------------------------------------------- |
| Depth         | Dollars it takes to move the price 1, 2 or 5 %, on each side.                |
| Spread        | What a round trip of $1K, $10K or $100K costs, fees included.                |
| Concentration | How much of the liquidity near the price one LP or one range holds.          |
| Persistence   | Whether the depth is still there from one snapshot to the next.              |
| Health        | One score from 0 to 100, and a grade from A to F, built from the four above. |
| Gaps          | Pools that trade far more each day than the liquidity near their price.      |
| Scorecards    | A market maker's promised depth, checked at every snapshot.                  |

This absorbs v2's "What we measure" cards from Home.

**Answer:** "Every number comes from public pool state, using each contract's own swap math, and can be reproduced from the repository."

**Sections:** `#depth`, `#spread`, `#concentration`, `#persistence`, `#health`, `#gaps`, `#scorecards`, unchanged. Each holds:
1. A plain explanation of at most 150 words, keeping v2's text.
2. One small figure where it explains faster than prose:
   - depth: a mirrored-curve schematic;
   - persistence: a sparkline with the p10–median band;
   - health: the weighted 35/25/20/20 bar and the grade bands with their shapes, replacing the coloured chip row;
   - gaps: the 1× / 10× / 100× to 0 / 50 / 100 scale;
   - scorecards: a KPI line with a breach band.
3. **"Show formula"** (L2): v2's mono formula block, collapsed by default.

**Navigation:**
- **Desktop (≥ 1200 px):** a sticky table of contents on the left, headed "On this page" in sentence case, with the current section in `text-1`.
- **Phones:** an "On this page" disclosure under the lead.
- An optional 2 px reading-progress bar under the header (motion §11).

**End:** "Reproduce any number" in one paragraph, with links to `docs/METRICS.md`, `docs/SCORECARDS.md` and the repository.

**Data:** none (static content).

---

## 5. Data inventory: every v2 field and where it lives in v3

L-levels are as defined in §1.4. "Tooltip" always has a non-hover path (focus, or the Details table), per `P6`.

| v2 location         | Data                                                                                                    | v3 location                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Chrome**          | Demo banner sentence                                                                                    | Demo line (L0) and its "About the demo" popover                                                |
|                     | Mock badge                                                                                              | Demo line text "In-repo mock data"                                                             |
|                     | Block number, updated-ago                                                                               | Header freshness (relative time). Block in the popover. Footer data line.                      |
|                     | Tracked of total pools (freshness title)                                                                | Freshness popover                                                                              |
|                     | API unreachable                                                                                         | Header "Offline" plus per-section errors                                                       |
|                     | Footer principles, repo link, data source                                                               | Footer (reworded, no middle dots)                                                              |
| **Home**            | Pools scored (of tracked)                                                                               | Lead ("each of 6"), freshness popover, Pools answer                                            |
|                     | Depth ±2 % total                                                                                        | Home H1                                                                                        |
|                     | 24 h volume total                                                                                       | Home facts                                                                                     |
|                     | Median health and grade                                                                                 | Home facts                                                                                     |
|                     | Gaps top 5 (pair, DEX, fee, volume, depth, turnover, score)                                             | Home gaps preview (≤ 3 real gaps). Full columns in Gaps table view.                            |
|                     | Scorecard cards (status, pair, DEX, fee, method, KPI, now, 7 d uptime, tape, samples within KPI, badge) | Home row (status, 7 d uptime). The rest on Scorecard detail: facts, Uptime, Embed, Mandate.    |
|                     | "What we measure" cards                                                                                 | Methodology metric index                                                                       |
| **Pools**           | Per-DEX scored/tracked, depth, median health (tiles)                                                    | DEX filter answer line, plus "Compare DEXes" (L2), which adds discovered pools and 24 h volume |
|                     | Search, sort, direction, DEX filter                                                                     | Unchanged, in the URL                                                                          |
|                     | Table: pair, DEX, fee, stable                                                                           | Pool cell (pair, then DEX and fee, "stable pair" as text)                                      |
|                     | Health grade and score                                                                                  | Default column                                                                                 |
|                     | Depth ±2 %, spread $10K, 24 h volume                                                                    | Default columns                                                                                |
|                     | Gap, TVL, top LP, updated                                                                               | Columns menu. Updated becomes a caption when uniform.                                          |
|                     | "6 of 6" count, refreshing                                                                              | Answer sentence count, plus the 2 px refetch bar                                               |
|                     | Gaps list                                                                                               | `/gaps` only. Gap is a Pools column and sort.                                                  |
| **Pool**            | Pair with token links                                                                                   | H1                                                                                             |
|                     | DEX, fee                                                                                                | Secondary line                                                                                 |
|                     | Tick spacing, stable, not tracked, hooks, contract or pool id, snapshot time, scored time               | About this pool (L3)                                                                           |
|                     | Price                                                                                                   | Secondary line                                                                                 |
|                     | Inverse price                                                                                           | Text toggle (L2)                                                                               |
|                     | TVL, spread $10K, 24 h volume, health                                                                   | Facts row                                                                                      |
|                     | Depth ±2 %                                                                                              | Answer sentence (per side), plus curve labels                                                  |
|                     | Gap score                                                                                               | Callout when turnover ≥ 3×, otherwise About (L3)                                               |
|                     | Depth ±1/2/5 % USD per side                                                                             | Curve points (L0), tooltip and "Show data"                                                     |
|                     | Token amounts per level                                                                                 | Curve tooltip and "Show data" (L2)                                                             |
|                     | Exhausted flag                                                                                          | Dashed segment, "Liquidity runs out" label, tooltip                                            |
|                     | Ask-vs-bid asymmetry sentence                                                                           | Answer sentence states both sides. The percentage goes in the curve's "Show data" caption.     |
|                     | Spread per notional (bps, bar)                                                                          | Cost to trade dot plot                                                                         |
|                     | Buy and sell average prices                                                                             | Cost to trade Details (L2)                                                                     |
|                     | Health total, grade, components                                                                         | Health section and Details (1 decimal)                                                         |
|                     | Health notes (`score.notes`, not shown in v2)                                                           | Health section muted line                                                                      |
|                     | Concentration band, range HHI, active range share                                                       | Who provides it, Details                                                                       |
|                     | Owners top 1, top 3, HHI, count                                                                         | Who provides it visual and Details                                                             |
|                     | Persistence 24 h / 7 d: samples, median, p10, stability, uptime                                         | Over time takeaway and Details. Min depth is also shown.                                       |
|                     | History depth and spread, 24 h / 7 d                                                                    | Over time small multiples (`window` in the URL)                                                |
|                     | History health, TVL, price (in the API, not shown in v2)                                                | Over time series picker (L2)                                                                   |
| **Gaps**            | Floor, explanation, formula                                                                             | Caption, one-sentence lead, `Methodology#gaps`                                                 |
|                     | Rank, pair, DEX, fee, turnover, gap score                                                               | List view                                                                                      |
|                     | 24 h volume, depth ±2 %                                                                                 | Row hover/focus and table view                                                                 |
|                     | Health, TVL                                                                                             | Table view (L2)                                                                                |
| **Scorecards list** | Active filter                                                                                           | Unchanged (`active`)                                                                           |
|                     | Name, market maker, pool, status, 7 d uptime                                                            | List row                                                                                       |
|                     | 24 h and 30 d uptime, MM depth up/down against KPI, spread against KPI, last sample                     | Table view (L2)                                                                                |
| **Scorecard**       | Name, status, market maker, pool link                                                                   | Title block                                                                                    |
|                     | Streak (breached or ok × N, since)                                                                      | Answer sentence                                                                                |
|                     | Registered, latest sample, alerts after N, webhook                                                      | Mandate list (L3)                                                                              |
|                     | Addresses, notes                                                                                        | Mandate list (L3)                                                                              |
|                     | Attribution method and holdings, share of in-band liquidity                                             | Mandate list (L3)                                                                              |
|                     | Pool depth up/down (context)                                                                            | "Show whole-pool depth" chart toggle, plus Mandate list                                        |
|                     | KPI depth up and down: value, target, band, pass/fail                                                   | Facts-row bullets with status shape                                                            |
|                     | KPI uptime 7 d against target                                                                           | Facts-row bullet                                                                               |
|                     | Spread KPI (when set)                                                                                   | Fourth fact and Spread section                                                                 |
|                     | Uptime 24 h / 7 d / 30 d with samples within KPI                                                        | Uptime section takeaway and Details                                                            |
|                     | Tape                                                                                                    | Uptime strip (one row)                                                                         |
|                     | Samples chart: MM depth per side, KPI line, pool depth in tooltip                                       | Focal chart and tooltip                                                                        |
|                     | MM spread and pool spread series                                                                        | Spread section                                                                                 |
|                     | Worst excursions (value, threshold, when, block)                                                        | Worst moments lines. Block in Details.                                                         |
|                     | Recent breaches (time, kinds, depth up, depth down, spread, block)                                      | Episodes, and "Show samples" (L2) for raw rows                                                 |
|                     | Badge, badge URL, HTML and Markdown snippets, copy, cache note                                          | Embed badge section, with code behind "Show code"                                              |
| **Token**           | Symbol, name                                                                                            | Title block                                                                                    |
|                     | USD price                                                                                               | Facts row                                                                                      |
|                     | Address, decimals, price updated                                                                        | About this token (L3)                                                                          |
|                     | Priced via route                                                                                        | Facts row (words), About (full route with links)                                               |
|                     | Pools scored of discovered                                                                              | Scored count in the answer; discovered in the facts row                                        |
|                     | Pools table and sort                                                                                    | Pools section (sort now in the URL)                                                            |
| **Methodology**     | Conventions, 7 sections, formulas, grade legend, doc links, reproducibility note                        | Lead and index, sections, "Show formula", health figure, end paragraph                         |
| **Not found**       | Title, message, id, links                                                                               | Unchanged content (§3.5)                                                                       |

Nothing is removed from the product. Only these change:
- duplicates (the gaps list on Home and Pools, repeated KPI values);
- decoration (dividers, feature cards, chips for non-state);
- repeated captions ("just now" on every row).

---

## 6. Data and implementation implications

1. **Per-side depth in `PoolSummary`.** The Home and Token butterflies and the Pools glyph column need each pool's ±2 % depth per side.
   - `PoolSummary` carries `depth2UpUsd: number | null` and `depth2DownUsd: number | null` next to `depth2Usd`: the newest snapshot's `depthUsd` at `pct === 2` (`upUsd` is the buy side, `downUsd` the sell side), read as core stored them. A side is `null` when its token has no USD price (docs/METRICS.md) or the pool has no snapshot, so it draws as unknown, never as 0.
   - The fields are defined in lock-step in `apps/api/src/dto.ts` and `summary.ts` (from the `@depthwatch/db` snapshot summary), `openapi.json` and the API's `AGENTS.md`; `apps/web/src/api/types.ts`; the mock clients (`mockPools.ts` `summarize`); and the static bundle, which `depthwatch export` reads from the real API.
   - The butterflies, the total row and the Pools glyph column read both sides from `usePools` / `useToken`; no per-row `usePool` request is made.
2. **Breach episodes.** Derive them on the client from `useScorecardSamples` in a new `lib/scorecard.ts` helper, `breachEpisodes(points)`. It returns start, end, sample count, kinds and the worst depth per side. No API change.
3. **Scorecards list strips.** Each strip needs that mandate's 7 d samples. Fetch them only on desktop and only when there are 10 mandates or fewer. Otherwise show the bullet alone. The static bundle already holds the samples.
4. **Token total depth** is the API's `depth2UsdTotal`: the sum of `depth2Usd` over every scored pool of the token but the stale quotes and the pools whose stock's transfers are paused, whatever page of them is loaded (docs/METRICS.md, "A token's depth"). Note in the tooltip that a pool counted for two tokens contributes to both token pages.
5. **Mandates on a pool:** `useScorecards({pool: id})`, already supported by the HTTP, mock and static clients.
6. **History series** for health, TVL and price already exist in `HistoryPoint`. No API change.
7. **Tests.** Page tests (`Home.test.tsx`, `Pools.test.tsx`, `PoolDetail.test.tsx`, `Scorecard.test.tsx`, `Scorecards.test.tsx`, `Token.test.tsx`, `Methodology.test.tsx`) assert this contract: answer sentences, focal element presence, disclosure contents and URL parameters. The greps from `principles.md` §17 are test cases (no `text-transform: uppercase`, no `·` in `.tsx` UI strings, no `→` in link text). v4 amended: `text-transform: uppercase` appears only in the `.eyebrow` rule (`T1`, `T11`).

## 7. Sources

Principles and evidence are cited in [`principles.md`](principles.md) (full URL list) and [`critique-v2.md`](critique-v2.md). The IA-specific sources (read as excerpts, unverified in full):
- NN/g, Progressive disclosure (more than two levels "typically have low usability"): https://www.nngroup.com/articles/progressive-disclosure/
- NN/g, Tabs vs. accordions (tabs for a few parallel sections, accordions for many short ones): https://www.nngroup.com/videos/tabs-vs-accordions/
- NN/g, Accordions on desktop (show content people need together at once, even if the page gets longer): https://www.nngroup.com/articles/accordions-on-desktop/
- NN/g, Scrolling and attention (57 % of viewing time above the fold, 74 % within the first two screenfuls): https://www.nngroup.com/articles/scrolling-and-attention/
- NN/g, Hidden navigation on mobile: https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/
- Uniswap pool page (one chart with a type toggle in the URL, stats beside it): https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/index.tsx · https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/PoolDetailsStats.tsx
- Primer data visualisation (offer the data as a table): https://github.com/primer/design/blob/main/content/ui-patterns/data-visualization.mdx
- Few's dashboard definition (one screen, at a glance): https://www.tableau.com/sites/default/files/webinars/what_the_heck_is_a_dashboard_anyways.pdf
- Depth framing at ±2 % (industry convention): https://docs.kaiko.com/getting-started/kaiko-examples/compare-market-depth-between-exchanges
