/**
 * The outcome of a smart wallet's call bundle comes from its EIP-5792 status and receipts, never
 * from the bundle transaction alone (an ERC-4337 bundle succeeds when the user operation inside it
 * reverts), and an account counts as a contract account only for code that is not an EIP-7702
 * delegation.
 */
import type { Address } from '@depthwatch/core'
import { createClient, custom, type Hex } from 'viem'
import type { getCallsStatus } from 'viem/actions'
import { base } from 'viem/chains'
import { describe, expect, it } from 'vitest'
import { bundleOutcome, isContractAccount } from './send.js'

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
