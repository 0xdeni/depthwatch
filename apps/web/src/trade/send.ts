/**
 * Sending, with the Builder Code on every transaction (DESIGN.md, "Dashboard (apps/web)"):
 * - an EOA (a wallet that does not report the `dataSuffix` capability on Base) is asked, once it
 *   has said it is on Base, for `eth_sendTransaction` of our calldata with `BUILDER_SUFFIX`
 *   appended: the exact bytes `simulate` ran, with a gas limit 25 % above the wallet's
 *   `eth_estimateGas` of them (`gasLimit`). One request per signature: viem's `sendTransaction`
 *   is not used, since after some errors it asks again as `wallet_sendTransaction`, a second wallet
 *   prompt behind the back of the trade switch's re-read;
 * - a wallet whose `wallet_getCapabilities` reports `dataSuffix.supported` for 0x2105 (a smart
 *   wallet) gets `wallet_sendCalls` with `capabilities.dataSuffix = { value, optional: false }`
 *   and our calldata without the suffix, so the wallet appends it once, to the user operation.
 *   No fallback to `eth_sendTransaction` (viem's `experimental_fallback` is never set).
 * An account with contract code that is not an EIP-7702 delegation and does not report the
 * capability still signs on the EOA path, but its wallet wraps our calldata, suffix included, in a
 * call of its own, so the code may not be recorded: the review says so, and nothing stops.
 * Approve and swap go one at a time: each is simulated, signed and waited for. The outcome is the
 * transaction's receipt, or for a call bundle the wallet's EIP-5792 status and receipts (an
 * ERC-4337 bundle succeeds even when the user operation inside it reverts).
 */
import type { Address } from '@depthwatch/core'
import { type Client, type Hex, hexToBigInt, numberToHex } from 'viem'
import {
  call,
  getCallsStatus,
  getChainId,
  getCode,
  getTransaction,
  getTransactionReceipt,
  sendCalls,
} from 'viem/actions'
import { base } from 'viem/chains'
import { BUILDER_SUFFIX, withBuilderSuffix } from './builderCode.js'
import { readBackCodes } from './readBack.js'
import type { WalletClients } from './reads.js'
import type { TxRequest } from './venue.js'
import type { Eip1193Provider } from './wallets.js'

export type SendPath = 'eoa' | 'calls'

/** Base mainnet as EIP-5792 keys it. */
const BASE_HEX = '0x2105'

/**
 * `calls` when the wallet reports the `dataSuffix` capability as supported on Base, else `eoa`
 * (no answer, an error, or no such capability).
 */
export async function sendPathOf(provider: Eip1193Provider, account: Address): Promise<SendPath> {
  try {
    const caps = (await provider.request({
      method: 'wallet_getCapabilities',
      params: [account, [BASE_HEX]],
    })) as Record<string, { dataSuffix?: { supported?: unknown } } | undefined> | null
    return caps?.[BASE_HEX]?.dataSuffix?.supported === true ? 'calls' : 'eoa'
  } catch {
    return 'eoa'
  }
}

/** The EIP-7702 delegation designator: an EOA whose code starts with it still signs itself. */
const DELEGATION_PREFIX = '0xef0100'

/** True when `account` has contract code that is not an EIP-7702 delegation; false if unknown. */
export async function isContractAccount(client: Client, account: Address): Promise<boolean> {
  try {
    const code = ((await getCode(client, { address: account })) ?? '0x').toLowerCase()
    return code !== '0x' && !code.startsWith(DELEGATION_PREFIX)
  } catch {
    return false
  }
}

/**
 * Runs the transaction as `eth_call` from the account, as it will be signed: with the suffix on
 * the EOA path, as the account's own call on the capability path. Throws when it would revert.
 */
export async function simulate(
  clients: WalletClients,
  path: SendPath,
  account: Address,
  tx: TxRequest,
): Promise<void> {
  const data = path === 'eoa' ? withBuilderSuffix(tx.data) : tx.data
  await call(clients.plain, { account, to: tx.to, data, value: tx.value })
}

/** The gas limit over the wallet's estimate: × 125 / 100, rounded up. */
export const GAS_MARGIN = { num: 125n, den: 100n } as const

/** `estimate` with GAS_MARGIN, rounded up: 100,001 → 125,002. */
export function paddedGas(estimate: bigint): bigint {
  return (estimate * GAS_MARGIN.num + GAS_MARGIN.den - 1n) / GAS_MARGIN.den
}

/**
 * The gas limit to sign a transaction with: a padded estimate, null to leave it to the wallet, or
 * `reverts` when the estimate says the transaction would fail (nothing is sent).
 */
export type GasLimit = bigint | null | 'reverts'

/** True for a JSON-RPC error that says the call reverted (code 3, or "revert" in a message). */
export function isRevertError(error: unknown): boolean {
  const seen = new Set<unknown>()
  const queue: unknown[] = [error]
  while (queue.length > 0 && seen.size < 16) {
    const e = queue.shift()
    if (!e || typeof e !== 'object' || seen.has(e)) continue
    seen.add(e)
    const { code, message, cause, data } = e as Record<string, unknown>
    if (code === 3 || (typeof message === 'string' && /revert/i.test(message))) return true
    queue.push(cause, data)
  }
  return false
}

/**
 * The gas limit of `tx` on the EOA path: the wallet's `eth_estimateGas` of exactly the transaction
 * `send` asks it to sign (from the account, suffix appended), with GAS_MARGIN. An estimate is the
 * least gas that succeeded against the state it was made on; the transaction runs later, in another
 * block, and can need more. A call passes on at most 63/64 of the gas it has left, so a limit at the
 * bare estimate can leave the innermost call of the router short: the swap reverts and its gas is
 * spent. An estimate that reverts is a failed simulation (nothing is sent); a wallet that cannot
 * estimate (the method unsupported, or any other error) is left to set the limit itself. The
 * capability path sets no gas: the wallet builds that transaction itself.
 */
export async function gasLimit(
  clients: WalletClients,
  path: SendPath,
  account: Address,
  tx: TxRequest,
): Promise<GasLimit> {
  if (path !== 'eoa') return null
  const request = {
    from: account,
    to: tx.to,
    data: withBuilderSuffix(tx.data),
    value: numberToHex(tx.value),
  }
  try {
    const estimate = await clients.plain.request(
      { method: 'eth_estimateGas', params: [request] },
      { retryCount: 0 },
    )
    const gas = typeof estimate === 'string' ? hexToBigInt(estimate as Hex) : 0n
    return gas > 0n ? paddedGas(gas) : null
  } catch (error) {
    return isRevertError(error) ? 'reverts' : null
  }
}

export type Sent = { kind: 'tx'; hash: Hex } | { kind: 'calls'; id: string }

/**
 * Asks the wallet to sign and send `tx`: the one wallet prompt of a step, never repeated. `gas`:
 * the EOA path's limit (`gasLimit`), null to leave it to the wallet; the capability path has none.
 */
export async function send(
  clients: WalletClients,
  path: SendPath,
  account: Address,
  tx: TxRequest,
  gas: bigint | null,
): Promise<Sent> {
  if (path === 'eoa') {
    if ((await getChainId(clients.plain)) !== base.id)
      throw new Error('the wallet is no longer on Base')
    const request = {
      from: account,
      to: tx.to,
      data: withBuilderSuffix(tx.data),
      value: numberToHex(tx.value),
      chainId: numberToHex(base.id),
      ...(gas === null ? {} : { gas: numberToHex(gas) }),
    }
    const hash = await clients.plain.request(
      { method: 'eth_sendTransaction', params: [request] },
      { retryCount: 0 },
    )
    if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash))
      throw new Error('the wallet answered without a transaction hash')
    return { kind: 'tx', hash: hash as Hex }
  }
  const { id } = await sendCalls(clients.plain, {
    account,
    chain: base,
    calls: [{ to: tx.to, data: tx.data, value: tx.value }],
    capabilities: { dataSuffix: { value: BUILDER_SUFFIX, optional: false } },
  })
  return { kind: 'calls', id }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** A receipt's log, as the transaction receipt and the wallet's call receipts both give it. */
export interface ReceiptLog {
  address: string
  topics: readonly string[]
  data: string
}

export type Outcome =
  | { kind: 'confirmed'; hash: Hex; logs: readonly ReceiptLog[] }
  | { kind: 'reverted'; hash: Hex }
  /** The wallet reports the calls failed before reaching the chain: nothing was sent. */
  | { kind: 'not-sent' }
  /** The panel went away (another account, network or page) before the outcome was known. */
  | { kind: 'abandoned' }

export interface WaitOptions {
  pollMs: number
  /** False once the panel that asked has gone: polling stops. */
  alive: () => boolean
  /** Told the transaction's hash as soon as it is known. */
  onHash?: (hash: Hex) => void
}

type CallsStatus = Awaited<ReturnType<typeof getCallsStatus>>

/**
 * The outcome of a call bundle the wallet no longer reports pending (EIP-5792): confirmed only on
 * `success` with every receipt `success`, reverted on `failure` or any reverted receipt (no
 * receipt: never sent). Anything else throws, so the panel says it lost track.
 */
export function bundleOutcome(status: CallsStatus, onHash: (hash: Hex) => void): Outcome {
  const receipts = status.receipts ?? []
  const hash = [...receipts].reverse().find((r) => r.transactionHash)?.transactionHash ?? null
  if (hash) onHash(hash)
  const ok = receipts.length > 0 && receipts.every((r) => r.status === 'success')
  if (status.status === 'success' && ok && hash)
    return { kind: 'confirmed', hash, logs: receipts.flatMap((r) => r.logs) }
  if (status.status === 'failure' || receipts.some((r) => r.status === 'reverted'))
    return hash ? { kind: 'reverted', hash } : { kind: 'not-sent' }
  throw new Error(`the wallet reported the calls as ${String(status.statusCode ?? 'unknown')}`)
}

async function receiptOf(clients: WalletClients, hash: Hex) {
  try {
    return await getTransactionReceipt(clients.plain, { hash })
  } catch (error) {
    if ((error as { name?: string }).name !== 'TransactionReceiptNotFoundError') throw error
    return null
  }
}

/** Waits until the transaction (or the wallet's call bundle) is included, polling every `pollMs`. */
export async function waitFor(
  clients: WalletClients,
  sent: Sent,
  { pollMs, alive, onHash = () => undefined }: WaitOptions,
): Promise<Outcome> {
  if (sent.kind === 'tx') onHash(sent.hash)
  for (;;) {
    if (sent.kind === 'tx') {
      const receipt = await receiptOf(clients, sent.hash)
      if (receipt)
        return receipt.status === 'success'
          ? { kind: 'confirmed', hash: sent.hash, logs: receipt.logs }
          : { kind: 'reverted', hash: sent.hash }
    } else {
      const status = await getCallsStatus(clients.plain, { id: sent.id })
      if (status.status !== 'pending') return bundleOutcome(status, onHash)
    }
    if (!alive()) return { kind: 'abandoned' }
    await sleep(pollMs)
  }
}

/**
 * The Builder Codes read back from the sent transaction's input for `account` (readBack.ts), null
 * when none: shown under the outcome's details, never a reason to stop.
 */
export async function sentCodes(
  clients: WalletClients,
  hash: Hex,
  account: Address,
): Promise<string[] | null> {
  try {
    const tx = await getTransaction(clients.plain, { hash })
    return readBackCodes(tx.input, account)
  } catch {
    return null
  }
}

/** keccak256("Transfer(address,address,uint256)"). */
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
/** keccak256("Withdrawal(address,uint256)"): WETH9 paying out ETH to `src`. */
export const WITHDRAWAL_TOPIC = '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65'

const topicAddress = (topic: string | undefined) => `0x${(topic ?? '').slice(-40)}`.toLowerCase()

/**
 * What the account received, from the outcome's logs: the output token's `Transfer`s to the
 * account, or for ETH out the WETH `Withdrawal`s by the router (which then pays the account).
 * Null when no such log is found.
 */
export function receivedFrom(
  logs: readonly ReceiptLog[],
  out: { token: Address; account: Address; router: Address; eth: boolean; weth: Address },
): bigint | null {
  let total = 0n
  let seen = false
  for (const log of logs) {
    const [topic0, topic1, topic2] = log.topics
    const emitter = log.address.toLowerCase()
    const match = out.eth
      ? emitter === out.weth && topic0 === WITHDRAWAL_TOPIC && topicAddress(topic1) === out.router
      : emitter === out.token && topic0 === TRANSFER_TOPIC && topicAddress(topic2) === out.account
    if (!match) continue
    total += log.data === '0x' ? 0n : BigInt(log.data)
    seen = true
  }
  return seen ? total : null
}
