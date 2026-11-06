/**
 * A stock pool's reference (`PoolSnapshot.reference`, schema version 8, docs/METRICS.md "Reference
 * deviation"): stored with each snapshot and read back on every path; a pool without a stock, and a
 * snapshot stored before version 8, read null.
 */
import type { PoolReference } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type Database, openDatabase } from '../database.js'
import { fixturePoolReference, fixtureSnapshot } from '../fixtures.js'

const STOCK_POOL = 'aero-slipstream:0x000000000000000000000000000000000000c8ec'
const OTHER_POOL = 'uniswap-v3:0x000000000000000000000000000000000000000a'
const UNSEEN = 'uniswap-v3:0x000000000000000000000000000000000000000b'

/** Held on a Saturday: the answer published, no deviation. */
const HELD = fixturePoolReference({
  referenceStatus: 'held',
  feedAgeSeconds: 65_000,
  deviationBps: null,
  toleranceBps: null,
  deviationThresholdBps: null,
  feeBps: null,
  withinTolerance: null,
  deviationNull: 'held',
  transfersPaused: null,
})

const at = (poolId: string, n: number, reference: PoolReference | null = fixturePoolReference()) =>
  fixtureSnapshot({ poolId, blockNumber: BigInt(100 + n), timestamp: 1_000 + n, reference })

describe('SnapshotsRepo: the reference of a stock pool', () => {
  let db: Database
  beforeEach(() => {
    db = openDatabase(':memory:')
  })
  afterEach(() => db.close())

  it('stores each snapshot reference and reads it on every path', () => {
    const first = at(STOCK_POOL, 0)
    const second = at(STOCK_POOL, 1, HELD)
    const plain = fixtureSnapshot({ poolId: OTHER_POOL })
    db.snapshots.insertMany([first, second, plain])
    expect(db.snapshots.seriesForPool(STOCK_POOL, 0).map((s) => s.reference)).toEqual([
      fixturePoolReference(),
      HELD,
    ])
    expect(db.snapshots.latestForPool(STOCK_POOL)).toEqual(second)
    const latest = db.snapshots.latestForPools([STOCK_POOL, OTHER_POOL])
    expect(latest.get(STOCK_POOL)?.reference).toEqual(HELD)
    expect(latest.get(OTHER_POOL)?.reference).toBeNull()
  })

  it('reads the newest snapshot reference of each pool, null without a stock', () => {
    db.snapshots.insertMany([
      at(STOCK_POOL, 0),
      at(STOCK_POOL, 2, HELD),
      // An older snapshot of a pool that held a stock no longer counts.
      at(OTHER_POOL, 0),
      at(OTHER_POOL, 1, null),
    ])
    const references = db.snapshots.latestReferences([STOCK_POOL, OTHER_POOL, UNSEEN])
    expect(references).toEqual(
      new Map([
        [OTHER_POOL, null],
        [STOCK_POOL, HELD],
      ]),
    )
    expect(db.snapshots.latestReferences([]).size).toBe(0)
  })

  it('keeps the first reference stored at a block', () => {
    db.snapshots.insert(at(STOCK_POOL, 0))
    expect(db.snapshots.insert(at(STOCK_POOL, 0, HELD))).toBeNull()
    expect(db.snapshots.latestReferences([STOCK_POOL]).get(STOCK_POOL)).toEqual(
      fixturePoolReference(),
    )
  })
})
