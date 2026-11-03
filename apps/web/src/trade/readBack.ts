/**
 * The Builder Codes of a sent transaction, read back after its receipt and shown under Details
 * (never a reason to stop). ERC-8021 reads a suffix at the very end of the calldata it attributes,
 * so one place counts per transaction:
 * - the end of the account's own user operation `callData`, when the transaction is an ERC-4337
 *   bundle (`handleOps` of EntryPoint v0.6 or v0.7, the two encodings in use), as Base reads it;
 * - else the end of the transaction's input: an EOA, or a wallet that sends the calls from the
 *   account itself (an EIP-7702 account).
 * A suffix anywhere else, such as our calldata with its suffix wrapped inside a smart account's
 * `execute(…)`, attributes nothing and reads as not found.
 */
import { decodeFunctionData, type Hex } from 'viem'
import { decodeBuilderCodes } from './builderCode.js'

const bytes = (name: string) => ({ name, type: 'bytes' }) as const
const uint256 = (name: string) => ({ name, type: 'uint256' }) as const
const bytes32 = (name: string) => ({ name, type: 'bytes32' }) as const

const handleOps = <const C extends readonly { name: string; type: string }[]>(components: C) =>
  [
    {
      type: 'function',
      name: 'handleOps',
      stateMutability: 'nonpayable',
      inputs: [
        {
          name: 'ops',
          type: 'tuple[]',
          components: [
            { name: 'sender', type: 'address' },
            uint256('nonce'),
            bytes('initCode'),
            bytes('callData'),
            ...components,
          ],
        },
        { name: 'beneficiary', type: 'address' },
      ],
      outputs: [],
    },
  ] as const

/** EntryPoint v0.6 `handleOps(UserOperation[], address)`, selector 0x1fad948c. */
export const entryPoint06HandleOpsAbi = handleOps([
  uint256('callGasLimit'),
  uint256('verificationGasLimit'),
  uint256('preVerificationGas'),
  uint256('maxFeePerGas'),
  uint256('maxPriorityFeePerGas'),
  bytes('paymasterAndData'),
  bytes('signature'),
])

/** EntryPoint v0.7 `handleOps(PackedUserOperation[], address)`, selector 0x765e827f. */
export const entryPoint07HandleOpsAbi = handleOps([
  bytes32('accountGasLimits'),
  uint256('preVerificationGas'),
  bytes32('gasFees'),
  bytes('paymasterAndData'),
  bytes('signature'),
])

/** The user operations of a `handleOps` bundle (v0.6 or v0.7), or null when `input` is not one. */
function userOperations(input: Hex): readonly { sender: string; callData: Hex }[] | null {
  for (const abi of [entryPoint06HandleOpsAbi, entryPoint07HandleOpsAbi]) {
    try {
      return (decodeFunctionData({ abi, data: input }).args[0] ?? []) as readonly {
        sender: string
        callData: Hex
      }[]
    } catch {}
  }
  return null
}

/**
 * The Builder Codes of a transaction `input` sent for `account`: for an ERC-4337 bundle, the
 * suffix ending the account's own user operation (a bundler's suffix on the bundle itself is not
 * the account's); for anything else, the suffix ending the input. Null when there is none.
 */
export function readBackCodes(input: string, account: string): string[] | null {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(input)) return decodeBuilderCodes(input)
  const ops = userOperations(input as Hex)
  if (ops === null) return decodeBuilderCodes(input)
  const own = ops.find((op) => op.sender.toLowerCase() === account.toLowerCase())
  return own ? decodeBuilderCodes(own.callData) : null
}
