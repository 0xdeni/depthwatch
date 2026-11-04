/**
 * The outcome of a smart wallet's call bundle comes from its EIP-5792 status and receipts, never
 * from the bundle transaction alone (an ERC-4337 bundle succeeds when the user operation inside it
 * reverts), an account counts as a contract account only for code that is not an EIP-7702
 * delegation, and the EOA path's gas limit is the wallet's estimate × 1.25, rounded up, with a
 * reverting estimate told apart from a wallet that cannot estimate.
 */
import type { Address } from '@depthwatch/core'
import { createClient, custom, type Hex } from 'viem'
import type { getCallsStatus } from 'viem/actions'
import { base } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { BUILDER_SUFFIX } from './builderCode.js'
import { walletClients } from './reads.js'
import { bundleOutcome, gasLimit, isContractAccount, isRevertError, paddedGas } from './send.js'

type CallsStatus = Awaited<ReturnType<typeof getCallsStatus>>
type Receipt = CallsStatus['receipts'] extends (infer R)[] | undefined ? R : never

const HASH: Hex = `0x${'ab'.repeat(32)}`
const LOG = { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', topics: [], data: '0x01' }

function receipt(status: 'success' | 'reverted', logs: unknown[] = [LOG]): Receipt {
  return {
    status,
    logs,
    transactionHash: HASH,
    blockHash: HASH,
    blockNumber: 1n,
    gasUsed: 1n,
  } as unknown as Receipt
}

function calls(status: CallsStatus['status'], statusCode: number, receipts: Receipt[]) {
  return { status, statusCode, receipts, atomic: true, id: '0x1', version: '2.0.0' } as never
}

describe('bundleOutcome', () => {
  it('is confirmed only on success with every receipt successful, with the wallet’s logs', () => {
    const hashes: Hex[] = []
    expect(
      bundleOutcome(calls('success', 200, [receipt('success')]), (h) => hashes.push(h)),
    ).toEqual({ kind: 'confirmed', hash: HASH, logs: [LOG] })
    expect(hashes).toEqual([HASH])
  })

  it('is reverted on failure (500) or a reverted receipt, though the bundle itself succeeded', () => {
    const none = () => undefined
    expect(bundleOutcome(calls('failure', 500, [receipt('reverted', [])]), none)).toEqual({
      kind: 'reverted',
      hash: HASH,
    })
    expect(bundleOutcome(calls('success', 200, [receipt('reverted', [])]), none)).toEqual({
      kind: 'reverted',
      hash: HASH,
    })
  })

  it('is not sent when the wallet failed the calls with no receipt (400)', () => {
    expect(bundleOutcome(calls('failure', 400, []), () => undefined)).toEqual({ kind: 'not-sent' })
  })

  it('throws on a status it cannot read, after telling the hash', () => {
    const hashes: Hex[] = []
    expect(() =>
      bundleOutcome(calls(undefined, 900, [receipt('success')]), (h) => hashes.push(h)),
    ).toThrow('the wallet reported the calls as 900')
    expect(hashes).toEqual([HASH])
    expect(() => bundleOutcome(calls('success', 200, []), () => undefined)).toThrow()
  })
})

describe('isContractAccount', () => {
  const ACCOUNT: Address = '0x00000000000000000000000000000000000a11ce'
  const clientWith = (code: unknown) =>
    createClient({
      chain: base,
      transport: custom({
        request: async ({ method }: { method: string }) => {
          if (method !== 'eth_getCode') throw new Error(`unexpected ${method}`)
          if (code instanceof Error) throw code
          return code
        },
      }),
    })

  it('is true for contract code, false for none, an EIP-7702 delegation or an error', async () => {
    expect(await isContractAccount(clientWith('0x6080604052'), ACCOUNT)).toBe(true)
    expect(await isContractAccount(clientWith('0x'), ACCOUNT)).toBe(false)
    const delegation = `0xef0100${'12'.repeat(20)}`
    expect(await isContractAccount(clientWith(delegation), ACCOUNT)).toBe(false)
    expect(await isContractAccount(clientWith(new Error('no')), ACCOUNT)).toBe(false)
  })
})

describe('gasLimit', () => {
  const ACCOUNT: Address = '0x00000000000000000000000000000000000a11ce'
  const TX = { to: ACCOUNT, data: '0x095ea7b3' as Hex, value: 5n }
  const error = (code: number, message: string, data?: unknown) =>
    Object.assign(new Error(message), { code, data })
  /** A wallet whose `eth_estimateGas` answers `answer` (thrown when an Error); asks are kept. */
  function walletWith(answer: unknown) {
    const asked: unknown[] = []
    const request = async ({ method, params }: { method: string; params?: unknown }) => {
      if (method !== 'eth_estimateGas') throw new Error(`unexpected ${method}`)
      asked.push(params)
      if (answer instanceof Error) throw answer
      return answer
    }
    return { clients: walletClients({ request }), asked }
  }

  it('pads the estimate by 25 %, rounded up', () => {
    expect([100_000n, 100_001n, 1n, 3n].map(paddedGas)).toEqual([125_000n, 125_002n, 2n, 4n])
  })

  it('estimates exactly what the EOA path signs: from the account, the suffix appended', async () => {
    const { clients, asked } = walletWith('0x30d40')
    expect(await gasLimit(clients, 'eoa', ACCOUNT, TX)).toBe(250_000n)
    expect(asked).toEqual([
      [{ from: ACCOUNT, to: ACCOUNT, data: `0x095ea7b3${BUILDER_SUFFIX.slice(2)}`, value: '0x5' }],
    ])
  })

  it('says reverts for a revert, however the wallet words it', async () => {
    for (const thrown of [
      error(3, 'execution reverted: Too little received', '0x08c379a0'),
      error(-32000, 'execution reverted'),
      // A wallet that wraps the node's answer in its own internal error.
      error(-32603, 'Internal JSON-RPC error.', { code: 3, message: 'execution reverted' }),
      error(-32603, 'Internal JSON-RPC error.', { code: -32000, message: 'Transaction reverted' }),
    ]) {
      const { clients } = walletWith(thrown)
      expect(await gasLimit(clients, 'eoa', ACCOUNT, TX), thrown.message).toBe('reverts')
    }
  })

  it('leaves the limit to the wallet when it cannot estimate, or answers no estimate', async () => {
    for (const answer of [
      error(-32601, 'the method eth_estimateGas does not exist/is not available'),
      error(4200, 'Unsupported method'),
      error(-32603, 'Internal JSON-RPC error.'),
      error(-32000, 'insufficient funds for gas * price + value'),
      '0x0',
      null,
    ]) {
      const { clients } = walletWith(answer)
      expect(await gasLimit(clients, 'eoa', ACCOUNT, TX), String(answer)).toBeNull()
    }
  })

  it('asks a smart wallet for nothing: the capability path sets no gas', async () => {
    const { clients, asked } = walletWith('0x30d40')
    expect(await gasLimit(clients, 'calls', ACCOUNT, TX)).toBeNull()
    expect(asked).toEqual([])
  })

  it('finds a revert in a cause chain and stops on a cycle', () => {
    const inner = error(3, 'execution reverted')
    expect(isRevertError(Object.assign(new Error('outer'), { cause: inner }))).toBe(true)
    const loop: Record<string, unknown> = { message: 'no' }
    loop.cause = loop
    expect(isRevertError(loop)).toBe(false)
    expect(isRevertError(null)).toBe(false)
  })
})
