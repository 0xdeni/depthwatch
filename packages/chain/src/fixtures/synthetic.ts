/**
 * `createSyntheticFixture`: a complete offline Base world for the CLI demo and end-to-end tests.
 * Run the whole pipeline through `createChainReader({ transport: createFixtureTransport(fixture) })`.
 *
 * Contents: token metadata, factory/PoolManager creation logs, state at `latest` and at
 * `latestBlock`, ~24 h of Swap logs per pool, NFPM/PositionManager position logs and reads, and a
 * block clock (2 s per block, Base's spacing before Denim; the default anchor is before block
 * 53 556 127) so any block ≤ latest resolves. With an epoch, the same contents
 * describe the time-varying world at that moment (syntheticTime.ts, syntheticHistory.ts).
 */
import { type Address, NATIVE_ETH } from '@depthwatch/core'
import { aerodromeCLFactoryAbi } from '../abi/aerodromeCLFactory.js'
import { aerodromePoolAbi } from '../abi/aerodromePool.js'
import { aerodromePoolFactoryAbi } from '../abi/aerodromePoolFactory.js'
import { erc20Abi } from '../abi/erc20.js'
import { uniswapV3FactoryAbi } from '../abi/uniswapV3Factory.js'
import { v4PoolManagerAbi } from '../abi/v4PoolManager.js'
import { slipstreamPoolId } from '../adapters/aerodromeSlipstream.js'
import { aerodromeV2PoolId } from '../adapters/aerodromeV2.js'
import { aeroSlipstreamPoolId } from '../adapters/aeroSlipstream.js'
import { aeroV2PoolId } from '../adapters/aeroV2.js'
import { uniswapV3PoolId } from '../adapters/uniswapV3.js'
import { BASE_ADDRESSES, type ChainAddresses } from '../addresses.js'
import { createFixture, type Fixture, type FixtureLog } from '../transport/fixture.js'
import { addLogs, type BlockRef, makeLog, registerCall, setClock } from './builders.js'
import { aeroCreationLog, registerAeroV2Fee } from './syntheticAero.js'
import { registerConcentratedPool } from './syntheticConcentrated.js'
import { registerV2LpHoldings } from './syntheticGauges.js'
import { positionHistoryLogs, swapHistoryLogs } from './syntheticHistory.js'
import { swapLogs } from './syntheticSwaps.js'
import {
  SLIPSTREAM_INITIAL_FACTORY_INDEX,
  SYNTHETIC_POOL_LABELS,
  type SyntheticConcentratedPool,
  type SyntheticOptions,
  type SyntheticPool,
  type SyntheticV2Pool,
  type SyntheticWorld,
  syntheticPoolAddress,
} from './syntheticTypes.js'
import { syntheticWorld } from './syntheticWorld.js'

export {
  aeroHookFeeAt,
  SYNTHETIC_AERO_HOOK_CONFIG,
  SYNTHETIC_AERO_START_OFFSET,
  syntheticAddresses,
} from './syntheticAero.js'
export {
  aeroMarketMakerOut,
  priceFactor as syntheticPriceFactor,
  resolveTimeline as resolveSyntheticTimeline,
  SYNTHETIC_DRIFT,
  SYNTHETIC_EVENTS,
  SYNTHETIC_HISTORY,
  type SyntheticAsset,
  type SyntheticEventState,
  slipstreamMarketMakerDipped,
  syntheticEventsAt,
} from './syntheticTime.js'
export type {
  SyntheticConcentratedPool,
  SyntheticLpHolding,
  SyntheticOptions,
  SyntheticPool,
  SyntheticPosition,
  SyntheticTimeline,
  SyntheticV2Pool,
  SyntheticWorld,
} from './syntheticTypes.js'
export {
  fakeAddress,
  SYNTHETIC_DEFAULTS,
  SYNTHETIC_GAUGES,
  SYNTHETIC_OWNERS,
  SYNTHETIC_POOL_LABELS,
  SYNTHETIC_PRICES,
  SYNTHETIC_ROUTER,
  syntheticGaugeAddress,
  syntheticPoolAddress,
} from './syntheticTypes.js'
export { syntheticWorld } from './syntheticWorld.js'

/** `PoolMeta.id` of the address-keyed synthetic pools (the v4 pool's id is derived from its key). */
export const SYNTHETIC_POOL_IDS: Readonly<
  Record<Exclude<keyof typeof SYNTHETIC_POOL_LABELS, 'ethUsdcV4'>, string>
> = Object.freeze({
  wethUsdcV3: uniswapV3PoolId(syntheticPoolAddress(SYNTHETIC_POOL_LABELS.wethUsdcV3)),
  cbbtcUsdcV3: uniswapV3PoolId(syntheticPoolAddress(SYNTHETIC_POOL_LABELS.cbbtcUsdcV3)),
  usdcAeroV2: aerodromeV2PoolId(syntheticPoolAddress(SYNTHETIC_POOL_LABELS.usdcAeroV2)),
  usdcUsdbcV2: aerodromeV2PoolId(syntheticPoolAddress(SYNTHETIC_POOL_LABELS.usdcUsdbcV2)),
  wethUsdcSlipstream: slipstreamPoolId(
    syntheticPoolAddress(SYNTHETIC_POOL_LABELS.wethUsdcSlipstream),
  ),
  aeroUsdcAeroV2: aeroV2PoolId(syntheticPoolAddress(SYNTHETIC_POOL_LABELS.aeroUsdcAeroV2)),
  wethUsdcAeroSlipstream: aeroSlipstreamPoolId(
    syntheticPoolAddress(SYNTHETIC_POOL_LABELS.wethUsdcAeroSlipstream),
  ),
})

function registerTokens(fixture: Fixture, world: SyntheticWorld): void {
  const seen = new Set<Address>()
  for (const pool of world.pools) {
    for (const token of [pool.meta.token0, pool.meta.token1]) {
      if (token.address === NATIVE_ETH || seen.has(token.address)) continue
      seen.add(token.address)
      registerCall(fixture, {
        to: token.address,
        abi: erc20Abi,
        functionName: 'symbol',
        result: token.symbol,
      })
      registerCall(fixture, {
        to: token.address,
        abi: erc20Abi,
        functionName: 'name',
        result: token.name,
      })
      registerCall(fixture, {
        to: token.address,
        abi: erc20Abi,
        functionName: 'decimals',
        result: token.decimals,
      })
    }
  }
}

function creationLog(pool: SyntheticPool, addresses: ChainAddresses): FixtureLog {
  const { meta } = pool
  const blockNumber = meta.createdAtBlock
  switch (meta.dex) {
    case 'uniswap-v3':
      return makeLog({
        address: addresses.uniswapV3.factory,
        abi: uniswapV3FactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: meta.token0.address,
          token1: meta.token1.address,
          fee: meta.feePips,
          tickSpacing: meta.tickSpacing,
          pool: meta.address,
        },
        blockNumber,
        logIndex: 0,
      })
    case 'uniswap-v4': {
      const state = (pool as SyntheticConcentratedPool).state
      return makeLog({
        address: addresses.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        eventName: 'Initialize',
        args: {
          id: meta.poolId,
          currency0: meta.token0.address,
          currency1: meta.token1.address,
          fee: meta.feePips,
          tickSpacing: meta.tickSpacing,
          hooks: meta.hooks,
          sqrtPriceX96: state.sqrtPriceX96,
          tick: state.tick,
        },
        blockNumber,
        logIndex: 0,
      })
    }
    case 'aerodrome-v2':
      return makeLog({
        address: addresses.aerodromeV2.poolFactory,
        abi: aerodromePoolFactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: meta.token0.address,
          token1: meta.token1.address,
          stable: meta.stable,
          pool: meta.address,
          length: 1n,
        },
        blockNumber,
        logIndex: 0,
      })
    case 'aerodrome-slipstream': {
      const factory = addresses.aerodromeSlipstream[SLIPSTREAM_INITIAL_FACTORY_INDEX]?.factory
      if (!factory) throw new Error('synthetic: no Slipstream deployment configured')
      return makeLog({
        address: factory,
        abi: aerodromeCLFactoryAbi,
        eventName: 'PoolCreated',
        args: {
          token0: meta.token0.address,
          token1: meta.token1.address,
          tickSpacing: meta.tickSpacing,
          pool: meta.address,
        },
        blockNumber,
        logIndex: 0,
      })
    }
    case 'aero-v2':
    case 'aero-slipstream':
      return aeroCreationLog(meta, addresses)
  }
}

function registerV2Pool(
  fixture: Fixture,
  world: SyntheticWorld,
  pool: SyntheticV2Pool,
  addresses: ChainAddresses,
): void {
  const to = pool.meta.address as Address
  const blocks: BlockRef[] = ['latest', world.latestBlock]
  registerCall(fixture, {
    to,
    abi: aerodromePoolAbi,
    functionName: 'getReserves',
    result: [pool.reserve0, pool.reserve1, BigInt(world.latestTimestamp)],
    blocks,
  })
  registerCall(fixture, {
    to,
    abi: aerodromePoolAbi,
    functionName: 'token0',
    result: pool.meta.token0.address,
    blocks,
  })
  registerCall(fixture, {
    to,
    abi: aerodromePoolAbi,
    functionName: 'token1',
    result: pool.meta.token1.address,
    blocks,
  })
  if (pool.meta.dex === 'aero-v2') {
    registerAeroV2Fee(fixture, pool, addresses, blocks)
    return
  }
  registerCall(fixture, {
    to,
    abi: aerodromePoolAbi,
    functionName: 'stable',
    result: pool.meta.stable,
    blocks,
  })
  registerCall(fixture, {
    to: addresses.aerodromeV2.poolFactory,
    abi: aerodromePoolFactoryAbi,
    functionName: 'getFee',
    args: [to, pool.meta.stable],
    result: pool.feeBps,
    blocks,
  })
}

/**
 * The synthetic world as a fixture. Without an epoch: the static world at `latestBlock`. With
 * `epochTimestamp` / `epochBlock`: the time-varying world's state at that moment (the fixture's
 * head is the epoch block), with every position mint and hourly rebalance before it and the 24 h
 * of swaps before it. Same options (and seed) ⇒ identical fixture.
 */
export function createSyntheticFixture(
  opts: SyntheticOptions = {},
  addresses: ChainAddresses = BASE_ADDRESSES,
): Fixture {
  const world = syntheticWorld(opts)
  const fixture = createFixture()
  setClock(fixture, {
    latestBlock: world.latestBlock,
    latestTimestamp: world.latestTimestamp,
    secondsPerBlock: world.secondsPerBlock,
  })
  registerTokens(fixture, world)
  addLogs(
    fixture,
    world.pools.map((p) => creationLog(p, addresses)),
  )
  world.pools.forEach((pool, i) => {
    if (pool.kind === 'concentrated') registerConcentratedPool(fixture, world, pool, addresses)
    else {
      registerV2Pool(fixture, world, pool, addresses)
      registerV2LpHoldings(fixture, world, pool, addresses)
    }
    addLogs(
      fixture,
      world.timeline === null
        ? swapLogs(world, pool, addresses, 1_000 + i)
        : [...positionHistoryLogs(world, i, addresses), ...swapHistoryLogs(world, i, addresses)],
    )
  })
  return fixture
}
