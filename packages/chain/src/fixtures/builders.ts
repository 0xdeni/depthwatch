/**
 * Fixture builders: encode contract answers, logs and blocks with viem so tests and the synthetic
 * world register per-contract entries and let the fixture transport do the rest (multicall
 * decomposition, log filtering, block synthesis).
 */
import type { Address, Hex } from '@depthwatch/core'
import {
  type Abi,
  type BlockTag,
  type ContractEventName,
  type ContractFunctionName,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAbiItem,
  keccak256,
  numberToHex,
  stringToHex,
} from 'viem'
import { type BlockSchedule, msPerBlockAt, scheduledTimestamp } from '../schedule.js'
import { type Fixture, type FixtureLog, syntheticBlockHash } from '../transport/fixture.js'
import { fixtureKey } from '../transport/key.js'

export type BlockRef = bigint | BlockTag

export function blockParam(block: BlockRef): string {
  return typeof block === 'bigint' ? numberToHex(block) : block
}

/** Key of a plain `eth_call` to `to` with `data` at `block`, as viem sends it. */
export function callKey(to: Address, data: Hex, block: BlockRef = 'latest'): string {
  return fixtureKey('eth_call', [{ to: to.toLowerCase(), data }, blockParam(block)])
}

export function registerRequest(
  fixture: Fixture,
  method: string,
  params: unknown,
  result: unknown,
): void {
  fixture.calls[fixtureKey(method, params)] = result
}

export function registerError(
  fixture: Fixture,
  method: string,
  params: unknown,
  error: { code?: number; message: string; data?: Hex },
): void {
  fixture.calls[fixtureKey(method, params)] = { $error: error }
}

export interface RawCallSpec {
  to: Address
  data: Hex
  returnData: Hex
  blocks?: readonly BlockRef[]
}

export function registerRawCall(fixture: Fixture, spec: RawCallSpec): void {
  for (const block of spec.blocks ?? ['latest'])
    fixture.calls[callKey(spec.to, spec.data, block)] = spec.returnData
}

export interface CallSpec<abi extends Abi> {
  to: Address
  abi: abi
  functionName: ContractFunctionName<abi>
  args?: readonly unknown[]
  /** Single output value, or an array for functions with several outputs. */
  result: unknown
  blocks?: readonly BlockRef[]
}

function jsonKey(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)) ?? 'undefined'
}

/** Calldata per ABI and (function, args): selector hashing dominates fixture building otherwise. */
const calldataCache = new WeakMap<Abi, Map<string, Hex>>()

function cachedCalldata(abi: Abi, functionName: string, args: readonly unknown[] | undefined): Hex {
  let perAbi = calldataCache.get(abi)
  if (perAbi === undefined) {
    perAbi = new Map()
    calldataCache.set(abi, perAbi)
  }
  const key = `${functionName}|${jsonKey(args)}`
  let data = perAbi.get(key)
  if (data === undefined) {
    data = encodeFunctionData({ abi, functionName, args } as never)
    if (perAbi.size >= 50_000) perAbi.clear()
    perAbi.set(key, data)
  }
  return data
}

export function registerCall<const abi extends Abi>(fixture: Fixture, spec: CallSpec<abi>): void {
  const data = cachedCalldata(spec.abi, spec.functionName, spec.args)
  const returnData = encodeFunctionResult({
    abi: spec.abi,
    functionName: spec.functionName,
    result: spec.result,
  } as never)
  registerRawCall(fixture, { to: spec.to, data, returnData, blocks: spec.blocks })
}

/**
 * Answers `method(...params, block)` from the entries' `fromBlock` on (Fixture `history`): a request
 * at block N gets the entry with the largest `fromBlock` ≤ N; earlier blocks miss. Later entries for
 * the same `fromBlock` replace earlier ones.
 */
export function registerHistory(
  fixture: Fixture,
  method: string,
  params: readonly unknown[],
  entries: readonly { fromBlock: bigint; value: unknown }[],
): void {
  const key = fixtureKey(method, params)
  const history = fixture.history ?? {}
  const merged = new Map((history[key] ?? []).map((e) => [e.fromBlock, e.value]))
  for (const e of entries) merged.set(e.fromBlock.toString(), e.value)
  history[key] = [...merged].map(([fromBlock, value]) => ({ fromBlock, value }))
  fixture.history = history
}

/** `eth_getCode(address, N)`: `0x` before `deployedAt`, `code` from it on. */
export function registerCode(
  fixture: Fixture,
  address: Address,
  deployedAt: bigint,
  code: Hex = '0x6080604052',
): void {
  registerHistory(
    fixture,
    'eth_getCode',
    [address.toLowerCase()],
    [
      { fromBlock: 0n, value: '0x' },
      { fromBlock: deployedAt, value: code },
    ],
  )
}

export interface CallHistorySpec<abi extends Abi> {
  to: Address
  abi: abi
  functionName: ContractFunctionName<abi>
  args?: readonly unknown[]
  /** Results by first block they hold at (see registerHistory). */
  history: readonly { fromBlock: bigint; result: unknown }[]
}

/** An `eth_call` (alone or inside a multicall) whose result changes at the given blocks. */
export function registerCallHistory<const abi extends Abi>(
  fixture: Fixture,
  spec: CallHistorySpec<abi>,
): void {
  const data = cachedCalldata(spec.abi, spec.functionName, spec.args)
  registerHistory(
    fixture,
    'eth_call',
    [{ to: spec.to.toLowerCase(), data }],
    spec.history.map((h) => ({
      fromBlock: h.fromBlock,
      value: encodeFunctionResult({
        abi: spec.abi,
        functionName: spec.functionName,
        result: h.result,
      } as never),
    })),
  )
}

export interface RevertSpec<abi extends Abi> {
  to: Address
  abi: abi
  functionName: ContractFunctionName<abi>
  args?: readonly unknown[]
  blocks?: readonly BlockRef[]
  message?: string
  data?: Hex
}

export function registerRevert<const abi extends Abi>(
  fixture: Fixture,
  spec: RevertSpec<abi>,
): void {
  const data = encodeFunctionData({
    abi: spec.abi,
    functionName: spec.functionName,
    args: spec.args,
  } as never)
  for (const block of spec.blocks ?? ['latest'])
    fixture.calls[callKey(spec.to, data, block)] = {
      $error: { code: 3, message: spec.message ?? 'execution reverted', data: spec.data ?? '0x' },
    }
}

export interface LogsErrorSpec {
  address?: Address | Address[]
  topics?: (Hex | Hex[] | null)[]
  fromBlock: bigint
  toBlock: bigint
  message: string
  code?: number
}

/** Make one exact `eth_getLogs` range fail (e.g. to exercise chunk halving). */
export function registerLogsError(fixture: Fixture, spec: LogsErrorSpec): void {
  registerError(
    fixture,
    'eth_getLogs',
    [
      {
        ...(spec.address === undefined ? {} : { address: spec.address }),
        ...(spec.topics === undefined ? {} : { topics: spec.topics }),
        fromBlock: numberToHex(spec.fromBlock),
        toBlock: numberToHex(spec.toBlock),
      },
    ],
    { code: spec.code ?? -32005, message: spec.message },
  )
}

export interface LogSpec<abi extends Abi> {
  address: Address
  abi: abi
  eventName: ContractEventName<abi>
  /** All event inputs by name (indexed ones become topics, the rest are ABI-encoded into data). */
  args: Record<string, unknown>
  blockNumber: bigint
  logIndex: number
  txHash?: Hex
  txIndex?: number
}

interface EventItem {
  type: string
  inputs: readonly { name?: string; type: string; indexed?: boolean; components?: unknown }[]
}

/** Per ABI: event items by name, and topics by (event, indexed args) — both hash-heavy in viem. */
const eventCache = new WeakMap<Abi, { items: Map<string, EventItem>; topics: Map<string, Hex[]> }>()

function eventEntry(abi: Abi) {
  let entry = eventCache.get(abi)
  if (entry === undefined) {
    entry = { items: new Map(), topics: new Map() }
    eventCache.set(abi, entry)
  }
  return entry
}

function eventItem(abi: Abi, eventName: string): EventItem {
  const entry = eventEntry(abi)
  let item = entry.items.get(eventName)
  if (item === undefined) {
    const found = getAbiItem({ abi, name: eventName } as never) as EventItem | undefined
    if (found?.type !== 'event') throw new Error(`makeLog: event ${eventName} not in abi`)
    item = found
    entry.items.set(eventName, item)
  }
  return item
}

function eventTopicsFor(
  abi: Abi,
  item: EventItem,
  eventName: string,
  args: Record<string, unknown>,
) {
  const indexed = item.inputs
    .filter((i) => i.indexed)
    .map((i) => (i.name ? args[i.name] : undefined))
  const key = `${eventName}|${jsonKey(indexed)}`
  const { topics } = eventEntry(abi)
  let cached = topics.get(key)
  if (cached === undefined) {
    cached = encodeEventTopics({ abi, eventName, args } as never) as Hex[]
    if (topics.size >= 50_000) topics.clear()
    topics.set(key, cached)
  }
  return [...cached]
}

export function makeLog<const abi extends Abi>(spec: LogSpec<abi>): FixtureLog {
  const eventName = String(spec.eventName)
  const item = eventItem(spec.abi, eventName)
  const topics = eventTopicsFor(spec.abi, item, eventName, spec.args)
  const nonIndexed = item.inputs.filter((i) => !i.indexed)
  const data = encodeAbiParameters(
    nonIndexed as never,
    nonIndexed.map((i) => {
      if (i.name === undefined || !(i.name in spec.args))
        throw new Error(
          `makeLog: missing arg ${i.name ?? '<unnamed>'} for ${String(spec.eventName)}`,
        )
      return spec.args[i.name]
    }) as never,
  )
  const txHash =
    spec.txHash ?? keccak256(stringToHex(`${spec.address}-${spec.blockNumber}-${spec.logIndex}`))
  return {
    address: spec.address.toLowerCase() as Address,
    topics,
    data,
    blockNumber: numberToHex(spec.blockNumber),
    blockHash: syntheticBlockHash(spec.blockNumber),
    transactionHash: txHash,
    transactionIndex: numberToHex(spec.txIndex ?? 0),
    logIndex: numberToHex(spec.logIndex),
    removed: false,
  }
}

export function addLogs(fixture: Fixture, logs: readonly FixtureLog[]): void {
  fixture.logs = [...(fixture.logs ?? []), ...logs]
}

/**
 * The fixture's head and clock: `secondsPerBlock` (default 2) back from `latestTimestamp`, or, with
 * `schedule`, every block at its scheduled time (e.g. BASE_BLOCK_SCHEDULE, 200 ms after Denim).
 */
export function setClock(
  fixture: Fixture,
  clock:
    | { latestBlock: bigint; latestTimestamp: number; secondsPerBlock?: number }
    | { latestBlock: bigint; schedule: BlockSchedule },
): void {
  if ('schedule' in clock) {
    fixture.clock = {
      latestBlock: clock.latestBlock.toString(),
      latestTimestamp: scheduledTimestamp(clock.schedule, clock.latestBlock),
      secondsPerBlock: msPerBlockAt(clock.schedule, clock.latestBlock) / 1_000,
      eras: clock.schedule.map((era) => ({ ...era, fromBlock: era.fromBlock.toString() })),
    }
    return
  }
  fixture.clock = {
    latestBlock: clock.latestBlock.toString(),
    latestTimestamp: clock.latestTimestamp,
    secondsPerBlock: clock.secondsPerBlock ?? 2,
  }
}
