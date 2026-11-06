/**
 * A fixture world for seeded discovery (`ChainReader.seedPools`), shared by the chain and CLI
 * tests: every factory / StateView candidate the seeders ask for (the pairs of `seedPairs` over
 * the reference tokens and the `crossTokens`) answers "no pool" at every block, except the given
 * pools, which answer from their creation block on (contract code, `getPool`, StateView `getSlot0`
 * and the PoolManager slot0 word), so the creation-block search can be run against them. The Aero
 * v2 factories' `feeModule()` answers the pinned module at every block. Token metadata of the
 * reference and cross tokens, Aerodrome v2 `getFee`, Aero v2 `getBaseFee`, Slipstream `fee()` /
 * `tickSpacingToFee` and Aero Slipstream `getPoolSwapHook` / `dynamicFeeConfig` (the reviewed hook,
 * initial fee off unless a pool says otherwise) are registered at `latest`. The clock is the
 * caller's.
 */
import { type Address, type Dex, type Hex, NATIVE_ETH, type TokenInfo } from '@depthwatch/core'
import { numberToHex } from 'viem'
import { aeroCLFactoryAbi } from '../abi/aeroCLFactory.js'
import { aerodromeCLFactoryAbi } from '../abi/aerodromeCLFactory.js'
import { aerodromeCLPoolAbi } from '../abi/aerodromeCLPool.js'
import { aerodromePoolFactoryAbi } from '../abi/aerodromePoolFactory.js'
import { aeroPoolFactoryAbi } from '../abi/aeroPoolFactory.js'
import { aeroSwapHookAbi } from '../abi/aeroSwapHook.js'
import { erc20Abi } from '../abi/erc20.js'
import { uniswapV3FactoryAbi } from '../abi/uniswapV3Factory.js'
import { v4PoolManagerAbi } from '../abi/v4PoolManager.js'
import { v4StateViewAbi } from '../abi/v4StateView.js'
import { computePoolId } from '../adapters/uniswapV4Pools.js'
import type { ChainAddresses } from '../addresses.js'
import {
  erc20Pairs,
  type SeedPair,
  seedPairs,
  UNISWAP_V3_CANDIDATE_FEES,
  UNISWAP_V4_STANDARD_KEYS,
} from '../seed/candidates.js'
import { v4Slot0Slot } from '../seed/createdAt.js'
import type { Fixture } from '../transport/fixture.js'
import { registerCall, registerCallHistory, registerCode } from './builders.js'

export interface SeedWorldPool {
  dex: Dex
  /** Either order: the world sorts them as the factories do. */
  tokens: readonly [Address, Address]
  /** Uniswap v3 fee tier; Uniswap v4 PoolKey fee. */
  fee?: number
  /** Slipstream and Uniswap v4. */
  tickSpacing?: number
  /** Aerodrome v2; Aero v2: created by the stable factory (default: the volatile one). */
  stable?: boolean
  /** Slipstream: index into `addresses.aerodromeSlipstream` / `aeroSlipstream` (default 0). */
  deployment?: number
  /** Contract pools (every DEX but Uniswap v4). */
  address?: Address
  createdAtBlock: bigint
  /** Slipstream `fee()` in pips, Aerodrome v2 `getFee` / Aero v2 `getBaseFee` in bps (3000, 30). */
  liveFee?: number
  /** Aero Slipstream: `getPoolSwapHook` (default: the deployment's reviewed `swapHook`). */
  swapHook?: Address
  /** Aero Slipstream: `initialFeeEnabled` of the reviewed hook's config (default false). */
  initialFeeEnabled?: boolean
  /** Uniswap v4 sqrtPriceX96 once initialized (default 2^96). */
  sqrtPriceX96?: bigint
}

export interface SeedWorldOptions {
  /** Resolved (lowercase) addresses; the reference tokens are the seeded token list. */
  addresses: ChainAddresses
  /** `SeedPoolsOptions.crossTokens` (lowercase): each paired with every reference token. */
  crossTokens?: readonly TokenInfo[]
  pools: readonly SeedWorldPool[]
  /** `feeAmountTickSpacing` per candidate fee; a fee missing here answers 0 (not enabled). */
  v3TickSpacings?: Readonly<Record<number, number>>
  /** `tickSpacings()` per Slipstream deployment (default: the constructor's five). */
  slipstreamTickSpacings?: readonly (readonly number[])[]
  /** `tickSpacings()` per Aero Slipstream deployment (default: the seven read on Base). */
  aeroSlipstreamTickSpacings?: readonly (readonly number[])[]
}

/** The Aero CLFactory's `tickSpacings()` (docs/research/base-contracts.md, `## aero`). */
export const SEED_WORLD_AERO_TICK_SPACINGS: readonly number[] = Object.freeze([
  1, 10, 50, 100, 150, 200, 250,
])

/** `feeAmountTickSpacing` as read on Base (docs/research/base-contracts.md). */
export const SEED_WORLD_V3_TICK_SPACINGS: Readonly<Record<number, number>> = Object.freeze({
  100: 1,
  200: 4,
  300: 6,
  400: 8,
  500: 10,
  3000: 60,
  10000: 200,
})

/** CLFactory constructor tickSpacing → fee (docs/research/base-contracts.md B.1). */
const SLIPSTREAM_DEFAULT_FEES: Readonly<Record<number, number>> = {
  1: 100,
  50: 500,
  100: 500,
  200: 3_000,
  2000: 10_000,
}

const ZERO = NATIVE_ETH
const sortPair = (pair: readonly [Address, Address]) => {
  const [a, b] = pair.map((t) => t.toLowerCase() as Address) as [Address, Address]
  return a < b ? ([a, b] as const) : ([b, a] as const)
}

/** The PoolManager slot0 word: sqrtPriceX96 | tick | protocolFee | lpFee << 208. */
function slot0Word(sqrtPriceX96: bigint, lpFee: number): Hex {
  return numberToHex(sqrtPriceX96 | (BigInt(lpFee) << 208n), { size: 32 })
}

/** Key of one candidate the seeders ask for, as `dex|...` strings. */
function candidateKey(dex: Dex, token0: Address, token1: Address, extra: string): string {
  return `${dex}|${token0}|${token1}|${extra}`
}

function poolsByCandidate(pools: readonly SeedWorldPool[]): Map<string, SeedWorldPool> {
  const out = new Map<string, SeedWorldPool>()
  for (const pool of pools) {
    const [t0, t1] = sortPair(pool.tokens)
    const extra =
      pool.dex === 'aerodrome-v2' || pool.dex === 'aero-v2'
        ? String(pool.stable ?? false)
        : pool.dex === 'aerodrome-slipstream' || pool.dex === 'aero-slipstream'
          ? `${pool.deployment ?? 0}|${pool.tickSpacing}`
          : pool.dex === 'uniswap-v4'
            ? `${pool.fee}|${pool.tickSpacing}`
            : String(pool.fee)
    out.set(candidateKey(pool.dex, t0, t1, extra), pool)
  }
  return out
}

export function registerSeedWorld(fixture: Fixture, opts: SeedWorldOptions): void {
  const { addresses } = opts
  const byCandidate = poolsByCandidate(opts.pools)
  const cross = opts.crossTokens ?? []
  const pairs = seedPairs(
    addresses.referenceTokens.map((t) => t.address),
    cross.map((t) => t.address),
  )
  const erc20 = erc20Pairs(pairs)
  for (const t of [...addresses.referenceTokens, ...cross]) {
    if (t.address === ZERO) continue
    registerCall(fixture, {
      to: t.address,
      abi: erc20Abi,
      functionName: 'symbol',
      result: t.symbol,
    })
    registerCall(fixture, { to: t.address, abi: erc20Abi, functionName: 'name', result: t.name })
    registerCall(fixture, {
      to: t.address,
      abi: erc20Abi,
      functionName: 'decimals',
      result: t.decimals,
    })
  }
  /** "No pool" from block 0, the pool's address from its creation block on. */
  const answer = (key: string) => {
    const pool = byCandidate.get(key)
    const history: { fromBlock: bigint; result: unknown }[] = [{ fromBlock: 0n, result: ZERO }]
    if (pool?.address !== undefined) {
      history.push({ fromBlock: pool.createdAtBlock, result: pool.address })
      registerCode(fixture, pool.address, pool.createdAtBlock)
    }
    return history
  }

  const v3 = addresses.uniswapV3.factory
  const v3Spacings = opts.v3TickSpacings ?? SEED_WORLD_V3_TICK_SPACINGS
  for (const fee of UNISWAP_V3_CANDIDATE_FEES) {
    const tickSpacing = v3Spacings[fee] ?? 0
    const history = [{ fromBlock: 0n, result: tickSpacing }]
    registerCallHistory(fixture, {
      to: v3,
      abi: uniswapV3FactoryAbi,
      functionName: 'feeAmountTickSpacing',
      args: [fee],
      history,
    })
    if (tickSpacing === 0) continue
    for (const [t0, t1] of erc20)
      registerCallHistory(fixture, {
        to: v3,
        abi: uniswapV3FactoryAbi,
        functionName: 'getPool',
        args: [t0, t1, fee],
        history: answer(candidateKey('uniswap-v3', t0, t1, String(fee))),
      })
  }

  const v2 = addresses.aerodromeV2.poolFactory
  for (const [t0, t1] of erc20)
    for (const stable of [false, true]) {
      const key = candidateKey('aerodrome-v2', t0, t1, String(stable))
      registerCallHistory(fixture, {
        to: v2,
        abi: aerodromePoolFactoryAbi,
        functionName: 'getPool',
        args: [t0, t1, stable],
        history: answer(key),
      })
      const pool = byCandidate.get(key)
      if (pool?.address !== undefined)
        registerCall(fixture, {
          to: v2,
          abi: aerodromePoolFactoryAbi,
          functionName: 'getFee',
          args: [pool.address, stable],
          result: BigInt(pool.liveFee ?? 30),
        })
    }

  addresses.aerodromeSlipstream.forEach((deployment, i) => {
    const spacings =
      opts.slipstreamTickSpacings?.[i] ?? Object.keys(SLIPSTREAM_DEFAULT_FEES).map(Number)
    const factory = deployment.factory
    const abi = aerodromeCLFactoryAbi
    registerCallHistory(fixture, {
      to: factory,
      abi,
      functionName: 'tickSpacings',
      history: [{ fromBlock: 0n, result: spacings }],
    })
    for (const tickSpacing of spacings) {
      const result = SLIPSTREAM_DEFAULT_FEES[tickSpacing] ?? 3_000
      registerCall(fixture, {
        to: factory,
        abi,
        functionName: 'tickSpacingToFee',
        args: [tickSpacing],
        result,
      })
      for (const [t0, t1] of erc20) {
        const key = candidateKey('aerodrome-slipstream', t0, t1, `${i}|${tickSpacing}`)
        registerCallHistory(fixture, {
          to: factory,
          abi,
          functionName: 'getPool',
          args: [t0, t1, tickSpacing],
          history: answer(key),
        })
        const pool = byCandidate.get(key)
        if (pool?.address !== undefined)
          registerCall(fixture, {
            to: pool.address,
            abi: aerodromeCLPoolAbi,
            functionName: 'fee',
            result: pool.liveFee ?? 3_000,
          })
      }
    }
  })

  registerAeroCandidates(fixture, opts, byCandidate, erc20, answer)

  for (const [currency0, currency1] of pairs)
    for (const { fee, tickSpacing } of UNISWAP_V4_STANDARD_KEYS) {
      const id = computePoolId({ currency0, currency1, fee, tickSpacing, hooks: ZERO })
      const pool = byCandidate.get(
        candidateKey('uniswap-v4', currency0, currency1, `${fee}|${tickSpacing}`),
      )
      const sqrt = pool?.sqrtPriceX96 ?? 1n << 96n
      const slot0 = [{ fromBlock: 0n, result: [0n, 0, 0, 0] }]
      const word = [{ fromBlock: 0n, result: slot0Word(0n, 0) }]
      if (pool !== undefined) {
        slot0.push({ fromBlock: pool.createdAtBlock, result: [sqrt, 0, 0, fee] })
        word.push({ fromBlock: pool.createdAtBlock, result: slot0Word(sqrt, fee) })
      }
      registerCallHistory(fixture, {
        to: addresses.uniswapV4.stateView,
        abi: v4StateViewAbi,
        functionName: 'getSlot0',
        args: [id],
        history: slot0,
      })
      registerCallHistory(fixture, {
        to: addresses.uniswapV4.poolManager,
        abi: v4PoolManagerAbi,
        functionName: 'extsload',
        args: [v4Slot0Slot(id)],
        history: word,
      })
    }
}

/** The Aero v2 and Aero Slipstream candidates, answered as `registerSeedWorld` documents. */
function registerAeroCandidates(
  fixture: Fixture,
  opts: SeedWorldOptions,
  byCandidate: ReadonlyMap<string, SeedWorldPool>,
  erc20: readonly SeedPair[],
  answer: (key: string) => { fromBlock: bigint; result: unknown }[],
): void {
  const { aeroV2, aeroSlipstream } = opts.addresses
  const v2Factories = [
    { stable: false, address: aeroV2.volatileFactory, feeModule: aeroV2.volatileFeeModule },
    { stable: true, address: aeroV2.stableFactory, feeModule: aeroV2.stableFeeModule },
  ]
  for (const factory of v2Factories) {
    const abi = aeroPoolFactoryAbi
    registerCallHistory(fixture, {
      to: factory.address,
      abi,
      functionName: 'feeModule',
      history: [{ fromBlock: 0n, result: factory.feeModule }],
    })
    for (const [t0, t1] of erc20) {
      const key = candidateKey('aero-v2', t0, t1, String(factory.stable))
      registerCallHistory(fixture, {
        to: factory.address,
        abi,
        functionName: 'getPool',
        args: [t0, t1],
        history: answer(key),
      })
      const pool = byCandidate.get(key)
      if (pool?.address !== undefined)
        registerCall(fixture, {
          to: factory.address,
          abi,
          functionName: 'getBaseFee',
          args: [pool.address, ZERO, 0n, 0n, 0n, 0n],
          result: BigInt(pool.liveFee ?? 30),
        })
    }
  }

  aeroSlipstream.forEach((deployment, i) => {
    const spacings = opts.aeroSlipstreamTickSpacings?.[i] ?? SEED_WORLD_AERO_TICK_SPACINGS
    const factory = deployment.factory
    registerCallHistory(fixture, {
      to: factory,
      abi: aerodromeCLFactoryAbi,
      functionName: 'tickSpacings',
      history: [{ fromBlock: 0n, result: spacings }],
    })
    for (const tickSpacing of spacings) {
      registerCall(fixture, {
        to: factory,
        abi: aerodromeCLFactoryAbi,
        functionName: 'tickSpacingToFee',
        args: [tickSpacing],
        result: SLIPSTREAM_DEFAULT_FEES[tickSpacing] ?? 3_000,
      })
      for (const [t0, t1] of erc20) {
        const key = candidateKey('aero-slipstream', t0, t1, `${i}|${tickSpacing}`)
        registerCallHistory(fixture, {
          to: factory,
          abi: aerodromeCLFactoryAbi,
          functionName: 'getPool',
          args: [t0, t1, tickSpacing],
          history: answer(key),
        })
        const pool = byCandidate.get(key)
        if (pool?.address === undefined) continue
        registerCall(fixture, {
          to: pool.address,
          abi: aerodromeCLPoolAbi,
          functionName: 'fee',
          result: pool.liveFee ?? 3_000,
        })
        registerCall(fixture, {
          to: factory,
          abi: aeroCLFactoryAbi,
          functionName: 'getPoolSwapHook',
          args: [pool.address],
          result: pool.swapHook ?? deployment.swapHook,
        })
        registerCall(fixture, {
          to: deployment.swapHook,
          abi: aeroSwapHookAbi,
          functionName: 'dynamicFeeConfig',
          args: [pool.address],
          result: [225, 5_000, 0n, pool.initialFeeEnabled ?? false, 0],
        })
      }
    }
  })
}
