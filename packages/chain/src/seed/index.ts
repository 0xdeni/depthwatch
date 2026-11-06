/**
 * `ChainReader.seedPools`: pool discovery without `eth_getLogs`, for endpoints that cannot serve
 * factory log scans (Alchemy's free tier: 10-block ranges). Each DEX is asked directly for the
 * pools of a token list (./candidates.ts, ./aero.ts: a dozen multicalls in all at the seed block),
 * then each pool's creation block is found by binary search over archive state (./createdAt.ts,
 * about 26 to 28 requests per pool, the log2 of the height, which grows 432,000 blocks a day since
 * Denim; skipped for pools whose creation block is already known), in batches whose
 * pools are handed to `onPools` as each one completes. The PoolMeta are the ones log discovery
 * produces for the same pools. Pairs outside the token list, hooked v4 pools and
 * non-standard v4 tiers are not found this way. The DEX seeders run independently: one whose
 * factory views fail (an outage of one contract, a factory whose interface changed) is reported in
 * `SeedResult.failed` and the other DEXes' pools are still dated and returned.
 */
import { type Address, DEXES, type Dex, type PoolMeta } from '@depthwatch/core'
import type { BackoffEvent } from '../internal/backoff.js'
import type { ReaderContext } from '../internal/context.js'
import { errorSummary } from '../internal/errorText.js'
import { seedAeroSlipstream, seedAeroV2 } from './aero.js'
import {
  type DexSeed,
  type DexSeeder,
  seedAerodromeV2,
  seedSlipstream,
  seedUniswapV3,
  seedUniswapV4,
} from './candidates.js'
import { type CreationSearchProgress, findCreationBlocks } from './createdAt.js'

export type { BackoffEvent } from '../internal/backoff.js'
export {
  type DexSeed,
  type DexSeeder,
  sortedPairs,
  UNISWAP_V3_CANDIDATE_FEES,
  UNISWAP_V4_STANDARD_KEYS,
} from './candidates.js'
export {
  type CreationProbe,
  type CreationSearchProgress,
  type CreationTarget,
  probesFor,
  slot0SqrtPrice,
  v4Slot0Slot,
} from './createdAt.js'

/** The seeder of every DEX (./candidates.ts, ./aero.ts). */
export const SEEDERS: Readonly<Record<Dex, DexSeeder>> = Object.freeze({
  'uniswap-v3': seedUniswapV3,
  'uniswap-v4': seedUniswapV4,
  'aerodrome-v2': seedAerodromeV2,
  'aerodrome-slipstream': seedSlipstream,
  'aero-v2': seedAeroV2,
  'aero-slipstream': seedAeroSlipstream,
})

/** Requests in flight during the creation-block search. */
export const DEFAULT_SEED_CONCURRENCY = 4
/** Pools per creation-search batch; each finished batch is reported through `onPools`. */
export const DEFAULT_SEED_BATCH = 50

export interface SeedProgress {
  /** Pools dated so far by the search, of `total`. */
  done: number
  total: number
  /** Requests of the creation-block search so far. */
  requests: number
}

export interface SeedPoolsOptions {
  /** Default: every DEX (`DEXES`). */
  dexes?: readonly Dex[]
  /**
   * Tokens whose pairs are asked for (default: `addresses.referenceTokens`). Native ETH
   * (address 0) only pairs on Uniswap v4; the other DEXes pair the ERC-20s.
   */
  tokens?: readonly Address[]
  /** Block of every factory read and upper bound of the creation search (default: latest). */
  blockNumber?: bigint
  /** A creation block already known for a pool id (e.g. stored); that pool is not searched. */
  knownCreatedAt?: (poolId: string) => bigint | undefined
  /** Requests in flight during the creation-block search (default DEFAULT_SEED_CONCURRENCY). */
  concurrency?: number
  /** Pools per search batch (default DEFAULT_SEED_BATCH). */
  batchSize?: number
  /**
   * Pools as soon as they are complete: those with a known creation block first, then each search
   * batch, so a caller that stores them loses at most one batch when the search fails.
   */
  onPools?: (pools: PoolMeta[], progress: SeedProgress) => void
  /** After every round of the creation-block search (rounds restart with each batch). */
  onSearchRound?: (progress: CreationSearchProgress) => void
  /** Each backoff of a rate-limited or transient search request (the reader's `logRetry` policy). */
  onRetry?: (event: BackoffEvent) => void
}

export interface SeedDexResult {
  dex: Dex
  /** Keys asked for: pairs × fee tiers, stable flags, tick spacings or PoolKeys. */
  candidates: number
  /** Pools found, all in `SeedResult.pools`. */
  found: number
  /** Pools whose creation block was searched; the others were known. */
  searched: number
}

/** A DEX whose seeder failed: none of its pools are in the result. */
export interface SeedDexFailure {
  dex: Dex
  /** One line (errorText.ts), never a request body or an endpoint's key. */
  error: string
}

export interface SeedResult {
  blockNumber: bigint
  pools: PoolMeta[]
  /** The DEXes whose seeder succeeded. */
  dexes: SeedDexResult[]
  /** The DEXes whose seeder failed, in `dexes` order of the options. */
  failed: SeedDexFailure[]
  /** Requests of the creation-block search (`eth_getCode`, multicalls for v4), retries aside. */
  searchRequests: number
  /** Rounds over all batches. */
  searchRounds: number
}

function positive(value: number, what: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new RangeError(`${what} must be a positive integer`)
  return value
}

export async function seedPools(
  ctx: ReaderContext,
  blockNumber: bigint,
  opts: SeedPoolsOptions = {},
): Promise<SeedResult> {
  const concurrency = positive(opts.concurrency ?? DEFAULT_SEED_CONCURRENCY, 'seed concurrency')
  const batchSize = positive(opts.batchSize ?? DEFAULT_SEED_BATCH, 'seed batch size')
  const tokens = opts.tokens ?? ctx.addresses.referenceTokens.map((t) => t.address)
  const dexes = opts.dexes ?? DEXES
  const settled = await Promise.allSettled(
    dexes.map((dex) => SEEDERS[dex](ctx, blockNumber, tokens)),
  )
  const seeds: DexSeed[] = []
  const failed: SeedDexFailure[] = []
  settled.forEach((outcome, i) => {
    const dex = dexes[i] as Dex
    if (outcome.status === 'fulfilled') seeds.push(outcome.value)
    else failed.push({ dex, error: errorSummary(outcome.reason) })
  })
  const known = new Map<string, bigint>()
  const unknown = seeds.flatMap((seed) =>
    seed.targets.filter((target) => {
      const block = opts.knownCreatedAt?.(target.id)
      if (block !== undefined) known.set(target.id, block)
      return block === undefined
    }),
  )
  const pools: PoolMeta[] = []
  const progress: SeedProgress = { done: 0, total: unknown.length, requests: 0 }
  let rounds = 0
  const emit = async (createdAt: ReadonlyMap<string, bigint>) => {
    const built = (await Promise.all(seeds.map((seed) => seed.build(createdAt)))).flat()
    for (const pool of built) pools.push(pool) // not push(...built): no spread over long lists
    opts.onPools?.(built, { ...progress })
  }
  if (known.size > 0) await emit(known)
  for (let i = 0; i < unknown.length; i += batchSize) {
    const batch = unknown.slice(i, i + batchSize)
    const search = await findCreationBlocks(ctx, batch, blockNumber, {
      concurrency,
      onRound: opts.onSearchRound,
      onRetry: opts.onRetry,
    })
    progress.done += batch.length
    progress.requests += search.requests
    rounds += search.rounds
    await emit(search.blocks)
  }
  const searched = new Set(unknown.map((t) => t.id))
  return {
    blockNumber,
    pools,
    dexes: seeds.map((seed) => ({
      dex: seed.dex,
      candidates: seed.candidates,
      found: seed.targets.length,
      searched: seed.targets.filter((t) => searched.has(t.id)).length,
    })),
    failed,
    searchRequests: progress.requests,
    searchRounds: rounds,
  }
}
