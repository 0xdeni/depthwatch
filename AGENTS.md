# AGENTS.md

Depthwatch is an open-source (MIT) liquidity observatory for Base mainnet: it indexes Uniswap
v3/v4, Aerodrome and Aero pools and publishes depth at ±1/2/5 %, effective spread, LP
concentration, persistence, a Liquidity Health Score and market-maker scorecards through a CLI
pipeline, a Hono API and a React dashboard. It measures and does not trade on its own account: no
token, no custody, no trading capital, no fee added to swaps. The static site's optional swap panel,
off unless its operator switches it on (docs/DEPLOY.md, "Trade switch"), lets a visitor swap in the
pool they are viewing, from their own wallet, straight to that pool's router; it never routes or
recommends a pool, and each swap carries Depthwatch's Builder Code (ERC-8021), which lets Base
attribute the transaction onchain; the code adds no fee, only 29 bytes of calldata (a negligible
amount of gas).

This file is for coding agents working on this repository. An agent that wants to use a running
Depthwatch API reads `GET /AGENTS.md` on that server instead (source:
[apps/api/src/agentDocs/AGENTS.md](apps/api/src/agentDocs/AGENTS.md)). [DESIGN.md](DESIGN.md) is
the contract between packages; [CONTRIBUTING.md](CONTRIBUTING.md) has the full rules.

## Layout

pnpm workspace, TypeScript (strict, ESM), Node ≥ 22.13. No build step for Node packages: `tsx`
runs TypeScript directly and workspace imports resolve to each package's `src/index.ts`.

| Path                     | Package / content   | What lives there                                                                             |
| ------------------------ | ------------------- | -------------------------------------------------------------------------------------------- |
| `packages/core`          | `@depthwatch/core`  | Tick math, swap simulation, every metric, USD price graph, scorecards. Pure: no I/O.         |
| `packages/chain`         | `@depthwatch/chain` | viem adapters for Base, addresses (`src/addresses.ts`, stocks in `src/stocks.ts`), fixtures. |
| `packages/db`            | `@depthwatch/db`    | `node:sqlite` schema, migrations, typed repositories.                                        |
| `apps/api`               | `@depthwatch/api`   | Hono REST API (zod validation), agent documents, static serving of the dashboard.            |
| `apps/web`               | `@depthwatch/web`   | React 19 dashboard: reads `/api` or the bundle, swaps use the wallet. Vite build `plugins/`. |
| `apps/cli`               | `@depthwatch/cli`   | The `depthwatch` command: discover → snapshot → volume → score → serve, start, demo, export. |
| `apps/api/src/agentDocs` | agent documents     | `AGENTS.md`, `llms.txt`, `openapi.json` served at the API root and copied by the build.      |
| `deploy/`                | deployment          | `compose.yaml` and the entrypoint of the root `Dockerfile`; `docs/DEPLOY.md` is the guide.   |
| `docs/`                  | documentation       | `METRICS.md`, `ARCHITECTURE.md`, `SCORECARDS.md`, `ROADMAP.md`, `DEPLOY.md` (a server).      |
| `docs/research`          | research notes      | `base-contracts.md`: the addresses, ABIs and chain facts used, with sources and verdicts.    |
| `docs/base`              | Base reference      | `base-agents-reference.md`: copy of base.org/AGENTS.md (the live file wins).                 |

## Commands

Run from the repository root.

```sh
pnpm install          # CI: pnpm install --frozen-lockfile with pnpm 10.28.0; locally `corepack enable` picks up the pinned version
pnpm lint             # biome check . (format + lint, Markdown and JSON included; warnings fail); pnpm lint:fix applies fixes
pnpm typecheck        # tsc --noEmit in every package
pnpm test             # vitest run: node project (packages, api, cli) + jsdom project (web)
pnpm build            # vite build of apps/web -> apps/web/dist, served by `depthwatch serve`
pnpm build:static     # export the demo bundle, then the static site -> apps/web/dist-static
pnpm depthwatch demo  # offline: synthetic Base world -> in-memory DB -> API + dashboard on :8787
pnpm depthwatch start # a server: API + dashboard + the pipeline on a schedule (docs/DEPLOY.md)
pnpm check            # lint + typecheck + test
pnpm check:all        # check + build + build:static: every step CI runs
```

CI (`.github/workflows/ci.yml`, on Node 22.13 and 24) runs install, lint, typecheck, test, build
and build:static in that order and all must pass (`pnpm check:all` runs them locally); a
`pnpm audit --prod` step then fails the job on a high or critical advisory in a production
dependency and leaves a warning for a moderate or low one. One package at a time:
`npx vitest run packages/core`, `npx tsc --noEmit -p packages/core/tsconfig.json`,
`npx biome check --write packages/core`. `DEPTHWATCH_PORT` (or `--port`, else a platform's `PORT`)
moves the server; live commands (`discover`, `snapshot`, `volume`, `positions`, `run`, `start`,
`mm sample`) need `DEPTHWATCH_RPC_URL` and are never needed for tests; `DEPTHWATCH_LOGS_RPC_URL`
(or `--logs-rpc-url`, default: the main URL) moves every `eth_getLogs`, and nothing else, to a
second endpoint. The Refresh site workflow (`.github/workflows/refresh-site.yml`) checks every hour
and, when the last refresh from `main` is at least 2.5 hours old, publishes a new static copy at
<https://depthwatch.pages.dev> ([docs/DEPLOY.md](docs/DEPLOY.md#a-free-static-copy)).

## Conventions that bite

1. **bigint discipline.** Raw token amounts, liquidity, sqrt prices and block numbers are
   `bigint`. Use the helpers in `packages/core/src/math.ts`, round in the pool's favour like the
   contracts, convert to `number` only at the human-facing edge (`rawToHuman`). Never
   `Number(amount)` mid-computation and never `JSON.stringify` a bigint: use `toJsonSafe` /
   `jsonStringify`, revive with `reviveBigints(value, BIGINT_KEYS)`, and add new bigint-valued
   property names to `BIGINT_KEYS`. On the wire, bigints are decimal strings.
2. **Addresses are lowercase.** Normalise on the way in; never compare case-sensitively. Pool ids
   are `<dex>:<lowercase address>` or `uniswap-v4:<poolId>`.
3. **Hermetic tests.** `pnpm test` never reaches the network. Chain code goes through
   `createFixtureTransport`, or `createFakeRpcFetch` behind viem's `http()` when the HTTP error
   path matters (it replays Alchemy's free-tier 400, Base's public 429 and the -32602 answers of
   Tenderly's public gateway and Pocket, reason in `data`, verbatim); db and API
   tests use `openDatabase(':memory:')` and `app.request()`; the web uses the mock client, and the
   swap panel a fake EIP-1193 wallet behind viem's `custom()` (`apps/web/src/testing/fakeWallet.ts`,
   `tradeHarness.tsx`). A test that needs the network is a bug.
4. **Metrics are defined once, in [docs/METRICS.md](docs/METRICS.md), and implemented once, in
   `packages/core`.** CLI, API and dashboard call core; they never re-derive a number. A new
   metric is written down in METRICS.md (formula, units, null semantics, worked example) first.
5. **No dependencies without updating DESIGN.md** (its "May import" column) and saying why the
   standard library is not enough. The lockfile is shared; core has no dependencies at all.
6. **Shared types** live in `packages/core/src/types.ts`; changing them is a contract change that
   updates DESIGN.md in the same change. `price` is always token1 per token0; the up side is buy
   pressure on token0.
7. **TypeScript strictness**: `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are on; use
   `import type` and relative imports with the `.js` extension.
8. **Docs are pinned by tests.** `apps/api/src/routes/docs.test.ts` checks that the README "API"
   table lists every route `createApp` registers, DESIGN.md "API (apps/api)" the non-scorecard
   ones and docs/design/scorecards.md §6 the `/api/mm` ones; `apps/api/src/routes/agentDocs.test.ts` checks that `openapi.json` lists exactly the
   GET routes and that real responses match its schemas (undocumented fields fail). A new or
   changed route updates those documents and `apps/api/src/agentDocs/` in the same change.
9. **Biome formats Markdown** (tables, embedded JSON) and JSON files as well as code; 100 columns,
   single quotes, no semicolons. Run `pnpm lint:fix` rather than formatting by hand.
10. **Never extrapolate pool state**, keep files under about 400 lines, no TODO stubs, no secrets
    (`.env` is git-ignored).
11. **A block count is not a duration.** Base's block time changed at Denim (2 s, then 200 ms):
    find blocks by time with `ChainReader.blockAtOrAfter` and time blocks with `getBlockTimestamp`
    or the block schedule (`packages/chain/src/schedule.ts`), never with a blocks-per-hour constant.

## Base contract addresses

Every address Depthwatch reads (factories, pool managers, position managers, StateView, quoters,
Multicall3, reference tokens), and every router and token the dashboard's swap panel may send to
(`TRADE_ROUTES`, `TRADE_TOKENS`, browser-safe through `@depthwatch/chain/addresses`), is in
`packages/chain/src/addresses.ts`; the tokenized stocks, their Chainlink feed proxies and Coinbase's
oracle registry are in `packages/chain/src/stocks.ts` (`BASE_STOCKS`; never in `addresses.ts` and
never trade tokens). Both are taken from
[docs/research/base-contracts.md](docs/research/base-contracts.md), which records the sources and
an independent-verification verdict per address; items marked unconfirmed must be checked on the
first live run, where the factory logs read by `depthwatch discover` are the ground truth. DEX and
Multicall3 addresses stay tied to those per-address sources and verdicts and to the factory logs.
Base-native addresses (for example the WETH9 predeploy) can also be re-checked against Base's
contract-address reference, <https://docs.base.org/specifications/reference/base-contracts.md>,
which Base's AGENTS.md describes as canonical contract addresses for Base Mainnet and Base
Sepolia; whether that page covers any DEX address is unverified. Do not add an address from memory
or from a third-party chain list.

## Base network reference

Depthwatch supports Base Mainnet only (`BASE_CHAIN_ID = 8453` in core).

| Network      | Chain ID | RPC                        | Explorer                       |
| ------------ | -------- | -------------------------- | ------------------------------ |
| Base Mainnet | `8453`   | `https://mainnet.base.org` | `https://basescan.org`         |
| Base Sepolia | `84532`  | `https://sepolia.base.org` | `https://sepolia.basescan.org` |

Base Mainnet made one block every 2 s until block 53,556,127; from Denim's activation there
(2026-11-05 18:00:01 UTC) it makes five a second, 200 ms apart, never skipping a slot (18,000 an
hour), and Flashblocks stopped. Header `timestamp`s stay whole seconds, so about five blocks share
one. `BASE_BLOCK_SCHEDULE` (`packages/chain/src/schedule.ts`) records both eras, checked on chain in
[docs/research/base-contracts.md §2.13](docs/research/base-contracts.md#213-block-schedule-denims-200-ms-blocks-2026-11-05).

The public mainnet RPC is rate-limited and rejects large `eth_getLogs` spans (Base's `eth_getLogs`
page still says to keep ranges under 2,000 blocks, 400 s of chain since Denim), hence the default
`DEPTHWATCH_LOG_CHUNK` of 2000 blocks. Rate limits and gateway failures are retried with capped
backoff, then fail as an ordinary `RetryExhaustedError`; a logs endpoint that cannot serve the chunk
(Alchemy's free tier: 10 blocks) stops with `LogRangeLimitError` after the first request of each log
scan (one per DEX for `volume`) rather than crawling, and works with `DEPTHWATCH_LOG_CHUNK=10` for
short scans only (24 h of `volume` is at least 43,200 requests per event source at 10 since Denim);
`discover --seed` finds the reference-token pools from factory views without any `eth_getLogs`
(README "Running on a free RPC"). `classifyLogsError` (`packages/chain/src/internal/logErrors.ts`)
reads the provider's text from the JSON-RPC error's message and, for a -32602 only, its `data`
(Tenderly's public gateway and Pocket answer -32602 "invalid params" with the reason only in
`data`): a stated maximum (`statedMax`; Tenderly: 1,000 blocks) at or above the floor splits ranges
to it, and a refused result count or viem's `ResponseBodyTooLargeError` (an answer over 10 MiB)
halves them. The Refresh site workflow reads logs from the optional `DEPTHWATCH_LOGS_RPC_URL`
secret, then from Tenderly's public gateway at 1,000-block chunks
([docs/DEPLOY.md](docs/DEPLOY.md#the-logs-endpoint)). Base Sepolia is not indexed; if testnet
settings are ever needed, take them from Base's Sepolia documentation, not from third-party chain
lists.

## Where to look things up

Adapted from the routing rules of Base's own AGENTS.md (<https://www.base.org/AGENTS.md>, copy in
[docs/base/base-agents-reference.md](docs/base/base-agents-reference.md)):
1. **First-party Base sources first.** base.org for product, ecosystem and brand context
   (`/trading`, `/ecosystem`, `/brand`); docs.base.org for implementation, network setup and
   contract addresses. Prefer the Markdown form of a docs page (append `.md`) and the docs index
   <https://docs.base.org/llms.txt>; if a Markdown and an HTML page disagree, the Markdown page is
   the source of truth and the mismatch is worth flagging.
2. **RPC endpoints and explorers verify; they do not explain.** Use them to confirm that an
   address has code or that an event decodes, after the address came from the docs.
3. **Inside this repository**, docs/METRICS.md and DESIGN.md are the definitions; code comments
   and the dashboard follow them.
4. **When a source cannot be read**, say so and leave the item marked unverified, as
   docs/research/base-contracts.md does. Never fill in the contents of a page that was not read.
5. **Brand.** Base names and marks follow <https://base.org/brand> (partnerships, core
   identifiers) before any "Built on Base" use; see CONTRIBUTING.md.
