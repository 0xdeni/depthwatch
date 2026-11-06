/**
 * Stock aggregates (docs/METRICS.md, "Stock aggregates"): one stock across every pool that trades
 * it. A pool counts in the depth sums, the spread and the deepest-pool choice when its quote is not
 * stale and its stock's transfers are not paused, at its snapshot or at a newer reading; TVL and
 * volume take every pool.
 */

import { type Address, DEXES } from '../types.js'
import type {
  StockAggregate,
  StockDeviationNull,
  StockPassDepth,
  StockPoolInput,
  StockReading,
  StockVenue,
} from './types.js'

const lower = (address: Address): string => address.toLowerCase()

const known = (x: number | null): x is number => x !== null && Number.isFinite(x)

/** Σ and count of the known values; the sum is null when none is known. */
function sumKnown(values: readonly (number | null)[]): { sum: number | null; count: number } {
  const present = values.filter(known)
  return {
    sum: present.length === 0 ? null : present.reduce((a, b) => a + b, 0),
    count: present.length,
  }
}

/**
 * A pool's ±2 % levels oriented to the stock: `buyUsd` is the side whose input is the quote
 * (`depth2UpUsd` when the stock is token0, `depth2DownUsd` when it is token1), `sellUsd` the other.
 */
export function stockSides(
  stock: Address,
  token0: Address,
  depth2UpUsd: number | null,
  depth2DownUsd: number | null,
): { buyUsd: number | null; sellUsd: number | null } {
  return lower(stock) === lower(token0)
    ? { buyUsd: depth2UpUsd, sellUsd: depth2DownUsd }
    : { buyUsd: depth2DownUsd, sellUsd: depth2UpUsd }
}

/**
 * A pool counts in a stock's sums: its quote is not stale, its snapshot does not find its stock's
 * transfers paused, and no newer reading of the stock does (`pausedByNewerReading`).
 */
export function countsInStockSums(pool: StockPoolInput): boolean {
  return (
    !pool.staleQuote &&
    pool.reference?.transfersPaused !== true &&
    pool.pausedByNewerReading !== true
  )
}

/**
 * Whether the newest reading of one of a pool's stocks pauses the pool after its snapshot: taken at
 * a later block than the snapshot (or the pool has none), it finds that stock's transfers paused
 * (docs/METRICS.md, "Stock aggregates"). A newer reading that finds them resumed changes nothing:
 * a pool whose own snapshot found them paused stays out until a newer snapshot of it.
 */
export function newerReadingPauses(
  snapshotBlock: bigint | null,
  readings: readonly (Pick<StockReading, 'blockNumber' | 'transfersPaused'> | undefined)[],
): boolean {
  return readings.some(
    (r) =>
      r !== undefined &&
      r.transfersPaused === true &&
      (snapshotBlock === null || r.blockNumber > snapshotBlock),
  )
}

interface Row {
  pool: StockPoolInput
  buyUsd: number | null
  sellUsd: number | null
  counts: boolean
  /** Counted with both sides known: in the depth sums. */
  inSums: boolean
}

/** The larger thinner side, then the larger total, then the lower pool id. */
function deeper(a: Row, b: Row): Row {
  const [aBuy, aSell, bBuy, bSell] = [a.buyUsd ?? 0, a.sellUsd ?? 0, b.buyUsd ?? 0, b.sellUsd ?? 0]
  const thinA = Math.min(aBuy, aSell)
  const thinB = Math.min(bBuy, bSell)
  if (thinA !== thinB) return thinA > thinB ? a : b
  if (aBuy + aSell !== bBuy + bSell) return aBuy + aSell > bBuy + bSell ? a : b
  return a.pool.poolId <= b.pool.poolId ? a : b
}

/** The stock's pools on one DEX, before shares. */
function venueOf(
  dex: StockVenue['dex'],
  rows: readonly Row[],
): Omit<StockVenue, 'depthShare' | 'volumeShare'> {
  const depth = sumKnown(
    rows.filter((r) => r.inSums).map((r) => (r.buyUsd ?? 0) + (r.sellUsd ?? 0)),
  )
  return {
    dex,
    poolCount: rows.length,
    depth2Usd: depth.sum,
    volume24hUsd: sumKnown(rows.map((r) => r.pool.volume24hUsd)).sum,
  }
}

const share = (part: number | null, total: number | null): number | null =>
  part === null || total === null || total === 0 ? null : part / total

/**
 * One stock across its pools (docs/METRICS.md, "Stock aggregates"). Pools that do not hold `token`
 * are ignored. The deviation is the deepest pool's; a deepest pool whose snapshot has no reference
 * (stored before schema version 8) gives `unread`, and no deepest pool gives `no-pool`.
 */
export function summarizeStock(token: Address, pools: readonly StockPoolInput[]): StockAggregate {
  const stock = lower(token)
  const rows: Row[] = pools
    .filter((p) => lower(p.token0) === stock || lower(p.token1) === stock)
    .map((pool) => {
      const { buyUsd, sellUsd } = stockSides(
        token,
        pool.token0,
        pool.depth2UpUsd,
        pool.depth2DownUsd,
      )
      const counts = countsInStockSums(pool)
      return { pool, buyUsd, sellUsd, counts, inSums: counts && known(buyUsd) && known(sellUsd) }
    })

  const tvl = sumKnown(rows.map((r) => r.pool.tvlUsd))
  const volume = sumKnown(rows.map((r) => r.pool.volume24hUsd))
  const inSums = rows.filter((r) => r.inSums)
  const buy = sumKnown(inSums.map((r) => r.buyUsd))
  const sell = sumKnown(inSums.map((r) => r.sellUsd))
  const depthTotal = buy.sum === null || sell.sum === null ? null : buy.sum + sell.sum

  let spread: { bps: number; poolId: string } | null = null
  for (const { pool, counts } of rows) {
    const bps = pool.spread10kBps
    if (!counts || !known(bps)) continue
    if (spread === null || bps < spread.bps || (bps === spread.bps && pool.poolId < spread.poolId))
      spread = { bps, poolId: pool.poolId }
  }

  const venues: StockVenue[] = DEXES.flatMap((dex) => {
    const own = rows.filter((r) => r.pool.dex === dex)
    if (own.length === 0) return []
    const venue = venueOf(dex, own)
    return [
      {
        ...venue,
        depthShare: share(venue.depth2Usd, depthTotal),
        volumeShare: share(venue.volume24hUsd, volume.sum),
      },
    ]
  })

  const deepest = inSums.length === 0 ? null : inSums.reduce(deeper)
  const reference = deepest?.pool.reference ?? null
  const deviationNull: StockDeviationNull | null =
    deepest === null ? 'no-pool' : reference === null ? 'unread' : reference.deviationNull

  return {
    token: stock as Address,
    poolCount: rows.length,
    tvlUsd: tvl.sum,
    tvlKnownPools: tvl.count,
    depth2BuyUsd: buy.sum,
    depth2SellUsd: sell.sum,
    sidesKnownPools: inSums.length,
    spread10kBps: spread?.bps ?? null,
    spread10kPoolId: spread?.poolId ?? null,
    volume24hUsd: volume.sum,
    volumeKnownPools: volume.count,
    venues,
    deepestPoolId: deepest?.pool.poolId ?? null,
    deviationBps: reference?.deviationBps ?? null,
    withinTolerance: reference?.withinTolerance ?? null,
    deviationNull,
  }
}

/** The part of a stock's aggregate the snapshot step stores with each reading. */
export function stockPassDepth(aggregate: StockAggregate): StockPassDepth {
  const { depth2BuyUsd, depth2SellUsd, sidesKnownPools, deepestPoolId } = aggregate
  const { deviationBps, withinTolerance, deviationNull } = aggregate
  return {
    depth2BuyUsd,
    depth2SellUsd,
    sidesKnownPools,
    deepestPoolId,
    deviationBps,
    withinTolerance,
    deviationNull,
  }
}
