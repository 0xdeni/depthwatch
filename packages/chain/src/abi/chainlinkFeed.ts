/**
 * A Chainlink feed proxy (AggregatorV3Interface), only the functions Depthwatch reads: the stocks'
 * "Coinbase <ticker>" feeds (`STOCK_FEEDS`), read on chain at the snapshot's block. On Base each
 * proxy answers `decimals()` 8, `description()` 'Coinbase <ticker>' and `latestRoundData()` with
 * `roundId` = `answeredInRound` (docs/research/base-contracts.md §2.14).
 */
export const chainlinkFeedAbi = [
  {
    type: 'function',
    name: 'latestRoundData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'description',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const
