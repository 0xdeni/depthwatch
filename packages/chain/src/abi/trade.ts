/**
 * The ABIs a single-pool exact-input swap needs, and nothing more (docs/research/base-contracts.md,
 * `## trade`). Plain `as const` arrays with no import, so `@depthwatch/chain/addresses` stays
 * browser-safe. Each overload set is cut to the one overload the trade uses, so viem never has to
 * pick between overloads. Signatures as declared in the sources the deployments were built from:
 * - SwapRouter02: Uniswap/swap-router-contracts@v1.1.0 (the version Uniswap's Base deployments page
 *   names): `IV3SwapRouter.sol` (no deadline in the struct; recipient `address(2)` means the
 *   router itself, which keeps the output for `unwrapWETH9`), `IMulticallExtended.sol`
 *   (`multicall(uint256 deadline, bytes[])`), and v3-periphery `IPeripheryPayments.sol`,
 *   `IPeripheryImmutableState.sol`.
 * - QuoterV2: Uniswap/v3-periphery `IQuoterV2.sol` (non-view: call it with `eth_call` only).
 * - Slipstream SwapRouter and QuoterV2: aerodrome-finance/slipstream@f8717fa
 *   `contracts/periphery/{interfaces/ISwapRouter,interfaces/IQuoterV2,base/Multicall,
 *   base/PeripheryPayments,interfaces/IPeripheryImmutableState}.sol` (deadline in the struct, pools
 *   keyed by tick spacing, recipient `address(0)` means the router itself). Aero's SwapRouter
 *   (dromos-labs/metadex-slipstream-public@f99f209) declares the same struct, `multicall(bytes[])`
 *   and `unwrapWETH9(uint256,address)`.
 * - Metaquoter: dromos-labs/metadex-slipstream-public@f99f209 `IMetaquoter.sol` (pool addressed
 *   directly and authenticated through the FactoryRegistry). No quoter signals a partial fill, so
 *   the panel compares `sqrtPriceX96After` with the price limit for every quoter.
 * - Pools: v3-core `IUniswapV3PoolImmutables.sol`, Slipstream `ICLPoolConstants.sol` and
 *   `ICLPoolState.sol` (`fee()` is the live fee on Slipstream): the same five signatures.
 * - Factories: v3-core `IUniswapV3Factory.getPool(address,address,uint24)`, Slipstream and Aero
 *   `ICLFactory.getPool(address,address,int24)`.
 */

// `const` type parameters keep each name a literal, so viem types the tuple args by field name.
const address = <const N extends string>(name: N) => ({ name, type: 'address' }) as const
const uint256 = <const N extends string>(name: N) => ({ name, type: 'uint256' }) as const
const viewAddress = <const N extends string>(name: N) =>
  ({
    type: 'function',
    name,
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  }) as const

/** ERC-20 surface of an exact-amount approval and its balance checks. */
export const tradeErc20Abi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [address('spender'), uint256('amount')],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [address('owner'), address('spender')],
    outputs: [uint256('')],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [address('account')],
    outputs: [uint256('')],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

/** Uniswap SwapRouter02: `exactInputSingle` wrapped in `multicall(deadline, …)`. */
export const swapRouter02Abi = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          address('tokenIn'),
          address('tokenOut'),
          { name: 'fee', type: 'uint24' },
          address('recipient'),
          uint256('amountIn'),
          uint256('amountOutMinimum'),
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [uint256('amountOut')],
  },
  {
    type: 'function',
    name: 'multicall',
    stateMutability: 'payable',
    inputs: [uint256('deadline'), { name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
  {
    type: 'function',
    name: 'unwrapWETH9',
    stateMutability: 'payable',
    inputs: [uint256('amountMinimum'), address('recipient')],
    outputs: [],
  },
  // ETH in: `exactInputSingle` keeps no refund of its own, so the multicall ends with this.
  { type: 'function', name: 'refundETH', stateMutability: 'payable', inputs: [], outputs: [] },
  viewAddress('factory'),
  viewAddress('WETH9'),
] as const

/** Uniswap QuoterV2 (`eth_call` only). */
export const quoterV2Abi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          address('tokenIn'),
          address('tokenOut'),
          uint256('amountIn'),
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      uint256('amountOut'),
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      uint256('gasEstimate'),
    ],
  },
  viewAddress('factory'),
  viewAddress('WETH9'),
] as const

/** Slipstream SwapRouter (Aerodrome's three deployments and Aero's): deadline inside the struct. */
export const slipstreamSwapRouterAbi = [
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          address('tokenIn'),
          address('tokenOut'),
          { name: 'tickSpacing', type: 'int24' },
          address('recipient'),
          uint256('deadline'),
          uint256('amountIn'),
          uint256('amountOutMinimum'),
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [uint256('amountOut')],
  },
  {
    type: 'function',
    name: 'multicall',
    stateMutability: 'payable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
  {
    type: 'function',
    name: 'unwrapWETH9',
    stateMutability: 'payable',
    inputs: [uint256('amountMinimum'), address('recipient')],
    outputs: [],
  },
  viewAddress('factory'),
  viewAddress('WETH9'),
] as const

/** Slipstream QuoterV2 of the Aerodrome deployments (`eth_call` only). */
export const slipstreamQuoterV2Abi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          address('tokenIn'),
          address('tokenOut'),
          uint256('amountIn'),
          { name: 'tickSpacing', type: 'int24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      uint256('amountOut'),
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      uint256('gasEstimate'),
    ],
  },
  viewAddress('factory'),
  viewAddress('WETH9'),
] as const

/** Aero's Metaquoter (`eth_call` only): its `factoryRegistry()` stands in for `factory()`. */
export const metaquoterAbi = [
  {
    type: 'function',
    name: 'quoteExactInputSingleV3',
    stateMutability: 'nonpayable',
    inputs: [
      address('pool'),
      address('tokenIn'),
      uint256('amountIn'),
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    outputs: [
      uint256('amountOut'),
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
    ],
  },
  viewAddress('factoryRegistry'),
] as const

/** The pool identity reads of Uniswap v3 and Slipstream (Aerodrome and Aero) pools. */
export const tradePoolAbi = [
  viewAddress('factory'),
  viewAddress('token0'),
  viewAddress('token1'),
  {
    type: 'function',
    name: 'fee',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint24' }],
  },
  {
    type: 'function',
    name: 'tickSpacing',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'int24' }],
  },
] as const

/** `UniswapV3Factory.getPool`: pools keyed by fee. */
export const uniswapV3GetPoolAbi = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [address('tokenA'), address('tokenB'), { name: 'fee', type: 'uint24' }],
    outputs: [address('pool')],
  },
] as const

/** Slipstream and Aero `CLFactory.getPool`: pools keyed by tick spacing (the int24 overload). */
export const clFactoryGetPoolAbi = [
  {
    type: 'function',
    name: 'getPool',
    stateMutability: 'view',
    inputs: [address('tokenA'), address('tokenB'), { name: 'tickSpacing', type: 'int24' }],
    outputs: [address('pool')],
  },
] as const
