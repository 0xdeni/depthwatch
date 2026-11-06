/**
 * Coinbase's oracle registry (`STOCK_PROTOCOL.oracleRegistry`), which the stocks' Chainlink feeds
 * read: `getOracleParams(token)` (0xd4197e82) answers the token's multiplier (WAD) and a paused
 * flag; a set flag freezes the feed through a corporate action.
 *
 * No document gives this ABI. Base's list-tokenized-stocks page describes "a single contract
 * (separate from the tokens) that returns both values for a token in one call" and names no
 * function. The name comes from earlier research; the selector is a PUSH4 in the contract's
 * bytecode, and at block 53,663,272 the call answered `(uint256, bool)`, the multiplier equal to
 * each stock's own `multiplier()` and the flag false, and reverted for USDC and for an unregistered
 * B20 address (docs/research/base-contracts.md, `## stocks` and §2.14). An answer that does not
 * decode so leaves the reading `unread`.
 */
export const coinbaseOracleRegistryAbi = [
  {
    type: 'function',
    name: 'getOracleParams',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      { name: 'multiplier', type: 'uint256' },
      { name: 'paused', type: 'bool' },
    ],
  },
] as const
