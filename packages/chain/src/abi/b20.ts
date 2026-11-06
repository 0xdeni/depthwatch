/**
 * A B20 Asset token (the stocks), only the functions Depthwatch reads, per Base's IB20 and
 * IB20Asset references (docs.base.org/specifications/b20/reference/interfaces):
 * - `multiplier()` (0x1b3ed722): shares per token, scaled to `WAD_PRECISION` (1e18), the effective
 *   multiplier at `block.timestamp`; an alias of ERC-8056's `uiMultiplier()`. Published, never
 *   applied to a feed's answer, which is already USD per token.
 * - `pausedFeatures()` (0xde9997e3): every `PausableFeature` paused at the block, an enum array
 *   (`uint8[]` on the wire: TRANSFER 0, MINT 1, BURN 2, SEIZE 3), "a set", empty when nothing is
 *   paused. Base prefers `isPaused(feature)` for one feature; Depthwatch publishes the whole set
 *   from this one call and takes TRANSFER from it.
 */
export const b20Abi = [
  {
    type: 'function',
    name: 'multiplier',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'pausedFeatures',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8[]' }],
  },
] as const
