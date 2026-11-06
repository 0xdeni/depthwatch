/**
 * Seeded discovery of the Aero DEXes (see ./candidates.ts for the others).
 *
 * - Aero v2: `getPool(token0, token1)` (the 2-argument form, either token order) on the volatile
 *   and on the stable factory for every ERC-20 pair of the seed; the factory that answers gives the pool's
 *   kind. The 3-argument `getPool(a, b, stable)` of Aerodrome reverts on these factories. Both
 *   factories' `feeModule()` rides along: a factory off its pinned module fails the DEX before
 *   any creation block is searched.
 * - Aero Slipstream: the Slipstream seeder over `aeroSlipstream`'s deployments; the PoolMeta build
 *   reads every found pool's swap hook again, known pools included.
 *
 * Creation blocks are searched from the factories' start blocks (`aeroV2.startBlock`, each
 * deployment's `startBlock`).
 */
import { aeroPoolFactoryAbi } from '../abi/aeroPoolFactory.js'
import { aeroSlipstreamFamily } from '../adapters/aeroSlipstream.js'
import { aeroV2FeeModuleGuard, aeroV2PoolId, aeroV2PoolMetas } from '../adapters/aeroV2.js'
import { multicallBatched } from '../internal/multicall.js'
import {
  codeTarget,
  type DexSeeder,
  dated,
  erc20Pairs,
  poolAddress,
  slipstreamSeeder,
} from './candidates.js'

export const seedAeroV2: DexSeeder = async (ctx, block, pairs) => {
  const { volatileFactory, stableFactory, startBlock } = ctx.addresses.aeroV2
  const keys = erc20Pairs(pairs).flatMap(([token0, token1]) =>
    [volatileFactory, stableFactory].map((factory) => ({ token0, token1, factory })),
  )
  const guard = aeroV2FeeModuleGuard(ctx)
  const results = await multicallBatched(
    ctx,
    [
      ...guard.calls,
      ...keys.map((k) => ({
        address: k.factory,
        abi: aeroPoolFactoryAbi,
        functionName: 'getPool',
        args: [k.token0, k.token1],
      })),
    ],
    block,
  )
  guard.check(results)
  const records = keys.flatMap((k, i) => {
    const what = `aero-v2 getPool(${k.token0}, ${k.token1}) on ${k.factory}`
    const pool = poolAddress(results[guard.calls.length + i], what)
    return pool === undefined ? [] : [{ ...k, pool }]
  })
  return {
    dex: 'aero-v2',
    candidates: keys.length,
    targets: records.map((r) => codeTarget(aeroV2PoolId(r.pool), r.pool, startBlock)),
    build: (createdAt) =>
      aeroV2PoolMetas(
        ctx,
        dated(records, (r) => aeroV2PoolId(r.pool), createdAt),
      ),
  }
}

export const seedAeroSlipstream: DexSeeder = slipstreamSeeder(aeroSlipstreamFamily)
