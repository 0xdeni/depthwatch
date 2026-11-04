/**
 * Test helper: the JSON-RPC answers of the fake wallet's chain (testing/fakeWallet.ts) for a block,
 * a receipt and a transaction, in the shapes viem decodes.
 */
import type { Address } from '@depthwatch/core'
import { type Hex, pad, toHex } from 'viem'

export const BLOCK = 30_000_000n
export const TIMESTAMP = 1_760_000_000n

/** A transaction the fake wallet mined. */
export interface MinedTx {
  tx: { from: Address; to: Address; value: bigint }
  /** The transaction's own outcome (always 0x1 for a bundle that carries a user operation). */
  outer: '0x1' | '0x0'
  input: Hex
  logs: unknown[]
}

/** `eth_getBlockByNumber` of the latest block. */
export function blockJson() {
  return {
    number: toHex(BLOCK),
    hash: pad('0x1', { size: 32 }),
    parentHash: pad('0x0', { size: 32 }),
    timestamp: toHex(TIMESTAMP),
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    baseFeePerGas: '0x1',
    transactions: [],
    uncles: [],
  }
}

/** `eth_getTransactionReceipt` of a mined transaction, in the block after the latest. */
export function receiptJson(hash: Hex, entry: MinedTx) {
  return {
    transactionHash: hash,
    transactionIndex: '0x0',
    blockHash: pad('0x1', { size: 32 }),
    blockNumber: toHex(BLOCK + 1n),
    from: entry.tx.from,
    to: entry.tx.to,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    effectiveGasPrice: '0x1',
    contractAddress: null,
    logs: entry.logs,
    logsBloom: `0x${'0'.repeat(512)}`,
    status: entry.outer,
    type: '0x2',
  }
}

/** `eth_getTransactionByHash` of a mined transaction: its input as the chain recorded it. */
export function transactionJson(hash: Hex, entry: MinedTx) {
  return {
    hash,
    input: entry.input,
    from: entry.tx.from,
    to: entry.tx.to,
    value: toHex(entry.tx.value),
    blockNumber: toHex(BLOCK + 1n),
    blockHash: pad('0x1', { size: 32 }),
    transactionIndex: '0x0',
    nonce: '0x0',
    gas: '0x5208',
    maxFeePerGas: '0x1',
    maxPriorityFeePerGas: '0x1',
    type: '0x2',
    chainId: '0x2105',
    v: '0x0',
    r: '0x1',
    s: '0x1',
  }
}
