/**
 * Exact creation block of pools found without logs, by binary search over archive state.
 *
 * A contract pool (Uniswap v3, Aerodrome v2, Slipstream) exists at block N when `eth_getCode` at N
 * is not empty. A Uniswap v4 pool exists once initialized: its slot0 word in the PoolManager
 * (`extsload(keccak256(poolId ‖ POOLS_SLOT))`, the word StateView's `getSlot0` decodes) has a
 * non-zero sqrtPriceX96. The PoolManager is probed rather than StateView because StateView was
 * deployed after it (no code at the v4 start block), so a StateView probe would date pools
 * initialized in between at StateView's own deployment; the seeder checks at the seed block that
 * both read the same sqrtPriceX96. Both predicates only ever turn from false to true, so the first
 * block where one holds is the creation block (eth_getCode / eth_call at N see the state after N).
 *
 * Every target exists at `upperBound` (the seed block) and cannot exist before its `lowerBound`
 * (its factory's deployment block), so at most ⌈log2(upperBound − lowerBound + 1)⌉ probes find
 * it: about 26 to 28, the log2 of the height. From Uniswap v3's start (1,371,680) to a head of up
 * to 68,480,543 it is 26; since Denim (block 53,556,127) the head grows 432,000 blocks a day, so
 * it is 27 from about 2026-12-10 and 28 from about 2027-05-14 (a head past 135,589,407). The
 * searches run in lockstep rounds, one probe per open target per round: v4 probes at the same
 * block share one multicall, contract probes are one `eth_getCode` each, and at most
 * `concurrency` requests are in flight.
 * A rate-limited or transient probe is retried with backoff (internal/backoff.ts); any other
 * failure stops the search: no new probe starts and the error is thrown.
 */
import type { Address, Hex } from '@depthwatch/core'
import { encodePacked, hexToBigInt, keccak256 } from 'viem'
import { v4PoolManagerAbi } from '../abi/v4PoolManager.js'
import { type BackoffEvent, callWithBackoff } from '../internal/backoff.js'
import { runLimited } from '../internal/concurrency.js'
import type { ReaderContext } from '../internal/context.js'
import { multicallBatched, optionalResult } from '../internal/multicall.js'

export type CreationProbe = { kind: 'code'; address: Address } | { kind: 'v4'; poolId: Hex }

export interface CreationTarget {
  /** Pool id: `<dex>:<address>` or `uniswap-v4:<poolId>`. */
  id: string
  probe: CreationProbe
  /** First block the pool can exist at: its factory's (or PoolManager's) deployment. */
  lowerBound: bigint
}

export interface CreationSearchProgress {
  round: number
  /** Rounds the widest search needs: ⌈log2(span)⌉. */
  rounds: number
  /** Targets still open after this round. */
  open: number
  /** Requests sent so far. */
  requests: number
}

export interface CreationSearchOptions {
  concurrency: number
  onRound?: ((progress: CreationSearchProgress) => void) | undefined
  /** Each backoff of a rate-limited or transient probe (the reader's `logRetry` policy). */
  onRetry?: ((event: BackoffEvent) => void) | undefined
}

export interface CreationSearchResult {
  /** Creation block per target id. */
  blocks: Map<string, bigint>
  requests: number
  rounds: number
}

/** `PoolManager._pools` mapping slot (StateLibrary.POOLS_SLOT). */
const POOLS_SLOT = 6n
const SQRT_PRICE_MASK = (1n << 160n) - 1n

/** Storage slot of a v4 pool's slot0 word: keccak256(abi.encodePacked(poolId, POOLS_SLOT)). */
export function v4Slot0Slot(poolId: Hex): Hex {
  return keccak256(encodePacked(['bytes32', 'uint256'], [poolId, POOLS_SLOT]))
}

/** sqrtPriceX96 of a slot0 word (its low 160 bits); 0n for a missing or undecodable answer. */
export function slot0SqrtPrice(word: unknown): bigint {
  if (typeof word !== 'string' || !word.startsWith('0x')) return 0n
  return hexToBigInt(word as Hex) & SQRT_PRICE_MASK
}

/** `PoolManager.extsload` of a pool's slot0 word. */
export function v4Slot0Call(ctx: ReaderContext, poolId: Hex) {
  return {
    address: ctx.addresses.uniswapV4.poolManager,
    abi: v4PoolManagerAbi,
    functionName: 'extsload',
    args: [v4Slot0Slot(poolId)],
  } as const
}

/** Probes a binary search over the blocks lo…hi needs at most: ⌈log2(hi − lo + 1)⌉. */
export function probesFor(lo: bigint, hi: bigint): number {
  const span = hi - lo + 1n
  return span <= 1n ? 0 : (span - 1n).toString(2).length
}

interface SearchState {
  target: CreationTarget
  /** The creation block is in lo…hi; the pool exists at hi. */
  lo: bigint
  hi: bigint
}

function settle(state: SearchState, block: bigint, exists: boolean): void {
  if (exists) state.hi = block
  else state.lo = block + 1n
}

export async function findCreationBlocks(
  ctx: ReaderContext,
  targets: readonly CreationTarget[],
  upperBound: bigint,
  opts: CreationSearchOptions,
): Promise<CreationSearchResult> {
  const states: SearchState[] = targets.map((target) => ({
    target,
    lo: target.lowerBound < upperBound ? target.lowerBound : upperBound,
    hi: upperBound,
  }))
  const rounds = states.reduce((max, s) => Math.max(max, probesFor(s.lo, s.hi)), 0)
  const retry = <T>(what: string, request: () => Promise<T>) =>
    callWithBackoff(ctx, what, request, opts.onRetry)
  let requests = 0
  let round = 0
  for (let open = states.filter((s) => s.lo < s.hi); open.length > 0; ) {
    round++
    const tasks: (() => Promise<void>)[] = []
    const v4AtBlock = new Map<bigint, { state: SearchState; poolId: Hex }[]>()
    for (const state of open) {
      const mid = state.lo + (state.hi - state.lo) / 2n
      const { probe } = state.target
      if (probe.kind === 'code') {
        requests++
        tasks.push(async () => {
          const code = await retry(`eth_getCode ${probe.address} @ ${mid}`, () =>
            ctx.client.getCode({ address: probe.address, blockNumber: mid }),
          )
          settle(state, mid, code !== undefined && code !== '0x')
        })
      } else {
        const group = v4AtBlock.get(mid) ?? []
        group.push({ state, poolId: probe.poolId })
        v4AtBlock.set(mid, group)
      }
    }
    for (const [block, group] of v4AtBlock) {
      requests += Math.ceil(group.length / ctx.maxCallsPerMulticall)
      tasks.push(async () => {
        // multicallBatched backs off itself (same policy); it reports to this search's onRetry.
        const words = await multicallBatched(
          ctx,
          group.map((g) => v4Slot0Call(ctx, g.poolId)),
          block,
          { what: `PoolManager extsload ×${group.length} @ ${block}`, onRetry: opts.onRetry },
        )
        group.forEach((g, i) => {
          settle(g.state, block, slot0SqrtPrice(optionalResult(words[i])) !== 0n)
        })
      })
    }
    await runLimited(tasks, opts.concurrency)
    open = open.filter((s) => s.lo < s.hi)
    opts.onRound?.({ round, rounds, open: open.length, requests })
  }
  return { blocks: new Map(states.map((s) => [s.target.id, s.lo])), requests, rounds: round }
}
