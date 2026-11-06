/**
 * Test-only helpers: fake tokens and pools, token-metadata registration (string, bytes32 and
 * missing `symbol()`), per-pool state registration and a request-counting transport wrapper.
 */
import {
  type Address,
  type Dex,
  type Hex,
  NATIVE_ETH,
  type PoolMeta,
  type TokenInfo,
} from '@depthwatch/core'
import { custom, stringToHex, type Transport } from 'viem'
import { aerodromeCLPoolAbi } from '../abi/aerodromeCLPool.js'
import { aerodromePoolAbi } from '../abi/aerodromePool.js'
import { erc20Abi, erc20Bytes32Abi } from '../abi/erc20.js'
import { uniswapV3PoolAbi } from '../abi/uniswapV3Pool.js'
import { v4StateViewAbi } from '../abi/v4StateView.js'
import { slipstreamPoolId } from '../adapters/aerodromeSlipstream.js'
import { aerodromeV2PoolId } from '../adapters/aerodromeV2.js'
import { aeroSlipstreamPoolId } from '../adapters/aeroSlipstream.js'
import { aeroV2PoolId } from '../adapters/aeroV2.js'
import { uniswapV3PoolId } from '../adapters/uniswapV3.js'
import { computePoolId, uniswapV4PoolId } from '../adapters/uniswapV4.js'
import { type BlockRef, registerCall, registerRevert, setClock } from '../fixtures/builders.js'
import { createFixture, type Fixture } from '../transport/fixture.js'

export const ZERO: Address = NATIVE_ETH

/** `0x…00nn` style address from a small number. */
export function addr(n: number): Address {
  return `0x${n.toString(16).padStart(40, '0')}` as Address
}

export const TOKEN_A: TokenInfo = {
  address: addr(0xaa),
  symbol: 'AAA',
  name: 'Token A',
  decimals: 18,
}
/** Registered with bytes32 `symbol()`/`name()` (MKR-style). */
export const TOKEN_B: TokenInfo = {
  address: addr(0xbb),
  symbol: 'MKR',
  name: 'Maker',
  decimals: 18,
}
/** Registered with reverting `symbol()`/`name()`: the reader falls back to the short address. */
export const TOKEN_C: TokenInfo = {
  address: addr(0xcc),
  symbol: addr(0xcc).slice(0, 10),
  name: addr(0xcc).slice(0, 10),
  decimals: 6,
}
export const TOKEN_D: TokenInfo = {
  address: addr(0xdd),
  symbol: 'DDD',
  name: 'Token D',
  decimals: 6,
}

export const ALICE = addr(0xa11ce)
export const BOB = addr(0xb0b)
export const CAROL = addr(0xca501)

export type TokenMode = 'string' | 'bytes32' | 'missing'

export function registerToken(
  fixture: Fixture,
  token: TokenInfo,
  mode: TokenMode = 'string',
): void {
  const to = token.address
  if (mode === 'string') {
    registerCall(fixture, { to, abi: erc20Abi, functionName: 'symbol', result: token.symbol })
    registerCall(fixture, { to, abi: erc20Abi, functionName: 'name', result: token.name })
  } else if (mode === 'bytes32') {
    registerCall(fixture, {
      to,
      abi: erc20Bytes32Abi,
      functionName: 'symbol',
      result: stringToHex(token.symbol, { size: 32 }),
    })
    registerCall(fixture, {
      to,
      abi: erc20Bytes32Abi,
      functionName: 'name',
      result: stringToHex(token.name, { size: 32 }),
    })
  } else {
    registerRevert(fixture, { to, abi: erc20Abi, functionName: 'symbol' })
    registerRevert(fixture, { to, abi: erc20Abi, functionName: 'name' })
  }
  registerCall(fixture, { to, abi: erc20Abi, functionName: 'decimals', result: token.decimals })
}

/**
 * A fixture with the four test tokens and a 2 s clock ending at `latestBlock`: Base's spacing
 * before Denim, not Base's schedule (`setClock(fixture, { latestBlock, schedule })` gives that).
 */
export function newFixture(latestBlock = 10_000n, latestTimestamp = 1_800_000_000): Fixture {
  const fixture = createFixture()
  setClock(fixture, { latestBlock, latestTimestamp })
  registerToken(fixture, TOKEN_A)
  registerToken(fixture, TOKEN_B, 'bytes32')
  registerToken(fixture, TOKEN_C, 'missing')
  registerToken(fixture, TOKEN_D)
  return fixture
}

/** Counts JSON-RPC requests by method on the way to `inner`. */
export function countingTransport(inner: Transport, counts: Map<string, number>): Transport {
  return (config) => {
    const live = inner(config)
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      counts.set(method, (counts.get(method) ?? 0) + 1)
      return live.request({ method, params } as never)
    }
    return custom({ request }, { key: 'counting', name: 'Counting', retryCount: 0 })(config)
  }
}

export interface PoolSpec {
  dex: Dex
  /** Required for address-keyed pools. */
  address?: Address
  token0: TokenInfo
  token1: TokenInfo
  feePips?: number
  tickSpacing?: number
  stable?: boolean
  hooks?: Address
  createdAtBlock?: bigint
}

export function poolMeta(spec: PoolSpec): PoolMeta {
  const feePips = spec.feePips ?? 3000
  const createdAtBlock = spec.createdAtBlock ?? 1n
  const common = { token0: spec.token0, token1: spec.token1, feePips, createdAtBlock }
  if (spec.dex === 'uniswap-v4') {
    const hooks = spec.hooks ?? ZERO
    const tickSpacing = spec.tickSpacing ?? 60
    const poolId = computePoolId({
      currency0: spec.token0.address,
      currency1: spec.token1.address,
      fee: feePips,
      tickSpacing,
      hooks,
    })
    return {
      ...common,
      id: uniswapV4PoolId(poolId),
      dex: spec.dex,
      kind: 'concentrated',
      address: null,
      poolId,
      tickSpacing,
      stable: false,
      hooks,
    }
  }
  const address = spec.address
  if (!address) throw new Error('poolMeta: address required')
  if (spec.dex === 'aerodrome-v2' || spec.dex === 'aero-v2') {
    const stable = spec.stable ?? false
    return {
      ...common,
      id: spec.dex === 'aero-v2' ? aeroV2PoolId(address) : aerodromeV2PoolId(address),
      dex: spec.dex,
      kind: stable ? 'stable-swap' : 'constant-product',
      address,
      poolId: null,
      tickSpacing: null,
      stable,
      hooks: null,
    }
  }
  const id =
    spec.dex === 'uniswap-v3'
      ? uniswapV3PoolId(address)
      : spec.dex === 'aero-slipstream'
        ? aeroSlipstreamPoolId(address)
        : slipstreamPoolId(address)
  return {
    ...common,
    id,
    dex: spec.dex,
    kind: 'concentrated',
    address,
    poolId: null,
    tickSpacing: spec.tickSpacing ?? 60,
    stable: false,
    hooks: spec.hooks ?? null,
  }
}

export interface ConcentratedSpec {
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
  feePips: number
  /** Uniswap v4 only: slot0's packed `protocolFee` (default 0). */
  protocolFee?: number
  tickSpacing: number
  /** word → bitmap */
  bitmaps?: Record<number, bigint>
  /** tick → [liquidityGross, liquidityNet] */
  ticks?: Record<number, readonly [bigint, bigint]>
  reserve0?: bigint
  reserve1?: bigint
}

function registerBalances(
  fixture: Fixture,
  pool: PoolMeta,
  spec: ConcentratedSpec,
  blocks: BlockRef[],
): void {
  const address = pool.address as Address
  for (const [token, reserve] of [
    [pool.token0, spec.reserve0 ?? 0n],
    [pool.token1, spec.reserve1 ?? 0n],
  ] as const)
    registerCall(fixture, {
      to: token.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
      result: reserve,
      blocks,
    })
}

/** v3 / Slipstream (Aerodrome or Aero) pool reads (ABI picked from `pool.dex`). */
export function registerConcentratedPool(
  fixture: Fixture,
  pool: PoolMeta,
  spec: ConcentratedSpec,
  blocks: BlockRef[] = ['latest'],
): void {
  const to = pool.address as Address
  const slipstream = pool.dex === 'aerodrome-slipstream' || pool.dex === 'aero-slipstream'
  const abi = slipstream ? aerodromeCLPoolAbi : uniswapV3PoolAbi
  const slot0 = slipstream
    ? [spec.sqrtPriceX96, spec.tick, 0, 1, 1, true]
    : [spec.sqrtPriceX96, spec.tick, 0, 1, 1, 0, true]
  registerCall(fixture, { to, abi, functionName: 'slot0', result: slot0, blocks })
  registerCall(fixture, { to, abi, functionName: 'liquidity', result: spec.liquidity, blocks })
  registerCall(fixture, { to, abi, functionName: 'fee', result: spec.feePips, blocks })
  registerCall(fixture, { to, abi, functionName: 'tickSpacing', result: spec.tickSpacing, blocks })
  for (const [word, bitmap] of Object.entries(spec.bitmaps ?? {}))
    registerCall(fixture, {
      to,
      abi,
      functionName: 'tickBitmap',
      args: [Number(word)],
      result: bitmap,
      blocks,
    })
  for (const [tick, [gross, net]] of Object.entries(spec.ticks ?? {}))
    registerCall(fixture, {
      to,
      abi,
      functionName: 'ticks',
      args: [Number(tick)],
      result: slipstream
        ? [gross, net, net / 2n, 1n, 2n, 3n, 4n, 5n, 6, true]
        : [gross, net, 1n, 2n, 3n, 4n, 5, true],
      blocks,
    })
  registerBalances(fixture, pool, spec, blocks)
}

/** Uniswap v4 pool reads on StateView. */
export function registerV4Pool(
  fixture: Fixture,
  stateView: Address,
  pool: PoolMeta,
  spec: ConcentratedSpec,
  blocks: BlockRef[] = ['latest'],
): void {
  const poolId = pool.poolId as Hex
  const abi = v4StateViewAbi
  const to = stateView
  registerCall(fixture, {
    to,
    abi,
    functionName: 'getSlot0',
    args: [poolId],
    result: [spec.sqrtPriceX96, spec.tick, spec.protocolFee ?? 0, spec.feePips],
    blocks,
  })
  registerCall(fixture, {
    to,
    abi,
    functionName: 'getLiquidity',
    args: [poolId],
    result: spec.liquidity,
    blocks,
  })
  for (const [word, bitmap] of Object.entries(spec.bitmaps ?? {}))
    registerCall(fixture, {
      to,
      abi,
      functionName: 'getTickBitmap',
      args: [poolId, Number(word)],
      result: bitmap,
      blocks,
    })
  for (const [tick, [gross, net]] of Object.entries(spec.ticks ?? {}))
    registerCall(fixture, {
      to,
      abi,
      functionName: 'getTickInfo',
      args: [poolId, Number(tick)],
      result: [gross, net, 1n, 2n],
      blocks,
    })
}

/** v2 pool reserves (Aerodrome or Aero). */
export function registerV2Pool(
  fixture: Fixture,
  pool: PoolMeta,
  reserves: { reserve0: bigint; reserve1: bigint },
  blocks: BlockRef[] = ['latest'],
): void {
  registerCall(fixture, {
    to: pool.address as Address,
    abi: aerodromePoolAbi,
    functionName: 'getReserves',
    result: [reserves.reserve0, reserves.reserve1, 0n],
    blocks,
  })
}

/** Walk `cause` links looking for an error that satisfies `pred`. */
export function findCause(err: unknown, pred: (e: unknown) => boolean): unknown {
  let cursor: unknown = err
  for (let depth = 0; depth < 10 && cursor !== undefined && cursor !== null; depth++) {
    if (pred(cursor)) return cursor
    cursor = (cursor as { cause?: unknown }).cause
  }
  return undefined
}
