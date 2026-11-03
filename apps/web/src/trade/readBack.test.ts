/**
 * Reading the Builder Code back after the receipt: only where ERC-8021's parser reads it, the end
 * of the transaction's input or the end of the account's user operation in an ERC-4337 bundle
 * (EntryPoint v0.6 and v0.7). Our calldata wrapped, suffix and all, inside a smart account's
 * `execute(…)` (the case where the code is lost) reads as not found.
 */
import type { Address } from '@depthwatch/core'
import { type AbiFunction, concat, type Hex, stringToHex, toFunctionSelector } from 'viem'
import { entryPoint06Abi, entryPoint07Abi } from 'viem/account-abstraction'
import { describe, expect, it } from 'vitest'
import { bundleInput } from '../testing/bundle.js'
import { BUILDER_CODE, BUILDER_SUFFIX, withBuilderSuffix } from './builderCode.js'
import { entryPoint06HandleOpsAbi, entryPoint07HandleOpsAbi, readBackCodes } from './readBack.js'

const ACCOUNT: Address = '0x00000000000000000000000000000000000a11ce'
const OTHER: Address = '0x00000000000000000000000000000000000b0b00'
const ROUTER: Address = '0x2626664c2603336e57b271c5c0b26f421741e481'
const SWAP: Hex = `0x5ae401dc${'00'.repeat(64)}`

const handleOpsOf = (abi: readonly unknown[]) =>
  (abi as AbiFunction[]).find((item) => item.type === 'function' && item.name === 'handleOps')!

describe('handleOps ABIs', () => {
  it('encode to the selectors of viem’s EntryPoint v0.6 and v0.7 ABIs', () => {
    expect(toFunctionSelector(handleOpsOf(entryPoint06HandleOpsAbi))).toBe('0x1fad948c')
    expect(toFunctionSelector(handleOpsOf(entryPoint06Abi))).toBe('0x1fad948c')
    expect(toFunctionSelector(handleOpsOf(entryPoint07HandleOpsAbi))).toBe('0x765e827f')
    expect(toFunctionSelector(handleOpsOf(entryPoint07Abi))).toBe('0x765e827f')
  })
})

describe('readBackCodes', () => {
  it('reads the suffix at the end of the input, and nothing from a suffix inside it', () => {
    expect(readBackCodes(withBuilderSuffix(SWAP), ACCOUNT)).toEqual([BUILDER_CODE])
    expect(readBackCodes(SWAP, ACCOUNT)).toBeNull()
    expect(readBackCodes(concat([withBuilderSuffix(SWAP), '0x00']), ACCOUNT)).toBeNull()
    expect(readBackCodes('0x', ACCOUNT)).toBeNull()
  })

  it.each(['0.6', '0.7'] as const)(
    'reads the end of the account’s user operation in an EntryPoint %s bundle',
    (entryPoint) => {
      const call = { to: ROUTER, value: 0n, data: SWAP, suffix: BUILDER_SUFFIX, entryPoint }
      expect(readBackCodes(bundleInput({ sender: ACCOUNT, ...call }), ACCOUNT)).toEqual([
        BUILDER_CODE,
      ])
      // Another account's user operation is not ours to read.
      expect(readBackCodes(bundleInput({ sender: OTHER, ...call }), ACCOUNT)).toBeNull()
      // No suffix from the wallet: none read.
      const plain = bundleInput({ sender: ACCOUNT, ...call, suffix: undefined })
      expect(readBackCodes(plain, ACCOUNT)).toBeNull()
    },
  )

  it.each(['0.6', '0.7'] as const)(
    'reads the account’s user operation in an EntryPoint %s bundle, never a suffix the bundler added',
    (entryPoint) => {
      const call = { sender: ACCOUNT, to: ROUTER, value: 0n, data: SWAP, entryPoint }
      // A bundler that appends its own code to the bundle: ours, in the user operation, counts.
      const theirs = concat([stringToHex('bc_lv99qw8t'), '0x0b00', `0x${'8021'.repeat(8)}`])
      const ours = bundleInput({ ...call, suffix: BUILDER_SUFFIX })
      expect(readBackCodes(concat([ours, theirs]), ACCOUNT)).toEqual([BUILDER_CODE])
      // Our suffix only on the bundle, none in the user operation: not attributed to the account.
      const plain = bundleInput({ ...call, suffix: undefined })
      expect(readBackCodes(concat([plain, BUILDER_SUFFIX]), ACCOUNT)).toBeNull()
    },
  )

  it('reads nothing when the suffix sits inside execute(…), wrapped by the wallet', () => {
    const wrapped = bundleInput({
      sender: ACCOUNT,
      to: ROUTER,
      value: 0n,
      data: SWAP,
      suffix: BUILDER_SUFFIX,
      inside: true,
    })
    expect(wrapped.includes(BUILDER_SUFFIX.slice(2))).toBe(true)
    expect(readBackCodes(wrapped, ACCOUNT)).toBeNull()
  })
})
