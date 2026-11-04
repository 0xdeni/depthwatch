# Roadmap

Three layers. Each layer is started only when the previous one has users; the observatory is
useful on its own and is the only part this repository commits to. Weeks are counted from the
start of development. Acceptance criteria are written so that an outsider can check them.

## Layer 1: Observatory MVP (weeks 1–4)

Index Uniswap v3, Uniswap v4, Aerodrome v2, Aerodrome Slipstream, Aero v2 and Aero Slipstream pools
on Base (every pool of those factories with log discovery, the pools between the reference tokens
with `discover --seed`); publish depth at ±1/2/5 %, effective spread, LP concentration, liquidity
persistence, a Liquidity Health Score and a liquidity gaps feed through a public API and dashboard.

**2026-10-28.** Aerodrome moved to a new platform, Aero, on 2026-10-21: new v2 and Slipstream
factories, a new AERO token and new gauges. Aero's venues are indexed as two DEXes of their own
(`aero-v2`, `aero-slipstream`) beside Aerodrome's, whose pools still trade and keep their ids.

### Week 1: core math and storage

- Tick math and sqrt-price math match Uniswap's constants and rounding.
- Swap simulation for concentrated, constant-product and stable-swap pools, fees included, with a
  brute-force cross-check (many tiny exact-in swaps agree with one `simulateSwapToPrice` within
  rounding).
- All metrics implemented in core exactly as [METRICS.md](METRICS.md) defines them, with
  hand-computed test cases.
- SQLite schema, migrations and repositories.

Acceptance: `pnpm check` green; `getSqrtRatioAtTick(887272)` equals the Uniswap constant; the
brute-force property test passes for all three pool kinds; every metric has a worked example in
METRICS.md reproduced by a test.

### Week 2: chain adapters and offline demo

- Discovery, overview, state (tick-bitmap walk), swaps and positions readers for the six DEXes,
  multicall batched, chunked `getLogs`, incremental sync state.
- Fixture transport and recording transport.
- `depthwatch demo` serves the full dashboard from a synthetic fixture set with no network.

Acceptance: every reader has fixture-backed tests; `pnpm depthwatch demo` starts in under 10 s on
a machine with no network access and every dashboard route renders with data; a recorded mainnet
fixture for at least one pool per DEX decodes correctly.

### Week 3: live pipeline, API, dashboard

- `discover`, `snapshot`, `volume`, `positions`, `score`, `run`, `serve` against a real Base RPC.
- REST API with zod validation and the routes listed in DESIGN.md.
- Dashboard: overview (stats strip, sortable top pools, gaps feed), pool detail (depth ladder both
  sides, spread by notional, concentration, score breakdown, 24h/7d chart), gaps page, token page.
  Light and dark themes.

Acceptance: a fresh clone with an RPC URL reaches a populated dashboard with
`discover --seed → snapshot → volume → score → serve` in under 30 minutes for the top 200 pools
(a first factory-log `discover` is about 97,000 `eth_getLogs` at 2,000-block chunks, hours on a
public endpoint, and is outside that budget); all API routes respond in under 200 ms on a 7-day
database; the dashboard has no backend-specific code (`VITE_MOCK=1` still works).

### Week 4: validation at scale and public deployment

- Run the loop for 7 consecutive days on the top 200 pools at a 5-minute interval.
- Cross-check simulated depth against observed swaps: for a sample of real `Swap` events, the
  simulator's `amountOut` for the same `amountIn` on the pre-swap state must agree with the event
  within rounding (target: 99 % of sampled swaps within 0.1 %).
- Compare pool TVL and USD prices against an external reference for the top 50 pools and document
  discrepancies.
- Measure and document RPC usage per cycle; tune chunk sizes and `--top`.
- Public deployment with the API and dashboard; persistence 24h/7d populated for tracked pools.
  **Open.** Since 29 October 2026 a public static copy of the dashboard, without the API, has been
  at <https://depthwatch.pages.dev>, replaced about every three hours
  ([DEPLOY.md](DEPLOY.md#a-free-static-copy)).

Acceptance: the 7-day run completes without manual restarts; the swap cross-check report is
committed under `docs/validation/`; the README status note is updated from "not yet validated" to a
dated statement of what was validated; the gaps feed lists only pools with ≥ $10k 24 h volume.

### After Layer 1: Aero follow-ups

- **Unknown factories.** Aero's FactoryRegistry approves the factories its pools may come from.
  A check at every pass that compares its `targetFactories()` with the factories in
  `addresses.ts` and warns about any other, so a new factory is reviewed and indexed instead of
  missed.
- **A complete index of the young factories.** `discover --seed` asks Aero's factories for the
  pairs of the reference tokens, like the others; an `allPools` mode would list every pool of
  those factories (279 volatile, 21 stable and 489 Slipstream pools at block 53,211,601) without
  log discovery.
- **The initial fee.** An Aero Slipstream pool whose swap hook charges each block's first swap a
  fixed initial fee is marked hooked, not modelled (none does today). Modelling that fee would
  rate those pools too.

Acceptance: a factory outside `addresses.ts` produces a warning in the pass that first sees it;
the `allPools` mode stores every pool of the Aero factories with its creation block; a pool with
the initial fee enabled gets depth and spread with that fee on the first swap.

### After Layer 1: near-real-time depth with Flashblocks

Flashblocks (sub-block preconfirmations, about 200 ms) have been live on Base mainnet since July
2025. Depth today is computed per block from a confirmed state. The Flashblocks item is: read
pending state from a Flashblocks-aware endpoint for the top pools and publish depth that reflects
the preconfirmed state, with the block-confirmed value kept as the record of truth.

Acceptance: for the top 20 pools, the dashboard shows a ±2 % depth value that is at most 1 s behind
the preconfirmed state, labelled as preconfirmed; stored snapshots remain block-confirmed.

## Layer 2: Market-maker scorecards (weeks 5–8)

A project registers its market maker's addresses and the KPIs in its agreement; Depthwatch
computes a live, public scorecard from the same pool data the observatory already produces.

**Status.** The engineering items of weeks 5–8 are delivered in this repository and documented in
[SCORECARDS.md](SCORECARDS.md) (definitions, registration, API, badge, limitations); the
onboarding items of weeks 7–8 remain open.

### Scope

- **Registration.** A mandate names one pool, the market maker's addresses (position owners for v3 /
  v4 / Slipstream, gauge depositors for staked Slipstream positions, LP-token holders for Aerodrome
  v2 and Aero v2 with staked LP tokens included) and KPIs: minimum depth in USD on each side at
  `±bandPct` (default 2 %), optionally a maximum effective spread in bps at a notional (default
  $10k), and an informational target uptime. Registration is a JSON file through `depthwatch mm
  register` or `POST /api/mm` behind an admin token.
- **Attribution.** The market maker's contribution is computed from its holdings only: a pool state
  containing just its positions (concentrated pools) or the reserves scaled by its LP share
  (Aerodrome v2 and Aero v2). The whole pool's depth and spread are reported alongside, so the
  scorecard distinguishes "the pool is deep" from "the market maker is providing".
- **Sampling.** Every snapshot of a mandated pool is a sample, taken inside the `snapshot` step
  and stored in the same transaction, with the block number so any reading can be reproduced.
  A sample is within KPI, breached, or not evaluable (a USD price was missing); uptime is the share
  of evaluable samples within KPI over 24 h, 7 d and 30 d. Mandated pools are always snapshotted,
  whether or not they rank in the top N.
- **Scorecard.** A public page `/mm/:id`, a listing `/mm`, API routes with the KPIs, current
  values, uptime, worst excursions, current streak and the sample history, and an embeddable SVG
  badge for the project's own docs.
- **Alerts.** A webhook per mandate receives a `breach` event once a breach has lasted
  `alertAfterSamples` consecutive samples and a `recovered` event afterwards; every attempt is
  recorded.

### Milestones

- Weeks 5–6: registration model, attribution for every DEX (all six since Aero v2 and Aero
  Slipstream were added), sampling inside `snapshot`, API
  routes. **Delivered.** Acceptance: a sample reproduces by hand from public data following the
  procedure in SCORECARDS.md (block number, pool state, holdings, core functions); attribution
  tests cover positions inside, outside and straddling the band, LP-share scaling and gauge-staked
  holdings.
- Weeks 7–8, engineering: scorecard pages, history, alerts (webhook when a KPI is breached for
  more than N samples), badge. **Delivered.** Acceptance: the demo pipeline produces one `ok` and
  one `breached` scorecard offline; webhook delivery, recovery and failure recording are tested
  against a local HTTP server.
- Weeks 7–8, onboarding: the first projects. **Open.** Acceptance: at least three projects with
  live scorecards; at least one market maker has confirmed the attribution matches its own books.

## Layer 3: Mandate escrow (only once Layers 1 and 2 have users)

Onchain market-making agreements where fees release against verified KPIs. This layer is not
started until the scorecards have been used by real projects for at least one month and at least
one project and one market maker have asked for it.

### Shape

- An agreement contract holds the fee for a mandate period and names the pools, the market maker,
  the KPIs and the verifier.
- Depthwatch acts as verifier: it posts signed attestations of the KPI results (for example,
  uptime for the period, derived from the stored samples) and the contract releases the fee
  proportionally, with a dispute window during which either party can challenge an attestation
  against the public sample history.

### Preconditions and acceptance

- Preconditions: Layer 2 usage as above.
- Acceptance for a first version: one mandate settled end to end on Base mainnet with a real
  project and market maker; attestations reproducible from public samples; the contract audited.

## Non-goals

These are deliberate and will be declined as feature requests:
- **No trading on its own account, no routing, no aggregation.** Depthwatch simulates swaps to
  measure depth and never trades for itself. The dashboard's optional swap panel, off unless the
  site's operator switches it on, lets a visitor swap in the pool they are viewing, from their own
  wallet, straight to that pool's router; it never routes, splits a swap across pools or
  recommends a pool.
- **No custody, no token, no trading capital, no fee added to swaps.** The swap panel never holds a
  visitor's funds; each swap carries Depthwatch's Builder Code (ERC-8021), which lets Base
  attribute the transaction onchain; the code adds no fee, only 29 bytes of calldata (a negligible
  amount of gas). Layer 3 escrow holds a fee, not inventory, and is non-custodial with respect to
  the market maker's assets.
- **No chains other than Base.** No multi-chain abstraction, no bridges.
- **No price oracle.** USD prices are derived from pool prices for display and for valuing depth;
  they carry no guarantee and must not be consumed as an oracle.
- **No market making by Depthwatch itself.** The project measures market makers; it does not
  compete with them.
- **No third-party data vendors.** Everything is computed from the chain through a standard
  JSON-RPC endpoint so that any reading can be reproduced by anyone.
- **No support for pools whose state cannot be read in full.** If a hook or custom pool makes
  depth unobservable from public state, the pool is listed with null metrics rather than guessed.
