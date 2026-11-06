/**
 * `readSwaps`'s log scans: one per distinct `Swap` event source, not one per DEX. Adapters whose
 * pools emit the same event share their `swaps` function (Uniswap v3 and both Slipstreams use
 * `readV3StyleSwaps`, Aerodrome v2 and Aero v2 `readV2StyleSwaps`: identical `Swap` signature,
 * identical topic0), so their pools go into one filter per range: three scans for six DEXes, which
 * saves an `eth_getLogs` per chunk and merged DEX on a 10-block plan. Every scan reports its chunks
 * and backoffs to one `SwapScanProgress`.
 */
import { DEXES, type Dex, type PoolMeta, type SwapEvent } from '@depthwatch/core'
import { ADAPTERS } from '../adapters/index.js'
import type { ReaderContext } from './context.js'
import type { LogScanObserver } from './logs.js'

/** Progress of one `readSwaps` call, summed over its scans. */
export interface SwapScanProgress {
  /** Log scans running: one per swap event source with pools. */
  scans: number
  /** Blocks served so far, over all scans. */
  blocksDone: bigint
  /** `scans × (toBlock − fromBlock + 1)`. */
  blocksTotal: bigint
  /** `eth_getLogs` chunks served so far. */
  chunks: number
  /** Backoffs so far: rate limited (HTTP 429 and the like) and transient (5xx, timeouts). */
  rateLimited: number
  transient: number
}

export interface ReadSwapsOptions {
  /** After every chunk and every backoff of any scan. */
  onProgress?: (progress: Readonly<SwapScanProgress>) => void
}

/** The DEX whose scan reads `dex`'s swaps: the first DEX (in DEXES order) with the same reader. */
export function swapScanOf(dex: Dex): Dex {
  const reader = ADAPTERS[dex].swaps
  return DEXES.find((other) => ADAPTERS[other].swaps === reader) ?? dex
}

/** Pools grouped by `swapScanOf`, in DEXES order. */
export function swapScanGroups(pools: readonly PoolMeta[]): Map<Dex, PoolMeta[]> {
  const groups = new Map<Dex, PoolMeta[]>()
  for (const dex of DEXES) {
    const scan = swapScanOf(dex)
    for (const pool of pools) {
      if (pool.dex !== dex) continue
      const group = groups.get(scan) ?? []
      group.push(pool)
      groups.set(scan, group)
    }
  }
  return groups
}

function compareEvents(a: SwapEvent, b: SwapEvent): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
  return a.logIndex - b.logIndex
}

/**
 * Swap events of `pools` over the range, without timestamps, scan by scan (in parallel), merged in
 * chain order (block, then log index).
 */
export async function readSwapScans(
  ctx: ReaderContext,
  pools: readonly PoolMeta[],
  fromBlock: bigint,
  toBlock: bigint,
  opts: ReadSwapsOptions = {},
): Promise<SwapEvent[]> {
  const groups = swapScanGroups(pools)
  const progress: SwapScanProgress = {
    scans: groups.size,
    blocksDone: 0n,
    blocksTotal: BigInt(groups.size) * (toBlock - fromBlock + 1n),
    chunks: 0,
    rateLimited: 0,
    transient: 0,
  }
  const emit = () => opts.onProgress?.({ ...progress })
  const observer: LogScanObserver = {
    chunk: (from, to) => {
      progress.blocksDone += to - from + 1n
      progress.chunks++
      emit()
    },
    retry: (event) => {
      if (event.reason === 'rate-limit') progress.rateLimited++
      else progress.transient++
      emit()
    },
  }
  const perScan = await Promise.all(
    [...groups].map(([dex, group]) =>
      ADAPTERS[dex].swaps(ctx, group, fromBlock, toBlock, observer),
    ),
  )
  return perScan.flat().sort(compareEvents)
}
