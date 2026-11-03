/**
 * Test helper: the transaction input of an ERC-4337 bundle as a smart wallet's bundler sends it,
 * `handleOps([userOp], beneficiary)` of EntryPoint v0.6 or v0.7, with the account's user operation
 * calling `execute(target, value, data)` and, when the wallet appends one, a data suffix at the end
 * of the user operation's `callData` (or, `inside: true`, our calldata carrying it instead: the
 * wrapped case that attributes nothing).
 */
import type { Address } from '@depthwatch/core'
import { concat, encodeFunctionData, type Hex, pad } from 'viem'
import { entryPoint06HandleOpsAbi, entryPoint07HandleOpsAbi } from '../trade/readBack.js'

const executeAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const

/** A bundler's beneficiary; any address does for the fake. */
const BENEFICIARY: Address = '0x00000000000000000000000000000000000b0d1e'

export interface BundleCall {
  sender: Address
  to: Address
  value: bigint
  data: Hex
  suffix?: Hex
  /** True: the suffix is appended to `data` inside `execute`, not to the user operation. */
  inside?: boolean
  entryPoint?: '0.6' | '0.7'
}

export function bundleInput(call: BundleCall): Hex {
  const suffix = call.suffix ?? '0x'
  const inner = call.inside ? concat([call.data, suffix]) : call.data
  const execute = encodeFunctionData({
    abi: executeAbi,
    functionName: 'execute',
    args: [call.to, call.value, inner],
  })
  const callData = call.inside ? execute : concat([execute, suffix])
  const common = { sender: call.sender, nonce: 0n, initCode: '0x' as Hex, callData }
  if (call.entryPoint === '0.7')
    return encodeFunctionData({
      abi: entryPoint07HandleOpsAbi,
      functionName: 'handleOps',
      args: [
        [
          {
            ...common,
            accountGasLimits: pad('0x01', { size: 32 }),
            preVerificationGas: 1n,
            gasFees: pad('0x01', { size: 32 }),
            paymasterAndData: '0x',
            signature: '0x',
          },
        ],
        BENEFICIARY,
      ],
    })
  return encodeFunctionData({
    abi: entryPoint06HandleOpsAbi,
    functionName: 'handleOps',
    args: [
      [
        {
          ...common,
          callGasLimit: 1n,
          verificationGasLimit: 1n,
          preVerificationGas: 1n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 1n,
          paymasterAndData: '0x',
          signature: '0x',
        },
      ],
      BENEFICIARY,
    ],
  })
}
