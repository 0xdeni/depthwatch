# Contributing

Thanks for looking at Depthwatch. This page covers the development setup, the checks every change
must pass, the rules that come from [DESIGN.md](DESIGN.md), and the two most common kinds of
change: adding a metric and adding a DEX adapter.

## Setup

- Node ≥ 22.13 (`.nvmrc`; `node:sqlite` is used directly, so older Node does not work).
- pnpm 10: `corepack enable` picks up the version pinned in `package.json`.

```sh
pnpm install
cp .env.example .env     # only needed for commands that talk to an RPC
pnpm depthwatch demo     # offline end-to-end run; good first smoke test
```

The workspace has three library packages (`packages/core`, `packages/chain`, `packages/db`) and
three apps (`apps/api`, `apps/web`, `apps/cli`). There is no build step for Node packages: `tsx`
runs TypeScript directly and workspace imports resolve to each package's `src/index.ts`. Only the
dashboard is built (`pnpm build`), and only so that `depthwatch serve` can serve it.

## Checks

CI runs exactly these, in this order, on Node 22.13 and 24; a pull request must pass all of them:

```sh
pnpm lint          # biome check .   (format + lint, warnings fail; `pnpm lint:fix` applies fixes)
pnpm typecheck     # tsc --noEmit in every package
pnpm test          # vitest run (node project for packages/api/cli, jsdom project for web)
pnpm build         # vite build of apps/web
pnpm build:static  # export the demo bundle, then the static site build
```

`pnpm check` runs the first three and `pnpm check:all` all five. CI also runs `pnpm audit --prod`,
which fails on a high or critical advisory in a production dependency and leaves a warning for a
moderate or low one. To work on one package without waiting for the rest:

```sh
npx biome check --write packages/core
npx tsc --noEmit -p packages/core/tsconfig.json
npx vitest run packages/core
```

Besides the demo world, the web suite runs every route of the static app on
`apps/web/src/testing/liveShape.json`: 60 pools cut from a real Base mainnet export, with the
shapes the demo lacks (Uniswap v4 pools without a TVL, mostly unrated pools, pools that share pair,
DEX and fee, prices from 1e-39 to 1e38). To refresh it, work on a copy of a live database: leave
about 60 pools of those shapes tracked (`UPDATE pools SET tracked = 0 WHERE id NOT IN (…)`), run
`depthwatch score`, then `depthwatch export --out apps/web/src/testing/liveShape.json --note …`
with `DEPTHWATCH_DB` set to the copy, and format the file (`pnpm lint:fix`): Biome checks JSON
too. `apps/web/src/liveShape.test.tsx` checks that the shapes are still there.

Code style is enforced by Biome (`biome.json`): single quotes, no semicolons, two-space indent,
100 columns, trailing commas. Do not argue with the formatter; run `pnpm lint:fix`.

## Rules

These come from DESIGN.md and are checked in review.
1. **No new dependencies without updating DESIGN.md.** The lockfile is shared by every package and
   `@depthwatch/core` has none at all. If a change needs a package, the pull request updates the
   "May import" column in DESIGN.md and explains why the standard library is not enough.
2. **Shared types live in `packages/core/src/types.ts`.** A change there is a contract change and
   is reflected in DESIGN.md in the same pull request. Prefer adding a type in your own package.
3. **bigint discipline.** Raw token amounts, liquidity, sqrt prices, block numbers are `bigint`.
   Use the helpers in `packages/core/src/math.ts` (`mulDiv`, `mulDivRoundingUp`, `divRoundingUp`,
   `sqrtBigint`, `minBigint`, `maxBigint`, `clampBigint`) and round explicitly, in the pool's
   favour, the way the contracts do. Convert to `number` only at the human-facing edge with
   `rawToHuman`, and from human input with `humanToRaw`. Never `Number(amount)` in the middle of a
   computation, never `parseFloat` on a decimal string, never `JSON.stringify` a bigint directly:
   use `toJsonSafe` / `jsonStringify` and revive with `reviveBigints(value, BIGINT_KEYS)`. If you
   add a bigint-valued property to a stored or served type, add its name to `BIGINT_KEYS`.
4. **Addresses are lowercase.** Normalise on the way in; never compare case-sensitively.
5. **Hermetic tests.** `pnpm test` never reaches the network: the only sockets are loopback
   servers on `127.0.0.1` that a test starts itself (the API, `serve` and `start` servers, a webhook
   receiver, a fixture JSON-RPC endpoint). Chain code is tested through `createFixtureTransport`
   with hand-built or recorded responses; db and API tests use `openDatabase(':memory:')` and
   `app.request()`; the web uses the mock client. A test that needs the network is a bug.
6. **Every metric is defined once, in `docs/METRICS.md`, and implemented once, in core.** The CLI,
   API and dashboard only call core; they never re-derive a number.
7. **Never extrapolate pool state.** A `ConcentratedState` says which ticks it knows; simulations
   stop at the bound and report `complete = false`. Do not fill in liquidity that was not read.
8. **TypeScript strictness.** `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax` are
   on: handle `undefined` from index access, use `import type` for types, and write relative
   imports with the `.js` extension (`./types.js`), which tsx, Vitest and Vite resolve to `.ts`.
9. **Keep modules small.** Files stay under roughly 400 lines; split by responsibility. No TODO
   stubs: a pull request either implements a thing or does not mention it.
10. **No secrets in the repository.** `.env` is git-ignored; `.env.example` holds only defaults.

## How to add a metric

A metric exists in four places, in this order:
1. **Define it in [docs/METRICS.md](docs/METRICS.md).** Formula, units, the exact null semantics
   (when is it unknown, what does the score do then), conventions it relies on (price orientation,
   which side is which) and a worked example with numbers. If the definition cannot be written
   down precisely, it is not ready to implement.
2. **Implement it in `packages/core/src/metrics/`.** One module, one exported function over
   `PoolState` and/or stored samples, no I/O. If it needs new shared types, add them to
   `types.ts` and DESIGN.md. Tests: the worked example from METRICS.md reproduced to the digit,
   the null cases, and a property test where one applies (for example monotonicity in the input).
   Export from `packages/core/src/index.ts`.
3. **Compute and store it.** Call it from the right CLI step (`snapshot` for per-state metrics,
   `score` for metrics over time) and store it in the matching JSON column; append a migration in
   `packages/db/src/schema.ts` if a new column is needed (never edit a shipped migration). If the
   dashboard will sort by it, add a denormalised REAL column and fill it in the repository's
   insert, following `depth2_usd` / `health_total`.
4. **Surface it.** Add it to the API response (extend the zod schema and the `PoolSummary` or
   detail payload), to the dashboard DTOs in `apps/web/src/api/types.ts` and mock JSON, and to a
   component. Update the metrics table in the README.

If the metric feeds the Liquidity Health Score, its weight and the neutral value for the null case
go into METRICS.md and `HEALTH_MAX` in the same change, with the score tests updated.

## How to add a DEX adapter

See the step-by-step list in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#adding-a-dex-adapter).
In short: map the DEX to an existing `PoolState` kind if at all possible, add the `Dex` literal and
addresses, implement discovery, overview, state, swaps and positions readers producing the shared
types, and test every reader through the fixture transport.

## Base name and brand

Depthwatch is an independent project: it is not a Base partner and is not endorsed by Base. It
reads Base mainnet over JSON-RPC and deploys nothing on Base, so no page, badge, post or listing
says or implies a partnership or an endorsement. Write the name as "Base" and "onchain" as one
word.

Base's name, logo and "Built on Base" style marks are Base's brand, not the project's. Before
any of them appears in the README, the dashboard, badges, social posts or a directory listing,
the use must follow Base's brand guidelines at <https://base.org/brand>, in particular the
partnership rules (<https://base.org/brand/partnerships>) and the core identifiers
(<https://base.org/brand/core-identifiers>). Read the current pages on base.org at the time of the
change; the repository has no copy of them, and a pull request that adds a Base mark says which
page it follows.

## Pull requests

- One concern per pull request; a refactor and a behaviour change are two pull requests.
- The description says what changed, why, and how it was verified (which commands, which fixture).
- Changes to a metric's definition, to `types.ts`, to the schema or to the API shape call it out
  in the first line of the description.
- Keep commit subjects short and imperative ("add Slipstream ticks() decoding").
- CI must be green. If a check is flaky, fix the flake; do not retry until it passes.

## Reporting problems

Open an issue with the pool id, the block number, the command you ran and what you expected. For
metric disagreements, include the inputs (the `PoolState` or the stored snapshot JSON) so the case
can be turned into a core test. Please do not report security issues in public issues; follow
[SECURITY.md](SECURITY.md) instead, which describes the private reporting channel.
