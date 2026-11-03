# Base mainnet reference: contracts, ABIs and facts used by Depthwatch

Compiled from official docs, GitHub sources and explorers on 2026-10-23.
Each address lists its sources and an independent-verification verdict. Items marked **unconfirmed** must be
checked on first live run (`depthwatch discover` reads factory logs, which is the ground truth).
Every address in `packages/chain/src/addresses.ts` was verified on chain on 2026-10-25 at block
53,061,932 (code present plus one contract-specific view each; see §2.8 of the open items
below), with no mismatch; §2.8 also flags the Aerodrome Voter's current state. The Aero entries
(`## aero`, added on 2026-10-28 after Aerodrome became Aero) were read on chain at blocks
53,211,601–53,213,030 (§2.9). The trade routers and quoters and the token checks behind the trade
allowlist (`## trade`) were read on 2026-11-03 at blocks 53,467,794–53,468,151 through the public
endpoint `https://mainnet.base.org` (§2.10, §2.11).

Base-native addresses (here the `weth` WETH9 predeploy) can also be re-checked on the first live run against Base's contract-address reference, <https://docs.base.org/specifications/reference/base-contracts.md>, which Base's AGENTS.md describes as "canonical contract addresses for Base Mainnet and Base Sepolia" (see [../base/base-agents-reference.md](../base/base-agents-reference.md)). Whether that page lists any DEX or Multicall3 address is unverified: those stay tied to the per-address sources and verdicts below and to the factory logs read on the first live run.

Chain: Base mainnet, chainId 8453.


## uniswap-v3

| key                                       | name                                                     | address                                      | source confidence | independent check |
| ----------------------------------------- | -------------------------------------------------------- | -------------------------------------------- | ----------------- | ----------------- |
| `uniswap_v3_factory`                      | UniswapV3Factory (Base mainnet)                          | `0x33128a8fC17869897dcE68Ed026d694621f6FDfD` | high              | confirmed         |
| `uniswap_v3_nonfungible_position_manager` | NonfungiblePositionManager (Base mainnet)                | `0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1` | high              | confirmed         |
| `uniswap_v3_tick_lens`                    | TickLens (Base mainnet)                                  | `0x0CdeE061c75D43c82520eD998C23ac2991c9ac6d` | high              | confirmed         |
| `uniswap_v3_quoter_v2`                    | QuoterV2 (Base mainnet)                                  | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` | high              | confirmed         |
| `uniswap_v3_swap_router_02`               | SwapRouter02 (Base mainnet)                              | `0x2626664c2603336E57B271c5C0b26F421741e481` | high              | confirmed         |
| `uniswap_v3_pool_weth_usdc_500`           | Uniswap v3 WETH/USDC 0.05% (fee=500) pool (Base mainnet) | `0xd0b53D9277642d899DF5C87A3966A349A798F224` | high              | confirmed         |
| `uniswap_interface_multicall`             | Multicall (UniswapInterfaceMulticall, Base mainnet)      | `0x091e99cb1C49331a94dD62755D168E941AbD0693` | high              | confirmed         |
| `weth`                                    | WETH9 (OP-stack predeploy, Base mainnet)                 | `0x4200000000000000000000000000000000000006` | high              | confirmed         |
| `usdc`                                    | USDC (native Circle USDC, Base mainnet)                  | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | high              | confirmed         |

Sources and notes per item:
- `uniswap_v3_factory`: <https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v3/deployments/v3-base-deployments.mdx>, <https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments>, <https://raw.githubusercontent.com/Uniswap/sdk-core/main/src/addresses.ts>, <https://docs.base.org/chain/contracts>, <https://github.com/Uniswap/docs/pull/629/files>
  - Listed identically in the official Uniswap deployments page (GitHub source of developers.uniswap.org), @uniswap/sdk-core BASE_ADDRESSES.v3CoreFactoryAddress (ChainId.BASE = 8453), and Base's own contracts page. EIP-55 checksum verified locally.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/universal-router/main/script/deployParameters/DeployBase.s.sol (v3Factory); https://raw.githubusercontent.com/Uniswap/v3-subgraph/main/config/base/config.json and https://raw.githubusercontent.com/Uniswap/v3-subgraph/main/config/base/chain.ts (FACTORY_ADDRESS); https://raw.githubusercontent.com/BowTiedDevil/degenbot/main/src/degenbot/uniswap/deployments.py (BaseUniswapV3 factory); https://raw.githubusercontent.com/tradingstrategy-ai/web3-ethereum-defi/master/eth_defi/uniswap_v3/constants.py ("base" factory); https://pkg.go.dev/github.com/aicora/w3x/dex/uniswap/core (BaseAddresses.V3CoreFactoryAddress)> — Could not refute. Five sources outside the list above (Uniswap universal-router deploy params for Base, Uniswap v3-subgraph Base config, two third-party Python libraries, and a third-party Go port) all give the identical address for Base mainnet. The universal-router file is unambiguously Base mainnet (it pairs this factory with v4 PoolManager 0x498581fF718922c3f8e6A244956aF099B2652b2b and WETH 0x4200...0006). No conflicting address found anywhere.
- `uniswap_v3_nonfungible_position_manager`: <https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v3/deployments/v3-base-deployments.mdx>, <https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments>, <https://raw.githubusercontent.com/Uniswap/sdk-core/main/src/addresses.ts>, <https://docs.base.org/chain/contracts>
  - sdk-core: BASE_ADDRESSES.nonfungiblePositionManagerAddress; Base docs label it nonfungibleTokenPositionManager. ERC-721 (OpenZeppelin 3.4.2-solc-0.7). Base Sepolia uses a different address (0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2) - do not mix up.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/universal-router/main/script/deployParameters/DeployBase.s.sol (v3NFTPositionManager); https://raw.githubusercontent.com/tradingstrategy-ai/web3-ethereum-defi/master/eth_defi/uniswap_v3/constants.py ("base" position_manager); https://pkg.go.dev/github.com/aicora/w3x/dex/uniswap/core (BaseAddresses.NonfungiblePositionManagerAddress)> — Could not refute. Uniswap's own universal-router Base-mainnet deploy parameters, a third-party Python library (tradingstrategy) and a third-party Go library all list the same address. Basescan NFT pages for this contract (e.g. /nft/0x03a520b3.../1778385, titled 'Uniswap - 0.05% - USDC/WETH') also surfaced in search, consistent with it being the Base NPM. No conflicting address found.
- `uniswap_v3_tick_lens`: <https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v3/deployments/v3-base-deployments.mdx>, <https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments>, <https://raw.githubusercontent.com/Uniswap/sdk-core/main/src/addresses.ts>, <https://docs.base.org/chain/contracts>
  - sdk-core: BASE_ADDRESSES.tickLensAddress.
  - verifier: confirmed via <https://pkg.go.dev/github.com/aicora/w3x/dex/uniswap/core (BaseAddresses.TickLensAddress, fetched directly); https://basescan.org/address/0x0CdeE061c75D43c82520eD998C23ac2991c9ac6d (search-result title 'Uniswap V3: Tick Lens'); https://gov.uniswap.org/t/official-uniswap-v3-deployments-list/24323 (search snippet: TickLens on Base, deployed by GFX Labs); https://raw.githubusercontent.com/Uniswap/sdks/main/sdks/sdk-core/src/addresses.ts (tickLensAddress, same codebase as sdk-core but different repo)> — Could not refute. Directly fetched third-party Go port (aicora/w3x) gives the identical TickLens address for chain 8453. Basescan's explorer label 'Uniswap V3: Tick Lens' and the Uniswap governance forum's official deployments list both surfaced in search results for this exact address (basescan.org and gov.uniswap.org: unverified). Plain web search for the bare address returns nothing, which is normal for a rarely-referenced lens contract. No conflicting address found.
- `uniswap_v3_quoter_v2`: <https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v3/deployments/v3-base-deployments.mdx>, <https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments>, <https://docs.base.org/chain/contracts>, <https://raw.githubusercontent.com/Uniswap/sdk-core/main/src/addresses.ts>
  - Official Uniswap page and Base docs both label this address QuoterV2; sdk-core stores it as BASE_ADDRESSES.quoterAddress. Quote functions are non-view (must be eth_call'ed/simulated). A third-party Cobo recipe shows a different-looking 'QuoterV2' (0x3d4e44Eb1374240CE5F1B136041212E6B3B8Df87) that disagrees with all official sources - treat as a typo.
  - verifier: confirmed via <https://raw.githubusercontent.com/tradingstrategy-ai/web3-ethereum-defi/master/eth_defi/uniswap_v3/constants.py ("base": quoter = 0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a with quoter_v2: True); https://pkg.go.dev/github.com/aicora/w3x/dex/uniswap/core (BaseAddresses.QuoterAddress)> — Could not refute. Two third-party sources (tradingstrategy's Python library, which explicitly flags it as a QuoterV2 deployment, and a Go port) give the identical address. Caveat worth knowing: Uniswap's smart-order-router (https://raw.githubusercontent.com/Uniswap/smart-order-router/main/src/util/addresses.ts) defines a separate NEW_QUOTER_V2_ADDRESSES[ChainId.BASE] = 0x222cA98F00eD15B1faE10B61c277703a194cf5d2 (a newer quoter deployment used by the router) while still resolving QUOTER_V2_ADDRESSES from sdk-core's quoterAddress; the canonical v3 QuoterV2 for Base remains 0x3d4e44...B76a. The Cobo '0x3d4e44Eb1374240CE5F1B136041212E6B3B8Df87' variant is not corroborated anywhere.
- `uniswap_v3_swap_router_02`: <https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v3/deployments/v3-base-deployments.mdx>, <https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments>, <https://raw.githubusercontent.com/Uniswap/sdk-core/main/src/addresses.ts>, <https://docs.base.org/chain/contracts>
  - sdk-core: BASE_ADDRESSES.swapRouter02Address; Base docs label it simply 'swapRouter'. Uniswap docs note UniversalRouter is now the preferred swap entrypoint, but SwapRouter02 remains deployed and is fine for read-only/simulation use.
  - verifier: confirmed via <https://www.cobo.com/agentic-wallet/recipes/uniswap-v3-swap (search snippet: 'swap_router_02 (BASE_ETH): 0x2626664c2603336E57B271c5C0b26F421741e481'); https://pkg.go.dev/github.com/aicora/w3x/dex/uniswap/core (BaseAddresses.SwapRouter02Address, fetched directly)> — Could not refute. Third-party Go port and the Cobo integration recipe both give the identical address for Base mainnet (cobo.com: unverified). Note: tradingstrategy's web3-ethereum-defi lists a different Base 'router' (0x5788F91Aa320e0610122fb88B39Ab8f35e50040b) but its own source comment says this is 'SwapRouter02 deployed by Mikko' from tradingstrategy-ai/swap-router-contracts, i.e. their private redeploy, not Uniswap's canonical SwapRouter02, so it does not contradict the claim. Ethereum/Polygon SwapRouter02 is 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45, must not be reused on Base.
  - 2026-11-03: re-cited from Uniswap's own deployments page and deployment registry and read on chain (`factory()`, `WETH9()`); see `## trade` and §2.10.
- `uniswap_v3_pool_weth_usdc_500`: <https://basescan.org/nft/0x03a520b32c04bf3beef7beb72e919cf822ed34f1/266333>, <https://www.geckoterminal.com/base/pools/0xd0b53d9277642d899df5c87a3966a349a798f224>, <https://defillama.com/yields/pool/8b3cadb9-b9f1-4539-998c-18c02e9e65a0>, <https://dexscreener.com/base/0xd0b53d9277642d899df5c87a3966a349a798f224>, <https://dexrabbit.bitquery.io/base/pool/0xd0b53d9277642d899df5c87a3966a349a798f224>
  - Basescan's NFT page for NPM position #266333 (search snippet) lists this pool address with USDC 0x8335...2913, WETH 0x4200...0006, Fee Tier 0.05%; GeckoTerminal titles it 'USDC/WETH on Uniswap V3 (Base) with 0.05% Fee'; DeFiLlama lists WETH-USDC 0.05% Uniswap V3 Base with this address. token0 = WETH (0x4200...0006), token1 = USDC (0x8335...2913) by the factory's address-sort rule (lower address is token0); fee = 500, tickSpacing = 10. Aggregator snapshots: TVL ~$8.6M (Dexscreener), ~$10.5M (DeFiLlama), ~$13.4M (Bitquery, Mar 2026). The explorer page itself is unverified - confirm token0()/fee() at first run.
  - verifier: confirmed via <https://basescan.org/nft/0x03a520b32c04bf3beef7beb72e919cf822ed34f1/1778385 (search-result title 'Uniswap - 0.05% - USDC/WETH', a different position from #266333 above; snippet lists this pool address with USDC 0x8335...2913, WETH 0x4200...0006, Fee Tier 0.05%); https://dexpaprika.com/base/pool/0xd0b53d9277642d899df5c87a3966a349a798f224 and https://dexpaprika.com/base/uniswap_v3 (search snippets, pool created 2023-09-06); https://tradingstrategy.ai/trading-view/base/uniswap-v3/eth-usdc-fee-5 (search result for this address; URL slug = ETH-USDC 5 bps on Uniswap v3 Base)> — Could not refute, but confirmation rests on search-engine snippets only (basescan.org, dexpaprika.com, tradingstrategy.ai, coingecko.com and the explorer/aggregator APIs blockscout, sourcify, etherscan v2, routescan, dexscreener and geckoterminal are unverified), and no fetchable file was found that hardcodes this pool. All snippets agree: Uniswap v3, Base, WETH/USDC, 0.05% fee. Note that Uniswap's own v3-subgraph Base config (https://raw.githubusercontent.com/Uniswap/v3-subgraph/main/config/base/chain.ts) uses a different reference pool, STABLE_TOKEN_POOL = 0x4c36388be6f416a29c8d8eee81c771ce6be14b18 (the older WETH/USDbC pool), which does not contradict this pool's identity but is a reminder that WETH/USDbC pools also exist. token0/token1 ordering and fee=500/tickSpacing=10 should still be verified on-chain at first run as noted above.
- `uniswap_interface_multicall`: <https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v3/deployments/v3-base-deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/sdk-core/main/src/addresses.ts>
  - Not requested, but useful for batching ticks()/tickBitmap() reads. Listed as 'Multicall' on the current Uniswap page and 'Multicall2' in the older docs table; sdk-core BASE_ADDRESSES.multicallAddress.
  - verifier: confirmed via <https://pkg.go.dev/github.com/aicora/w3x/dex/uniswap/core (BaseAddresses.MulticallAddress, fetched directly); https://docs.base.org/chain/contracts (search snippet: listed as 'multicall' under Base Mainnet Uniswap v3 section, different domain from the two sources listed for this item); https://raw.githubusercontent.com/Uniswap/sdks/main/sdks/sdk-core/src/addresses.ts (multicallAddress)> — Could not refute. Third-party Go port and Base's own contracts page both give the identical UniswapInterfaceMulticall address for Base mainnet (docs.base.org: unverified). Do not confuse with the generic Multicall3 at 0xcA11bde05977b3631167028862bE2a173976CA11 (also listed on docs.base.org), which has a different ABI (aggregate3) and is deployed at the same address on Base.
- `weth`: <https://raw.githubusercontent.com/ethereum-optimism/specs/main/specs/protocol/predeploys.md>, <https://docs.base.org/chain/base-contracts>, <https://basescan.org/nft/0x03a520b32c04bf3beef7beb72e919cf822ed34f1/266333>
  - OP-stack WETH9 predeploy (not proxied). 18 decimals (standard WETH9; not re-fetched).
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/universal-router/main/script/deployParameters/DeployBase.s.sol (weth9); https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json (chainId 8453, WETH, 18 decimals); https://raw.githubusercontent.com/Uniswap/v3-subgraph/main/config/base/chain.ts (REFERENCE_TOKEN); https://pkg.go.dev/github.com/aicora/w3x/dex/uniswap/core (WETH9[8453])> — Could not refute. Uniswap's default token list confirms chainId 8453, symbol WETH, name 'Wrapped Ether', decimals 18 at this address; universal-router Base deploy params and the v3-subgraph Base config use the same address as WETH9/reference token. Standard OP-stack predeploy address.
- `usdc`: <https://circle.com/blog/usdc-now-available-natively-on-base>, <https://www.circle.com/en/multi-chain-usdc/base>, <https://basescan.org/nft/0x03a520b32c04bf3beef7beb72e919cf822ed34f1/266333>
  - Native USDC. Do not confuse with bridged USDbC 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA (older Base pools pair WETH with USDbC). 6 decimals (standard; not re-fetched).
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json (chainId 8453, 'USD Coin', USDC, 6 decimals; also lists USDbC 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA separately); https://developers.circle.com/stablecoins/usdc-contract-addresses (search snippet: Base = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913); https://eco.com/support/en/articles/14998918-usdc-on-base-native-vs-bridged-guide (search snippet, distinguishes native USDC from USDbC 0xd9aA...b6Ca)> — Could not refute. Uniswap's default token list (fetched directly) confirms chainId 8453, symbol USDC, 6 decimals at this address and lists bridged USDbC at the separate 0xd9aAEc86... address, exactly as noted above; Circle's developer docs and a third-party guide agree. One oddity found: Uniswap's v3-subgraph Base config (config/base/chain.ts) whitelists '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e' as USDC, which is actually Avalanche's native USDC address, so that file appears to carry a copy-paste bug and should not be used as a reference for Base USDC.

Unresolved:
- "Deepest ETH/USD pool on Base" claim for 0xd0b53D9277642d899DF5C87A3966A349A798F224 could not be verified live: aggregator snippets show ~$8.6M-$13.4M liquidity/TVL at different dates; Aerodrome Slipstream WETH/USDC and Uniswap v4 ETH/USDC pools on Base may be comparable or deeper. Rank by on-chain depth at runtime rather than hard-coding this as the deepest.
- token0/token1 for the WETH/USDC 500 pool (token0 = WETH 0x4200...0006, token1 = USDC 0x8335...2913) is derived from the factory's address-sort rule plus the token addresses, not read from the pool's token0()/token1() (not read on chain or from an explorer). Verify on first run.
- Pool creation block/timestamp for the WETH/USDC 500 pool is unconfirmed (one aggregator, dexpaprika, says created 2023-09-06; Dexscreener shows a different date). Needed for log-backfill start; derive from the factory PoolCreated log instead.
- Whether the Base UniswapV3Factory has fee tier 100 (tickSpacing 1) enabled - common on Base for stable pairs - was not confirmed; read factory.feeAmountTickSpacing(100) or scan FeeAmountEnabled logs.
- Citations of basescan.org, developers.uniswap.org, docs.base.org, dexscreener, geckoterminal and defillama come from search-result snippets of those pages (unverified in full), while the authoritative tables were read from the GitHub sources of the Uniswap docs (raw.githubusercontent.com/Uniswap/docs/main/content/...) and @uniswap/sdk-core.
- WETH decimals (18) and USDC decimals (6) are stated from standard knowledge, not fetched; read decimals() at runtime.
- Depth formulas (SqrtPriceMath / LiquidityAmounts) were not re-fetched from source; they are the standard whitepaper formulas and should be unit-tested against QuoterV2 eth_call results.

### Technical notes

#### Uniswap v3 on Base (chainId 8453) - ABI / event reference

All Solidity signatures below were read verbatim from the Uniswap v3-core / v3-periphery `main` branches on GitHub. Event topic0 hashes and 4-byte selectors were computed locally with a pure-Python keccak-256 that was validated against the canonical ERC-721 `Transfer` topic (`0xddf252ad...b3ef`).

#### UniswapV3Factory

Source: https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/interfaces/IUniswapV3Factory.sol and https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/UniswapV3Factory.sol

```solidity
event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool);
// topic0 = 0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118
// topics[1]=token0, topics[2]=token1, topics[3]=fee ; data = abi.encode(int24 tickSpacing, address pool)

event FeeAmountEnabled(uint24 indexed fee, int24 indexed tickSpacing);
// topic0 = 0xc66a3fdf07232cdd185febcc6579d408c241b47ae2f9907d84be655141eeaecc

function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool); // 0x1698ee82
function feeAmountTickSpacing(uint24 fee) external view returns (int24);
```

- Token ordering (UniswapV3Factory.createPool): `(token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA)` - lower address is token0. Hence WETH (0x4200...0006) is token0 and USDC (0x8335...2913) is token1 in every Base WETH/USDC v3 pool.
- Constructor defaults: `feeAmountTickSpacing[500] = 10; [3000] = 60; [10000] = 200`. Additional tiers (e.g. 100 -> 1) can be enabled by governance via `enableFeeAmount`; detect by scanning `FeeAmountEnabled` logs from the factory (see unresolved).

#### IUniswapV3Pool read functions (order of return values matters for ABI decoding)

Sources: https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/interfaces/pool/IUniswapV3PoolState.sol and https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/interfaces/pool/IUniswapV3PoolImmutables.sol

```solidity
// Immutables
function factory() external view returns (address);
function token0() external view returns (address);      // 0x0dfe1681
function token1() external view returns (address);      // 0xd21220a7
function fee() external view returns (uint24);          // 0xddca3f43  (500 = 0.05%)
function tickSpacing() external view returns (int24);   // 0xd0c93a7c  (10 for fee 500)
function maxLiquidityPerTick() external view returns (uint128);

// State
function slot0() external view returns (             // 0x3850c7bd
    uint160 sqrtPriceX96,            // sqrt(token1/token0) * 2^96
    int24   tick,
    uint16  observationIndex,
    uint16  observationCardinality,
    uint16  observationCardinalityNext,
    uint8   feeProtocol,
    bool    unlocked
);
function liquidity() external view returns (uint128);       // 0x1a686502 - in-range liquidity only
function tickBitmap(int16 wordPosition) external view returns (uint256);   // 0x5339c296
function ticks(int24 tick) external view returns (           // 0xf30dba93
    uint128 liquidityGross,
    int128  liquidityNet,
    uint256 feeGrowthOutside0X128,
    uint256 feeGrowthOutside1X128,
    int56   tickCumulativeOutside,
    uint160 secondsPerLiquidityOutsideX128,
    uint32  secondsOutside,
    bool    initialized
);
function feeGrowthGlobal0X128() external view returns (uint256);
function feeGrowthGlobal1X128() external view returns (uint256);
function positions(bytes32 key) external view returns (uint128 _liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1);
function observations(uint256 index) external view returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized);
```

#### IUniswapV3Pool events

Source: https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/interfaces/pool/IUniswapV3PoolEvents.sol

```solidity
event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick);
// topic0 = 0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67
// amount0/amount1 are signed deltas from the pool's perspective (positive = pool received)

event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1);
// topic0 = 0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde
event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1);
// topic0 = 0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c
event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1);
// topic0 = 0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0
event Initialize(uint160 sqrtPriceX96, int24 tick);
// topic0 = 0x98636036cb66a9c19a37435efc1e90142190214e8abeb821bdba3f2990dd4c95
event Flash(address indexed sender, address indexed recipient, uint256 amount0, uint256 amount1, uint256 paid0, uint256 paid1);
// topic0 = 0xbdbdb71d7860376ba52b25a5028beea23581364a40522f6bcfb86bb1f2dca633
```

#### TickLens

Source: https://raw.githubusercontent.com/Uniswap/v3-periphery/main/contracts/interfaces/ITickLens.sol and https://raw.githubusercontent.com/Uniswap/v3-periphery/main/contracts/lens/TickLens.sol

```solidity
struct PopulatedTick { int24 tick; int128 liquidityNet; uint128 liquidityGross; }
function getPopulatedTicksInWord(address pool, int16 tickBitmapIndex) external view returns (PopulatedTick[] memory populatedTicks); // 0x351fb478
```
Implementation: reads `bitmap = pool.tickBitmap(tickBitmapIndex)`, and for each set bit `i` computes `tick = ((int24(tickBitmapIndex) << 8) + int24(i)) * tickSpacing`, then `(liquidityGross, liquidityNet, ...) = pool.ticks(tick)`. The returned array is in DESCENDING tick order (array filled from the end). Word/bit mapping (v3-core TickBitmap.sol, https://raw.githubusercontent.com/Uniswap/v3-core/main/contracts/libraries/TickBitmap.sol): the bitmap is indexed by the compressed tick `c = tick / tickSpacing` (only ticks with `tick % tickSpacing == 0` can be initialized); `wordPos = int16(c >> 8)`, `bitPos = uint8(c % 256)`. For an arbitrary (unaligned) current tick use floor division: `c = floor(tick / tickSpacing)` (decrement when tick < 0 and not aligned), then `wordPos = c >> 8` (arithmetic shift). For ±5% depth around the current price you need ticks within about ±488 ticks (ln(1.05)/ln(1.0001) ≈ 488), i.e. ±49 compressed ticks at spacing 10 - at most 2 bitmap words either side of the current word.

#### NonfungiblePositionManager

Source: https://raw.githubusercontent.com/Uniswap/v3-periphery/main/contracts/interfaces/INonfungiblePositionManager.sol ; Transfer from OpenZeppelin IERC721 at the version pinned by v3-periphery (`@openzeppelin/contracts` 3.4.2-solc-0.7, https://raw.githubusercontent.com/Uniswap/v3-periphery/main/package.json): https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v3.4.2-solc-0.7/contracts/token/ERC721/IERC721.sol

```solidity
event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
// topic0 = 0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f
event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
// topic0 = 0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4
event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1);
// topic0 = 0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01
event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);   // ERC-721
// topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef (mint: from = 0x0; burn: to = 0x0)

function positions(uint256 tokenId) external view returns (   // 0x99fbab88
    uint96  nonce,
    address operator,
    address token0,
    address token1,
    uint24  fee,
    int24   tickLower,
    int24   tickUpper,
    uint128 liquidity,
    uint256 feeGrowthInside0LastX128,
    uint256 feeGrowthInside1LastX128,
    uint128 tokensOwed0,
    uint128 tokensOwed1
);
```
Notes: NPM events do not carry the pool address; map tokenId -> pool via `positions(tokenId)` (token0, token1, fee) + `factory.getPool(...)`. IncreaseLiquidity is emitted on mint too (the first IncreaseLiquidity for a tokenId follows its Transfer from 0x0). Positions minted directly on the pool (not via NPM) show up only as pool `Mint`/`Burn` events with `owner` = the minting contract, so LP-concentration must union both sources (owner = NPM address covers NPM positions).

#### QuoterV2 (for effective-spread via simulation)

Source: https://raw.githubusercontent.com/Uniswap/v3-periphery/main/contracts/interfaces/IQuoterV2.sol
```solidity
struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }
struct QuoteExactOutputSingleParams { address tokenIn; address tokenOut; uint256 amount; uint24 fee; uint160 sqrtPriceLimitX96; }
function quoteExactInputSingle(QuoteExactInputSingleParams memory params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate); // 0xc6a5026a
function quoteExactOutputSingle(QuoteExactOutputSingleParams memory params) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
function quoteExactInput(bytes memory path, uint256 amountIn) external returns (uint256 amountOut, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate);
function quoteExactOutput(bytes memory path, uint256 amountOut) external returns (uint256 amountIn, uint160[] memory sqrtPriceX96AfterList, uint32[] memory initializedTicksCrossedList, uint256 gasEstimate);
```
These are state-mutating in the ABI (they revert internally); call via `eth_call` only. `sqrtPriceLimitX96 = 0` means no limit.

#### Depth math (standard Uniswap v3 formulas; whitepaper §6 / v3-core SqrtPriceMath.sol & v3-periphery LiquidityAmounts.sol - not re-fetched)

- price(token1 per token0, raw units) = (sqrtPriceX96 / 2^96)^2 ; human price = raw * 10^(dec0 - dec1). For WETH/USDC: USDC per WETH = raw * 10^(18-6).
- tick <-> price: p = 1.0001^tick ; sqrtP(tick) = 1.0001^(tick/2).
- Within one tick range with active liquidity L moving price from sqrtPa to sqrtPb (sqrtPa < sqrtPb): token0 amount = L * (sqrtPb - sqrtPa) / (sqrtPa * sqrtPb); token1 amount = L * (sqrtPb - sqrtPa). (Use Q64.96 scaling: divide by 2^96 appropriately.)
- Walk ticks: start at slot0 (sqrtPriceX96, tick, liquidity). Moving up (buy token0 with token1) liquidity changes by +liquidityNet at each initialized tick crossed; moving down, by -liquidityNet. Sum token amounts until target price (±1/2/5%) is reached. Fee (0.05%) applies to the input amount for effective-spread; the ±X% depth itself is fee-exclusive.
- tickBitmap word range for ±5%: current compressed tick ±49 (spacing 10) -> read words [wordPos-1 .. wordPos+1] (safe: ±2) via TickLens.getPopulatedTicksInWord, or multicall `ticks()` over set bits.

#### Deployment-page provenance

- Current official page (GitHub source of https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments): https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v3/deployments/v3-base-deployments.mdx - Base mainnet table: UniswapV3Factory 0x33128a8fC17869897dcE68Ed026d694621f6FDfD; Multicall 0x091e99cb1C49331a94dD62755D168E941AbD0693; ProxyAdmin 0x3334d83e224aF5ef9C2E7DDA7c7C98Efd9621fA9; TickLens 0x0CdeE061c75D43c82520eD998C23ac2991c9ac6d; NFTDescriptor 0xF9d1077fd35670d4ACbD27af82652a8d84577d9F; NonfungibleTokenPositionDescriptor 0x4f225937EDc33EFD6109c4ceF7b560B2D6401009; TransparentUpgradeableProxy 0x4615C383F85D0a2BbED973d83ccecf5CB7121463; NonfungiblePositionManager 0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1; V3Migrator 0x23cF10b1ee3AdfCA73B0eF17C07F7577e7ACd2d7; QuoterV2 0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a; SwapRouter02 0x2626664c2603336E57B271c5C0b26F421741e481; Permit2 0x000000000022D473030F116dDEE9F6B43aC78BA3; UniversalRouter 0x6fF5693b99212Da76ad316178A184AB56D299b43; v3StakerAddress 0x42bE4D6527829FeFA1493e1fb9F3676d2425C3C1.
- The older docs table (https://github.com/Uniswap/docs/pull/629/files) lists the same core addresses but UniversalRouter = 0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC (v1); the current page shows the newer UR. Not needed for Depthwatch.
- All addresses above pass EIP-55 checksum (verified locally).


## uniswap-v4

| key                               | name                                                                                                   | address                                      | source confidence | independent check |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------- | ----------------- |
| `uniswap_v4_pool_manager`         | Uniswap v4 PoolManager (Base mainnet)                                                                  | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | high              | confirmed         |
| `uniswap_v4_state_view`           | Uniswap v4 StateView (Base mainnet)                                                                    | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` | high              | confirmed         |
| `uniswap_v4_position_manager`     | Uniswap v4 PositionManager (Base mainnet)                                                              | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` | high              | confirmed         |
| `uniswap_v4_quoter`               | Uniswap V4Quoter (Base mainnet) - current, msgSender-capable deployment                                | `0xE1A6C5803e3c44368b171BD680c7D32dfc92CA47` | high              | confirmed         |
| `uniswap_v4_quoter_legacy`        | Uniswap V4Quoter (Base mainnet) - original Jan-2025 deployment, still shown on docs page               | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` | high              | confirmed         |
| `uniswap_universal_router`        | Uniswap Universal Router v2.0 (Base mainnet) - the row labelled 'Universal Router' on the v4 docs page | `0x6fF5693b99212Da76ad316178A184AB56D299b43` | high              | confirmed         |
| `uniswap_universal_router_v2_1_1` | Uniswap Universal Router v2.1.1 (Base mainnet)                                                         | `0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7` | high              | confirmed         |
| `uniswap_universal_router_v2_1_2` | Uniswap Universal Router v2.1.2 (Base mainnet) - registry's current 'UniversalRouter' alias            | `0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40` | high              | confirmed         |
| `uniswap_universal_router_v2_2_0` | Uniswap Universal Router v2.2.0 (Base mainnet)                                                         | `0xBE2257d1aAfBE6B73F67A9ac971C2F0B344Bb3c5` | medium            | confirmed         |
| `permit2`                         | Permit2 (Base mainnet, canonical cross-chain address)                                                  | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | high              | confirmed         |
| `uniswap_v4_position_descriptor`  | Uniswap v4 PositionDescriptor proxy (Base mainnet)                                                     | `0x25D093633990DC94BeDEeD76C8F3CDaa75f3E7D5` | high              | confirmed         |

Sources and notes per item:
- `uniswap_v4_pool_manager`: <https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>, <https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts>
  - Singleton holding all v4 pools. Emits Initialize/Swap/ModifyLiquidity. Same value in the official docs deployments page (Base: 8453 section), the Uniswap/contracts deployments registry (latest.PoolManager) and sdk-core BASE_ADDRESSES.v4PoolManagerAddress. Checksum computed locally (EIP-55).
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/v4-subgraph/main/src/utils/chains.ts (base config poolManagerAddress: 0x498581ff718922c3f8e6a244956af099b2652b2b); also https://github.com/flayerlabs/flaunchgg-contracts/releases (v1.1.5-base release, PoolManager 0x498581ff718922c3f8e6a244956af099b2652b2b)> — Case-insensitive match in two sources not cited above: Uniswap's own v4-subgraph repo (different repo from the cited docs/contracts/sdks) and a third-party protocol's (flaunch) Base release notes. Could not refute. Basescan unverified, but no conflicting address found anywhere.
- `uniswap_v4_state_view`: <https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>, <https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts>, <https://github.com/Uniswap/v4-periphery/blob/main/src/lens/StateView.sol>
  - Read-only lens over PoolManager via StateLibrary/extsload; NatSpec: 'The contract is intended for offchain clients. Use StateLibrary.sol directly if reading state onchain.' Constructor: constructor(IPoolManager _poolManager). Same value in docs, registry (latest.StateView) and sdk-core v4StateView.
  - verifier: confirmed via <https://github.com/flayerlabs/flaunchgg-contracts/releases (v1.1.5-base: StateView 0xa3c0c9b65bad0b08107aa264b0f3db444b867a71); corroborated by third-party repos https://github.com/clawdbotatg/clawd-v4-liq and https://github.com/DelleonMcglone/Mantua-v1 (search snippets)> — Case-insensitive match. Third-party (flaunch) Base deployment notes and several independent integrator repos use this as Base StateView. No conflicting Base address found; the different StateView address (0x86e8631a...) that appears on the docs page belongs to another chain, not Base.
- `uniswap_v4_position_manager`: <https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>, <https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts>, <https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol>
  - ERC-721 (solmate) positions NFT, name 'Uniswap v4 Positions NFT', symbol 'UNI-V4-POSM'. Same value in docs, registry (latest.PositionManager) and sdk-core v4PositionManagerAddress. Note the registry also lists a separate PermissionedPositionManager 0xc09255d86db563cbc11c2fcf4a0c512e160111b4 for permissioned-hook pools (not needed for standard pools).
  - verifier: confirmed via <https://github.com/flayerlabs/flaunchgg-contracts/releases (v1.1.5-base: PositionManager 0x7c5f5a4bbd8fd63184577525326123b519429bdc); Basescan (via search snippet) https://basescan.org/address/0x7c5f5a4bbd8fd63184577525326123b519429bdc labels it 'Uniswap V4: Position Manager' with constructor args pointing at PoolManager, Permit2 and WETH 0x4200...0006; also https://docs.nftx.io/contracts/addresses lists it for Base Mainnet> — Case-insensitive match across flaunch, NFTX docs, and a Basescan listing (Basescan: unverified). No conflicting address found. The note above about a separate PermissionedPositionManager 0xC09255D86DB563cBc11C2fCf4a0C512e160111B4 is also consistent with https://github.com/Uniswap/contracts/pull/170.
- `uniswap_v4_quoter`: <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>, <https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/addresses.ts>, <https://github.com/Uniswap/sdks/pull/761>, <https://github.com/Uniswap/sdks/pull/761/files>, <https://github.com/Uniswap/contracts/pull/172>
  - This is the 'latest.V4Quoter' in the Uniswap/contracts registry and sdk-core's BASE v4QuoterAddress since PR #761 (merged 2026-10-20, sdk-core 7.19.5), which repointed v4QuoterAddress on 14 chains to the quoter deployments 'that implement msgSender()' because PermissionedHooks (and any hook resolving the caller via IMsgSender) revert on the old quoters. ABI is unchanged. The docs deployments page (fetched 2026-10-23) still shows the legacy address below, so expect docs lag. For Depthwatch effective-spread quoting on ordinary pools either address works; this one also works on permissioned-hook pools.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/smart-order-router/main/src/util/addresses.ts (PROTOCOL_V4_QUOTER_ADDRESSES [ChainId.BASE]: '0xe1a6c5803e3c44368b171bd680c7d32dfc92ca47'); also https://github.com/Uniswap/sdks/pull/760> — Case-insensitive match in the smart-order-router repo (not among cited sources). The cited Uniswap/contracts registry shows latest.V4Quoter = this address with timestamp 1746821415000 (= 2025-05-09), i.e. the msgSender-capable quoter was deployed May 2025, well before the sdk repoint. The PR #761 note above checks out: merged 2026-10-20, bumps @uniswap/sdk-core 7.19.4 -> 7.19.5, Base v4QuoterAddress -> 0xE1A6C5...CA47 (https://github.com/Uniswap/sdks/pull/761). Not verified on Basescan.
- `uniswap_v4_quoter_legacy`: <https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v4/deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>, <https://github.com/Uniswap/sdks/pull/761/files>
  - Listed as 'Quoter' in the official docs Base: 8453 table; appears in the Uniswap/contracts registry history (timestamp 1737491485000 = 2025-01-21) rather than 'latest'; it is the '-' line removed from sdk-core BASE_ADDRESSES in PR #761. Does not implement msgSender(), so quotes against PermissionedHooks pools revert. Keep as fallback / for reproducing older integrations.
  - verifier: confirmed via <https://github.com/flayerlabs/flaunchgg-contracts/releases (v1.1.5-base: Quoter 0x0d5e0f971ed27fbff6c2837bf31316121532048d); third-party skill listings (search snippets) https://skills.sh/openclaw/skills/uniswap-v4 give Base V4Quoter 0x0d5e0f971ed27fbff6c2837bf31316121532048d 'verified 2026-02-08'> — Case-insensitive match. Also confirmed the claim that the docs page still lists this as 'Quoter' for Base: raw deployments.mdx Base: 8453 table shows Quoter 0x0d5e0f971ed27fbff6c2837bf31316121532048d and does not list the newer quoter. Registry history entry at timestamp 1737491485000 (2025-01-21) matches the note above. Correctly labelled as the legacy/original deployment.
- `uniswap_universal_router`: <https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>, <https://github.com/Uniswap/universal-router/blob/main/deploy-addresses/base.json>, <https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/utils/constants.ts>
  - First v4-capable Universal Router on Base. Registry key 'UniversalRouter#v2.0'; universal-router repo key 'UniversalRouterV2'; universal-router-sdk CHAIN_CONFIGS[8453].V2_0 and DEFAULT_UR_VERSION = V2_0 ('kept at V2_0 for backward compatibility'). Uniswap docs state v4 swaps are routed through the Universal Router, so PoolManager.Swap.sender will equal one of the UR addresses for frontend-originated swaps; index all four v4-capable UR versions (this, 2.1.1, 2.1.2, 2.2.0). The older UniversalRouterV1_2 at 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD (registry 'UniversalRouter#v1.2') predates v4 and does not route v4 swaps.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/docs/main/content/trading/swapping-api/supported-chains.mdx (row 8453 Base, column 'Universal Router 2.0 Address' = 0x6ff5693b99212da76ad316178a184ab56d299b43); also https://github.com/flayerlabs/flaunchgg-contracts/releases (Universal Router 0x6ff5693b99212da76ad316178a184ab56d299b43) and https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments (search snippet, UniversalRouter row)> — Case-insensitive match; the supported-chains table explicitly labels it 'Universal Router 2.0' for Base, confirming the version claim. universal-router-sdk CHAIN_CONFIGS[8453].V2_0 creationBlock 25350999 (~2025-01-22 at 2s blocks) is consistent with the registry timestamp 1737491485000. V1_2 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD also matches the universal-router repo base.json.
- `uniswap_universal_router_v2_1_1`: <https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx>, <https://github.com/Uniswap/universal-router/blob/main/deploy-addresses/base.json>, <https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/utils/constants.ts>
  - Docs page row 'Universal Router 2.1.1'; universal-router repo key 'UniversalRouterV2_1_1'; universal-router-sdk V2_1_1. The Uniswap/contracts registry has no '#v2.1.1' key (it has '#v2.1' = 0xf3a4f4094bd2c6c06ca2f61789d8727b8d1e7259, see unresolved).
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/docs/main/content/trading/swapping-api/supported-chains.mdx (row 8453 Base, column 'Universal Router 2.1.1 Address' = 0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7)> — Case-insensitive match, explicitly labelled 2.1.1 for Base in a file not cited above. Also present in the universal-router repo base.json (UniversalRouterV2_1_1) and universal-router-sdk V2_1_1 (creationBlock 43501203, ~2026-03-18). Note the Uniswap/contracts registry's 'UniversalRouter#v2.1' = 0xf3a4f4094bd2c6c06ca2f61789d8727b8d1e7259 (timestamp 1763597784466 = 2025-11-19) is a distinct, earlier 2.1 deployment, not 2.1.1 - the unresolved flag above is appropriate; it is not listed in universal-router base.json or the SDK.
- `uniswap_universal_router_v2_1_2`: <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>, <https://github.com/Uniswap/universal-router/blob/main/deploy-addresses/base.json>, <https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/utils/constants.ts>
  - Registry keys 'UniversalRouter' and 'UniversalRouter#v2.1.2' both point here; universal-router repo key 'UniversalRouterV2_1_2'; universal-router-sdk V2_1_2. Not on the docs v4 deployments page as of 2026-10-23.
  - verifier: confirmed via <https://github.com/Uniswap/universal-router/releases/tag/2.1.2 (release 'Universal Router 2.1.2', Base deployment 0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40); also the published page https://developers.uniswap.org/docs/trading/swapping-api/supported-chains lists it as Universal Router 2.1.2 for Base 8453 (search snippet)> — Case-insensitive match. Release page is dated 18 Sep (year not shown; SDK creationBlock 51446913 ~ 2026-09-18 at 2s blocks, consistent with registry timestamp 1789683208000). Caveat: the same address is listed as a Uniswap V3 SwapRouter on other chains (https://docs.oku.trade/home/extra-information/deployed-contracts, monad-crypto/protocols PR #491) - a cross-chain address reuse by the same deployer, not a conflict for Base. Not on the Uniswap/docs repo's v4 deployments.mdx Base table as of today, as noted above.
- `uniswap_universal_router_v2_2_0`: <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>, <https://github.com/Uniswap/sdks/blob/main/sdks/universal-router-sdk/src/utils/constants.ts>, <https://github.com/Uniswap/sdks/commits/main/sdks/sdk-core/src/addresses.ts>
  - Registry key 'UniversalRouter#v2.2'; universal-router-sdk V2_2_0 (newest enum value), added by sdks commit 'add permissioned pools addresses and UR 2.2.0 for Base and Ink (#745)' on 2026-09-24. Not yet in the universal-router repo's deploy-addresses/base.json nor on the docs page, hence medium confidence.
  - verifier: confirmed via <https://github.com/Uniswap/contracts/pull/170 (PR description, Base 8453: 'UniversalRouter 2.2.0: 0xbe2257d1aafbe6b73f67a9ac971c2f0b344bb3c5', merged 2026-09-25); https://github.com/Uniswap/sdks/pull/745 (Base V2_2_0 0xbe2257d1aafbe6b73f67a9ac971c2f0b344bb3c5, creationBlock 51740773, merged 2026-09-24)> — Case-insensitive match in two PR pages not cited above, consistent with registry key 'UniversalRouter#v2.2' (timestamp 1790270893000 ~ 2026-09-25) and creationBlock 51740773 (~2026-09-25). Weaknesses: all sources are Uniswap-authored (same deployer, SocksNFlops); the universal-router GitHub release 2.2.0 lists only Ethereum, Ink and Sepolia (no Base); and the same address is MixedRouteQuoterV2 on Optimism/Polygon/BNB (Uniswap/contracts PR #172) - cross-chain nonce reuse, so verify on Basescan that the Base bytecode is a UniversalRouter before indexing its Swap events. Medium confidence, as stated above.
- `permit2`: <https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>
  - Listed in the docs Base: 8453 table and registry latest.Permit2. PositionManager constructor takes IAllowanceTransfer _permit2. Not needed for read-only observation.
  - verifier: confirmed via <https://raw.githubusercontent.com/ethereum-optimism/specs/main/specs/protocol/preinstalls.md (OP Stack preinstall table: Permit2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3); also https://docs.base.org/base-chain/specs/protocol/execution/evm/preinstalls (search snippet, same address) and https://github.com/flayerlabs/flaunchgg-contracts/releases> — Exact match. Permit2 is an OP Stack preinstall, and Base documents it at this address in its own preinstalls spec. Canonical CREATE2 address across EVM chains.
- `uniswap_v4_position_descriptor`: <https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx>, <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>
  - Proxy; registry lists implementation 0x176690c5819a05123b3cd80bd4aa2846cd347489. Only used for tokenURI rendering; included for completeness.
  - verifier: confirmed via <https://github.com/flayerlabs/flaunchgg-contracts/releases (v1.1.5-base: PositionDescriptor 0x25d093633990dc94bedeed76c8f3cdaa75f3e7d5); Basescan PositionManager page (search snippet) https://basescan.org/address/0x7C5f5A4bBd8fD63184577525326123B519429bDc shows this address as the _tokenDescriptor constructor argument> — Case-insensitive match in a third-party release page and as the PositionManager's constructor arg on Basescan (unverified). Registry marks it a transparent proxy (implementation 0x176690c5819a05123b3cd80bd4aa2846cd347489 per cited registry; implementation not independently verified). Low importance for Depthwatch (tokenURI only).

Unresolved:
- None of the addresses were verified against explorer labels (basescan.org / base.blockscout.com unverified); verification relies on three Uniswap-owned GitHub sources agreeing and on the on-chain checks in §2.8.
- V4Quoter: the official docs page (fetched 2026-10-23) still lists 0x0d5e0F971ED27FBfF6c2837bf31316121532048D while the Uniswap/contracts registry 'latest' and sdk-core (PR #761, 2026-10-20) point to 0xE1A6C5803e3c44368b171BD680c7D32dfc92CA47 (msgSender-capable). Both are reported; confirm against the live docs page and pick based on whether permissioned-hook pools matter.
- Uniswap/contracts registry lists 'UniversalRouter#v2.1' = 0xf3a4f4094bd2c6c06ca2f61789d8727b8d1e7259, which is absent from the docs page, the universal-router repo and universal-router-sdk; its status (superseded 2.1.0?) is unknown and it was not included as an item.
- Universal Router v2.2.0 (0xBE2257d1aAfBE6B73F67A9ac971C2F0B344Bb3c5) appears only in the registry and universal-router-sdk (Sep 2026), not on the docs page or in universal-router/deploy-addresses; medium confidence.
- A page summary of IPositionManager.sol (not the source itself) claimed it declares an event 'ModifyPosition(PoolId indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)'. This looks like a conflation with IPoolManager.ModifyLiquidity and could not be confirmed; do not rely on a PositionManager-emitted liquidity event — attribute via PoolManager.ModifyLiquidity (sender == POSM, salt == bytes32(tokenId)).
- Swap event sign convention was derived from Pool.sol arithmetic (negative = paid in, positive = received, from the swapper's perspective) because the IPoolManager NatSpec only says 'delta of the currencyN balance of the pool'. Whether the emitted amounts include afterSwap hook return-deltas was not verified from source (the emit occurs in PoolManager._swap with the pool-level delta).
- The worked PoolId example (ETH/USDC fee 500 tickSpacing 10 no hooks -> 0x96d4b53a...88c0a) is a pure keccak computation; the existence of that pool on Base and the USDC address 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 were not sourced in this task.
- Permit2 and PositionDescriptor were included from the docs page and registry but are not required by Depthwatch; PermissionedPositionManager / PermissionedHooks (registry) were not researched.

### Technical notes

#### Chain

- `ChainId.BASE = 8453` (Uniswap sdk-core `chains.ts`: https://github.com/Uniswap/sdks/blob/main/sdks/sdk-core/src/chains.ts). The official docs deployments page warns: "Integrators should no longer assume that they are deployed to the same addresses across chains and be extremely careful to confirm mappings below" (https://github.com/Uniswap/docs/blob/main/content/protocols/v4/deployments.mdx).

#### PoolKey, PoolId, native ETH

Source: https://github.com/Uniswap/v4-core/blob/main/src/types/PoolKey.sol , https://github.com/Uniswap/v4-core/blob/main/src/types/PoolId.sol , https://github.com/Uniswap/v4-core/blob/main/src/types/Currency.sol

```solidity
struct PoolKey {
    Currency currency0;   // "The lower currency of the pool, sorted numerically"
    Currency currency1;   // "The higher currency of the pool, sorted numerically"
    uint24 fee;           // LP fee, capped at 1_000_000 (pips = hundredths of a bip). Dynamic-fee flag: fee must be exactly 0x800000
    int24 tickSpacing;    // positions' ticks must be multiples of tickSpacing
    IHooks hooks;         // hook contract (address(0) = no hooks)
}
type PoolId is bytes32;
type Currency is address;
Currency public constant ADDRESS_ZERO = Currency.wrap(address(0)); // "A constant to represent the native currency"
function isAddressZero(Currency currency) internal pure returns (bool)
```

- `PoolIdLibrary.toId(PoolKey memory poolKey)` NatSpec: "Returns value equal to keccak256(abi.encode(poolKey))". Implementation: `assembly ("memory-safe") { poolId := keccak256(poolKey, 0xa0) }` — hashes the 5 x 32-byte words of the in-memory struct (0xa0 = 160 bytes). Off-chain: `keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))` with addresses left-padded to 32 bytes, `fee` as uint256 word, `tickSpacing` sign-extended to int256 (int24(-1) -> 0xff..ff), hooks left-padded.
- **currency0 == address(0) means native ETH** (Currency.ADDRESS_ZERO). Because currencies are sorted numerically, native ETH is always currency0 when present.
- Worked example for unit tests (computed locally with a keccak validated against the ERC-721 Transfer topic; pool existence NOT chain-verified): PoolKey{currency0=0x0000000000000000000000000000000000000000, currency1=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, fee=500, tickSpacing=10, hooks=0x0} -> abi.encode = `0000..0000 | 0000..833589fcd6edb6e08f4c7c32d4f71b54bda02913 | 0000..01f4 | 0000..000a | 0000..0000` -> PoolId `0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a`.

#### PoolManager events (https://github.com/Uniswap/v4-core/blob/main/src/interfaces/IPoolManager.sol)

```solidity
event Initialize(
    PoolId indexed id, Currency indexed currency0, Currency indexed currency1,
    uint24 fee, int24 tickSpacing, IHooks hooks, uint160 sqrtPriceX96, int24 tick
);
event Swap(
    PoolId indexed id, address indexed sender,
    int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee
);
event ModifyLiquidity(
    PoolId indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt
);
```

- Canonical signatures / topic0 (keccak computed locally):
  - `Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)` -> `0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438`
  - `Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)` -> `0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f`
  - `ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)` -> `0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec`
- Indexed: Initialize (id, currency0, currency1); Swap (id, sender); ModifyLiquidity (id, sender). Non-indexed fields are ABI-encoded in `data`.
- `PoolManager.initialize(PoolKey memory key, uint160 sqrtPriceX96) external noDelegateCall returns (int24 tick)` emits `Initialize(id, key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks, sqrtPriceX96, tick)` (https://github.com/Uniswap/v4-core/blob/main/src/PoolManager.sol). `mapping(PoolId id => Pool.State) internal _pools;`
- Swap NatSpec: `id` "The abi encoded hash of the pool key struct for the pool that was modified"; `sender` "The address that initiated the swap call, and that received the callback" (= msg.sender to PoolManager, i.e. the router/integrator, not the EOA); `amount0`/`amount1` "The delta of the currency0/currency1 balance of the pool"; `sqrtPriceX96` "The sqrt(price) of the pool after the swap, as a Q64.96"; `liquidity` "The liquidity of the pool after the swap"; `tick` "The log base 1.0001 of the price of the pool after the swap"; `fee` "The swap fee in hundredths of a bip".
- **Sign convention (derived from Pool.sol, https://github.com/Uniswap/v4-core/blob/main/src/libraries/Pool.sol, and PoolOperation.sol):** `SwapParams.amountSpecified` is "The desired input amount if negative (exactIn), or the desired output amount if positive (exactOut)". In `Pool.swap` the exact-input loop does `amountSpecifiedRemaining += (step.amountIn + step.feeAmount)` and `amountCalculated += step.amountOut`; exact-output does `amountSpecifiedRemaining -= step.amountOut` and `amountCalculated -= (step.amountIn + step.feeAmount)`; then `swapDelta = toBalanceDelta(specified = params.amountSpecified - amountSpecifiedRemaining, unspecified = amountCalculated)` ordered by `zeroForOne != (amountSpecified < 0)`. Net effect: the emitted `amount0/amount1` are the swapper's BalanceDelta — **negative = currency paid into the pool (input incl. fee), positive = currency received from the pool (output)**. This is the opposite sign of Uniswap v3's Swap event (where positive = into pool). Pool-side balance change = -amount. Effective price paid = |amountIn| / |amountOut|.
- `fee` in Swap = `swapFee = protocolFee == 0 ? lpFee : uint16(protocolFee).calculateSwapFee(lpFee)` where `lpFee` is `slot0.lpFee()` unless the hook returned an override (`params.lpFeeOverride.isOverride()`); units are pips (1e-6), e.g. 500 = 0.05%. Reverts `InvalidFeeForExactOut` if swapFee >= MAX_SWAP_FEE on exact-output.
- `SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }`; `ModifyLiquidityParams { int24 tickLower; int24 tickUpper; int256 liquidityDelta; bytes32 salt; }` (https://github.com/Uniswap/v4-core/blob/main/src/types/PoolOperation.sol).

#### StateView read functions (https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IStateView.sol)

```solidity
function getSlot0(PoolId poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
function getLiquidity(PoolId poolId) external view returns (uint128 liquidity);               // in-range liquidity
function getTickBitmap(PoolId poolId, int16 tick) external view returns (uint256 tickBitmap);  // arg is the word position (tick / tickSpacing) >> 8
function getTickInfo(PoolId poolId, int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128);
function getTickLiquidity(PoolId poolId, int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet);
function getTickFeeGrowthOutside(PoolId poolId, int24 tick) external view returns (uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128);
function getFeeGrowthGlobals(PoolId poolId) external view returns (uint256 feeGrowthGlobal0, uint256 feeGrowthGlobal1);
function getPositionInfo(PoolId poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt) external view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128);
function getPositionInfo(PoolId poolId, bytes32 positionId) external view returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128);
function getPositionLiquidity(PoolId poolId, bytes32 positionId) external view returns (uint128 liquidity);
function getFeeGrowthInside(PoolId poolId, int24 tickLower, int24 tickUpper) external view returns (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128);
```

- Position key (https://github.com/Uniswap/v4-core/blob/main/src/libraries/Position.sol): `calculatePositionKey(address owner, int24 tickLower, int24 tickUpper, bytes32 salt)` = `keccak256(abi.encodePacked(owner, tickLower, tickUpper, salt))` (58 packed bytes: 20 + 3 + 3 + 32). `Position.State { uint128 liquidity; uint256 feeGrowthInside0LastX128; uint256 feeGrowthInside1LastX128; }`.
- Depth at ±1/2/5%: walk ticks from `getSlot0().tick` using `getTickBitmap` words and `getTickLiquidity(...).liquidityNet` to adjust active liquidity across initialized ticks, exactly as in v3 (same sqrtPriceX96 / tick math; v4 has no per-pool contract so everything is keyed by PoolId).

#### Direct storage layout (optional fast path; https://github.com/Uniswap/v4-core/blob/main/src/libraries/StateLibrary.sol and src/types/Slot0.sol)

- `POOLS_SLOT = bytes32(uint256(6))`; pool state slot `stateSlot = keccak256(abi.encodePacked(PoolId.unwrap(poolId), POOLS_SLOT))`; offsets: slot0 = +0, feeGrowthGlobal0X128 = +1, feeGrowthGlobal1X128 = +2, liquidity = +3, ticks mapping = +4, tickBitmap mapping = +5, positions mapping = +6. StateView reads them with `PoolManager.extsload(bytes32)` / `extsload(bytes32,uint256)`.
- Slot0 packing (LSB first): `160 bits sqrtPriceX96 | 24 bits tick (offset 160) | 12 bits protocolFee 0->1 + 12 bits protocolFee 1->0 (offset 184) | 24 bits lpFee (offset 208) | 24 bits empty`.

#### PositionManager (https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol , src/interfaces/IPositionManager.sol , src/libraries/PositionInfoLibrary.sol , src/base/ERC721Permit_v4.sol , src/interfaces/INotifier.sol)

- `contract PositionManager is IPositionManager, ERC721Permit_v4, PoolInitializer_v4, Multicall_v4, DeltaResolver, ReentrancyLock, BaseActionsRouter, Notifier, Permit2Forwarder, NativeWrapper`; constructor `(IPoolManager _poolManager, IAllowanceTransfer _permit2, uint256 _unsubscribeGasLimit, IPositionDescriptor _tokenDescriptor, IWETH9 _weth9)`; NFT name "Uniswap v4 Positions NFT", symbol "UNI-V4-POSM".
- State: `uint256 public nextTokenId = 1;` `mapping(uint256 tokenId => PositionInfo info) public positionInfo;` `mapping(bytes25 poolId => PoolKey poolKey) public poolKeys;`
- Reads:
```solidity
function getPoolAndPositionInfo(uint256 tokenId) public view returns (PoolKey memory poolKey, PositionInfo info); // info = positionInfo[tokenId]; poolKey = poolKeys[info.poolId()]
function positionInfo(uint256 tokenId) external view returns (PositionInfo);   // packed uint256
function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity);
function poolKeys(bytes25 poolId) external view returns (PoolKey);
function nextTokenId() external view returns (uint256);
function ownerOf(uint256 id) public view virtual returns (address owner);     // solmate ERC721; reverts for burned/unminted ids
```

- `getPositionLiquidity` resolves the core position with `Position.calculatePositionKey(address(this), tickLower, tickUpper, bytes32(tokenId))` — i.e. **owner = PositionManager address, salt = bytes32(tokenId)**. So for any POSM NFT: `StateView.getPositionInfo(poolId, posmAddress, tickLower, tickUpper, bytes32(tokenId))` returns the same liquidity, and `PoolManager.ModifyLiquidity` logs with `sender == PositionManager` carry `salt == bytes32(tokenId)`, which is how to attribute liquidity changes to NFTs (POSM does not emit its own liquidity-change event).
- `PositionInfo` packed layout (MSB first): `200 bits poolId | 24 bits tickUpper | 24 bits tickLower | 8 bits hasSubscriber`; constants `TICK_LOWER_OFFSET = 8`, `TICK_UPPER_OFFSET = 32`. Decode: `poolId25 = bytes25(info >> 56)` (the truncated upper 200 bits of the 32-byte PoolId — "not compatible with the poolId used in Uniswap v4 core"; use `poolKeys(poolId25)` then recompute full PoolId), `tickUpper = int24(uint24(info >> 32))`, `tickLower = int24(uint24(info >> 8))`, `hasSubscriber = (info & 0xff) != 0`. Library fns: `poolId(PositionInfo) -> bytes25`, `tickLower -> int24`, `tickUpper -> int24`, `hasSubscriber -> bool`, `initialize(PoolKey, int24, int24) -> PositionInfo`.
- Events: ERC-721 `Transfer(address indexed from, address indexed to, uint256 indexed id)` inherited from solmate ERC721 (https://github.com/transmissions11/solmate/blob/main/src/tokens/ERC721.sol); topic0 `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`; mint = from address(0), burn = to address(0). Also `Approval(address indexed owner, address indexed spender, uint256 indexed id)`, `ApprovalForAll(address indexed owner, address indexed operator, bool approved)`. From INotifier: `Subscription(uint256 indexed tokenId, address indexed subscriber)` topic0 `0x9709492381f90bdc5938bb4e3b8e35b7e0eac8af058619e27191c5a40ce79fa9`; `Unsubscription(uint256 indexed tokenId, address indexed subscriber)` topic0 `0xa0ebb1de82db929a9153472f37d3a66dbede4436258311ad0f52a35a2c91d150`; `subscriber(uint256 tokenId) view returns (ISubscriber)`.
- Owner of a position = `ownerOf(tokenId)` (or track Transfer logs); liquidity = `getPositionLiquidity(tokenId)`; range + pool = `getPoolAndPositionInfo(tokenId)`. LP concentration = aggregate liquidity by `ownerOf(tokenId)`; also count direct PoolManager positions (sender != POSM) from ModifyLiquidity logs keyed by (sender, tickLower, tickUpper, salt).

#### V4Quoter (https://github.com/Uniswap/v4-periphery/blob/main/src/interfaces/IV4Quoter.sol)

```solidity
struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }
function quoteExactInputSingle(QuoteExactSingleParams memory params) external returns (uint256 amountOut, uint256 gasEstimate);
function quoteExactOutputSingle(QuoteExactSingleParams memory params) external returns (uint256 amountIn, uint256 gasEstimate);
function quoteExactInput(QuoteExactParams memory params) external returns (uint256 amountOut, uint256 gasEstimate);
function quoteExactOutput(QuoteExactParams memory params) external returns (uint256 amountIn, uint256 gasEstimate);
```

- Not `view` (revert-and-catch pattern); call via `eth_call`. For effective spread: quote exactIn both directions for a notional and compare to mid from `getSlot0().sqrtPriceX96` ((sqrtPriceX96/2^96)^2 = price of currency0 in currency1, raw units).

#### Universal Router

- Uniswap docs: v4 swap operations go through the Universal Router (search result from https://developers.uniswap.org/docs/protocols/universal-router/overview.md). `Swap.sender` is the UR address for those swaps. v4-capable UR versions on Base: v2.0 0x6fF5693b99212Da76ad316178A184AB56D299b43, v2.1.1 0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7, v2.1.2 0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40, v2.2.0 0xBE2257d1aAfBE6B73F67A9ac971C2F0B344Bb3c5 (universal-router-sdk `CHAIN_CONFIGS[8453]`; registry 8453.json). universal-router repo deploy-addresses/base.json: `UniversalRouterV1_2_NoV2Support 0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4, UnsupportedProtocol 0x9E18Efb3BE848940b0C92D300504Fb08C287FE85, UniversalRouterV1_2_V2Support 0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD, UniversalRouterV2 0x6ff5693b99212da76ad316178a184ab56d299b43, UniversalRouterV2_1_1 0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7, UniversalRouterV2_1_2 0xd6145b2D3F379919E8CdEda7B97e37c4b2Ca9c40`.

#### Method notes

- docs.uniswap.org, developers.uniswap.org, docs.base.org, basescan.org and base.blockscout.com were not read directly (unverified); addresses were taken from Uniswap's GitHub repos (docs source `content/protocols/v4/deployments.mdx`, `Uniswap/contracts` deployments registry `deployments/json/8453.json`, `Uniswap/sdks`) — three independent official sources agree on PoolManager, StateView, PositionManager, Permit2, PositionDescriptor.
- EIP-55 checksums and topic0 hashes were computed locally with a pure-Python keccak-256 validated against keccak("") and the canonical ERC-721 Transfer topic.


## aerodrome

| key                                                  | name                                                                                           | address                                      | source confidence | independent check |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------- | ----------------- |
| `aerodrome_v2_pool_factory`                          | Aerodrome PoolFactory (v2-style volatile/stable pools)                                         | `0x420DD381b31aEf6683db6B902084cB0FFECe40Da` | high              | confirmed         |
| `aerodrome_v2_router`                                | Aerodrome Router (v2 pools)                                                                    | `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43` | medium            | confirmed         |
| `aerodrome_voter`                                    | Aerodrome Voter                                                                                | `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5` | high              | confirmed         |
| `aerodrome_aero_token`                               | AERO token (Aerodrome's; `aero_token` until 2026-10-28, now Aero's AERO under `## aero`)       | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | high              | confirmed         |
| `aerodrome_factory_registry`                         | Aerodrome FactoryRegistry                                                                      | `0x5C3F18F06CC09CA1910767A34a20F771039E37C0` | medium            | confirmed         |
| `aerodrome_v2_gauge_factory`                         | Aerodrome v2 GaugeFactory (non-CL)                                                             | `0x35f35cA5B132CaDf2916BaB57639128eAC5bbcb5` | high              | confirmed         |
| `slipstream_cl_factory`                              | Slipstream CLFactory (initial deployment; main factory, most pools)                            | `0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A` | high              | confirmed         |
| `slipstream_cl_factory_gauge_caps`                   | Slipstream CLFactory (Gauge Caps deployment)                                                   | `0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a` | high              | confirmed         |
| `slipstream_cl_factory_gauges_v3`                    | Slipstream CLFactory (Gauges V3 deployment, README: 'current latest deployment of the gauges') | `0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef` | high              | confirmed         |
| `slipstream_cl_factory_deprecated_early`             | Slipstream CLFactory (deprecated early factory, Apr 2024, ~22 pools)                           | `0x9592cd9b267748cbFbDe90Ac9f7df3c437A6d51b` | low               | confirmed         |
| `slipstream_nonfungible_position_manager`            | Slipstream NonfungiblePositionManager (initial deployment; for pools of CLFactory 0x5e7B...)   | `0x827922686190790b37229fd06084350E74485b72` | medium            | confirmed         |
| `slipstream_nonfungible_position_manager_gauge_caps` | Slipstream NonfungiblePositionManager (Gauge Caps deployment; for CLFactory 0xaDe6...)         | `0xa990C6a764b73BF43cee5Bb40339c3322FB9D55F` | medium            | confirmed         |
| `slipstream_nonfungible_position_manager_gauges_v3`  | Slipstream NonfungiblePositionManager (Gauges V3 deployment; for CLFactory 0xf8f2...)          | `0xe1f8cd9AC4e4A65F54f38a5CdAfCA44f6dD68b53` | medium            | confirmed         |
| `slipstream_cl_gauge_factory`                        | Slipstream CLGaugeFactory (initial deployment)                                                 | `0xD30677bd8dd15132F251Cb54CbDA552d2A05Fb08` | high              | confirmed         |
| `slipstream_cl_gauge_factory_gauge_caps`             | Slipstream CLGaugeFactory (Gauge Caps deployment)                                              | `0xB630227a79707D517320b6c0f885806389dFcbB3` | high              | confirmed         |
| `slipstream_cl_gauge_factory_gauges_v3`              | Slipstream CLGaugeFactory (Gauges V3 deployment, current for new gauges)                       | `0x385293CaE378C813F16f0C1334d774AdDDf56AbB` | high              | confirmed         |
| `slipstream_swap_router`                             | Slipstream SwapRouter (initial deployment)                                                     | `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5` | medium            | confirmed         |
| `slipstream_quoter_v2`                               | Slipstream QuoterV2 (initial deployment)                                                       | `0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0` | medium            | confirmed         |

**Note (2026-10-28): Aerodrome became Aero.** On 2026-10-21 Aerodrome and Velodrome merged into
Aero, whose Base contracts are listed under `## aero`. The contracts in this section stay as they
are: the PoolFactory and the three CLFactories are not paused and their pools still trade, but
every Aerodrome gauge was killed (`isAlive` false; the WETH/USDC v2 gauge at block 52,918,274,
§2.8), the Voter's `emergencyCouncil()` is now the AerodromeMigration contract
0x22a2f734…, and the Voter still answers `gauges(pool)` with the killed gauges. The fee notes
below and in §2.3 stand: `fee()` of a Slipstream pool on all three Aerodrome deployments asks a
DynamicSwapFeeModule and can change from one block to the next. Aerodrome's AERO keeps its
address and is now `TOKENS.AERO_AERODROME` (key `aerodrome_aero_token`).

Sources and notes per item:
- `aerodrome_v2_pool_factory`: <https://github.com/aerodrome-finance/contracts (README 'Deployment' table; raw: https://raw.githubusercontent.com/aerodrome-finance/contracts/main/README.md)>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome/index.ts (CONFIG.PoolFactory)>
  - Official repo README + independent DefiLlama adapter agree. Emits PoolCreated(token0,token1,stable,pool,uint256). Contract name and verification status on Basescan/Blockscout were not checked (unverified).
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/sugar/main/deployments/base.env (V2_FACTORIES_8453); https://raw.githubusercontent.com/paraswap/paraswap-dex-lib/master/src/dex/solidly/config.ts (Aerodrome, Network.BASE, factoryAddress); https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base 8453, PoolFactory); Basescan label 'Aerodrome: Pool Factory' at https://basescan.org/address/0x420dd381b31aef6683db6b902084cb0ffece40da (seen via search snippet)> — Four independent sources (Sugar deployments env, Paraswap dex-lib, Velodrome Envio indexer config, Basescan label) all give the same address for Base. No conflicting address found.
- `aerodrome_v2_router`: <https://github.com/aerodrome-finance/contracts (README 'Deployment' table; raw: https://raw.githubusercontent.com/aerodrome-finance/contracts/main/README.md)>
  - Single source (official README). Not cross-checked on an explorer (unverified). Router.getAmountsOut(amountIn, Route[]) with Route{from,to,stable,factory}; Router.defaultFactory() should return the PoolFactory above.
  - verifier: confirmed via <https://raw.githubusercontent.com/rotki/rotki/develop/rotkehlchen/chain/base/modules/aerodrome/constants.py (ROUTER); https://raw.githubusercontent.com/beefyfinance/beefy-api/master/packages/address-book/src/address-book/base/platforms/aerodrome.ts (router); https://raw.githubusercontent.com/velodrome-finance/sugar-sdk/main/sugar/config.py (Base 8453 router_contract_addr)> — rotki, Beefy address book and the Sugar SDK config all agree. Note Paraswap's solidly config lists a different 'router' (0xDCf4EE5B700e2a5Fec458e06B763A4a3E3004494) for Aerodrome on Base, but that is Paraswap's own adapter field, not the Aerodrome Router; the three integrator sources above match the claim.
- `aerodrome_voter`: <https://github.com/aerodrome-finance/contracts (README 'Deployment' table)>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts (CONFIG.voter)>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome/index.ts (CONFIG.voter)>
  - Shared by v2 and Slipstream. Voter.gauges(pool) -> gauge; Voter.poolForGauge(gauge); Voter.isAlive(gauge); emits GaugeCreated(...). Used by CLFactory.getUnstakedFee to decide whether a pool has a live gauge.
  - verifier: confirmed via <https://raw.githubusercontent.com/rotki/rotki/develop/rotkehlchen/chain/evm/decoding/velodrome/constants.py (VOTER_ADDRESSES[ChainID.BASE]); https://raw.githubusercontent.com/velodrome-finance/sugar/main/deployments/base.env (VOTER_8453); https://raw.githubusercontent.com/beefyfinance/beefy-api/master/packages/address-book/src/address-book/base/platforms/aerodrome.ts (voter); https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base Voter)> — Four independent sources agree; rotki explicitly keys it to ChainID.BASE (Optimism Velodrome voter is 0x41C914ee0c7E1A5edCD0295623e6dC557B5aBf3C, so no cross-chain confusion).
- `aerodrome_aero_token` (`aero_token` until 2026-10-28): <https://github.com/aerodrome-finance/contracts (README 'Deployment' table)>, <https://governance.aave.com/t/temp-check-add-aero-to-base-v3/17440>
  - Official README and Aave governance forum agree.
  - 2026-10-28, block 53,211,601: `name()` 'Aerodrome', `symbol()` 'AERO', the same symbol as Aero's AERO (`aero_token` under `## aero`), so the two are told apart by address. Aero's AerodromeMigration converts it one way into Aero's AERO (`## aero`).
  - verifier: confirmed via <https://raw.githubusercontent.com/rotki/rotki/develop/rotkehlchen/chain/base/modules/aerodrome/constants.py (A_AERO = eip155:8453/erc20:0x9401...); https://raw.githubusercontent.com/velodrome-finance/sugar-sdk/main/sugar/config.py (Base 8453 token_addr); https://raw.githubusercontent.com/DefiLlama/yield-server/master/src/adaptors/aerodrome-slipstream/index.js (AERO)> — rotki pins it to chain 8453 explicitly. Sugar SDK and DefiLlama yield-server agree.
- `aerodrome_factory_registry`: <https://github.com/aerodrome-finance/contracts (README 'Deployment' table)>
  - Single source. factoriesToPoolFactory(poolFactory) -> (votingRewardsFactory, gaugeFactory); CLPool stores factoryRegistry and uses it for the onlyGaugeFactory check.
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/sugar/main/deployments/base.env (REGISTRY_8453); https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base FactoryRegistry); Basescan label 'Aerodrome: Factory Registry' at https://basescan.org/address/0x5C3F18F06CC09CA1910767A34a20F771039E37C0 (seen via search snippet)> — Sugar deployments env and the Velodrome indexer config both list it for chain 8453; Basescan labels it 'Aerodrome: Factory Registry' and its constructor arg _fallbackGaugeFactory is 0x35f35cA5... (consistent with the v2 GaugeFactory claim).
- `aerodrome_v2_gauge_factory`: <https://github.com/aerodrome-finance/contracts (README 'Deployment' table)>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome/index.ts (CONFIG.GaugeFactory)>
  - Gauge factory for v2-style pools (not Slipstream).
  - verifier: confirmed via <Basescan label 'Aerodrome: Gauge Factory' at https://basescan.org/address/0x35f35cA5B132CaDf2916BaB57639128eAC5bbcb5 (seen via search snippet; also appears as _fallbackGaugeFactory constructor arg on https://basescan.org/address/0x5C3F18F06CC09CA1910767A34a20F771039E37C0); https://aerodrome.finance/security (GaugeFactory row); https://builddaily.io/resources/aerodrome/; https://raw.githubusercontent.com/aerodrome-finance/contracts/main/script/constants/output/DeployCore-Base.json (GaugeFactory)> — Basescan, Aerodrome's official security page and a third-party resource page agree; the official deploy-output JSON (same repo as the README but a different artifact) also matches. Not referenced by the Velodrome indexer config (it indexes gauges via Voter), which is not a contradiction.
- `slipstream_cl_factory`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Initial Deployment', row 'PoolFactory'; raw: https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/README.md)>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts (CONFIG.factories[1], fromBlock 13843704)>
  - The slipstream README calls this contract 'PoolFactory' (contract name in code is CLFactory). DefiLlama indexes PoolCreated from this factory from block 13843704. Three CL factories coexist on Base (see the two below); a fourth deprecated one is listed low-confidence.
  - verifier: confirmed via <https://raw.githubusercontent.com/rotki/rotki/develop/rotkehlchen/chain/evm/decoding/velodrome/constants.py (SLIPSTREAM_CL_FACTORIES[ChainID.BASE]); https://raw.githubusercontent.com/velodrome-finance/sugar/main/deployments/base.env (CL_FACTORIES_8453[0]); https://raw.githubusercontent.com/paraswap/paraswap-dex-lib/master/src/dex/uniswap-v3/config.ts (AerodromeSlipstream factory, Network.BASE); https://raw.githubusercontent.com/0xProject/0x-settler/master/src/core/univ3forks/AerodromeSlipstream.sol (aerodromeFactoryV3_0); https://raw.githubusercontent.com/velodrome-finance/sugar-sdk/main/sugar/config.py (Base old_slipstream_factory_addr)> — Six independent sources agree. Sugar SDK now calls it old_slipstream_factory_addr (its current default is 0xf8f2...), consistent with the README's three-factory layout.
- `slipstream_cl_factory_gauge_caps`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Gauge Caps Deployment', row 'PoolFactory')>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts (CONFIG.factories[2], fromBlock 36953918)>
  - Second live CL factory. Has its own NFPM, SwapRouter, Quoter (README table). CLFactory has an immutable legacyCLFactory; createPool() requires owner if the same (token0,token1,tickSpacing) pool exists on the legacy factory, so the same pair/tickSpacing can exist on more than one factory.
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/sugar/main/deployments/base.env (CL_FACTORIES_8453[1]); https://raw.githubusercontent.com/paraswap/paraswap-dex-lib/master/src/dex/uniswap-v3/config.ts (AerodromeSlipstreamNewFactory factory); https://raw.githubusercontent.com/0xProject/0x-settler/master/src/core/univ3forks/AerodromeSlipstream.sol (aerodromeFactoryV3_1); https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base CLFactory list)> — Four independent sources agree. Paraswap pairs this factory with router 0xcbBb8035cAc7D4B3Ca7aBb74cF7BdF900215Ce0D (matches the README's Gauge Caps SwapRouter) but with quoter 0xfa2CB6D6cea79D6Efa102e527B3D67b2e61E3659 rather than the README's Quoter 0x3d4C2225...; that discrepancy is outside the claims under test but worth checking before using a Gauge Caps quoter.
- `slipstream_cl_factory_gauges_v3`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Gauges V3 Deployment', row 'PoolFactory')>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts (CONFIG.factories[3], fromBlock 44394724)>
  - Third live CL factory. README: 'Existing gauges are still in use, but all new gauges will be deployed from here.' Pairs with DynamicSwapFeeModule 0x87D8f999BBa9343E8099552426775B51C338E8CB (fee scales with tick crossings), so fee() can vary per block.
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/sugar/main/deployments/base.env (CL_FACTORIES_8453[2]); https://raw.githubusercontent.com/paraswap/paraswap-dex-lib/master/src/dex/uniswap-v3/config.ts (AerodromeSlipstreamFactory3 factory); https://raw.githubusercontent.com/velodrome-finance/sugar-sdk/main/sugar/config.py (Base slipstream_factory_addr); https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base CLFactory list)> — Four independent sources agree; Sugar SDK treats it as the current default Slipstream factory on Base. Paraswap lists router 0x33a47A122De0B5c429Ba79E6d17965B0e841c60e and quoter 0x86D33DCbEC9c75897c6Ce521f33CF84009c4272e for this factory, which differ from the README's Gauges V3 SwapRouter 0x698Cb2b6... and Quoter 0x514c8B5f...; not claims under test, but do not assume a single canonical router/quoter per factory without on-chain checks.
- `slipstream_cl_factory_deprecated_early`: <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts (CONFIG.factories[0], fromBlock 13592962, comment: 'Deprecated early Slipstream factory (Apr 2024, 22 pools); superseded within a week by 0x5e7B')>
  - Only source is a DefiLlama code comment; not in the aerodrome-finance/slipstream README. Include only if you want full historical coverage.
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base 8453 CLFactory address list includes 0x9592CD9B267748cbfBDe90Ac9F7DF3c437A6d51B)> — The official Velodrome/Aerodrome Envio indexer config lists this address (case-insensitively identical) as one of four CLFactory addresses on Base, independently of the DefiLlama comment. It never appeared in any README revision checked (37eead2 May 2024, 7e6a97a Jul 2024, current), and the 'Apr 2024 / 22 pools / superseded within a week' details are unverified. Treat as a real but historical CLFactory; the pool count is unverified.
- `slipstream_nonfungible_position_manager`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Initial Deployment', row 'NonfungiblePositionManager')>
  - README only (explorer unverified). Each NFPM has an immutable factory and computes pool addresses via PoolAddress.computeAddress(factory, poolKey) (NonfungiblePositionManager.sol), so positions for pools created by a given CLFactory live in that deployment's NFPM; CLPool.nft() returns the NFPM once a gauge has been created for the pool.
  - verifier: confirmed via <https://raw.githubusercontent.com/rotki/rotki/develop/rotkehlchen/chain/evm/decoding/velodrome/constants.py (SLIPSTREAM_NFPM_ADDRESSES[ChainID.BASE]); https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base NFPM list); https://aerodrome.finance/security (NonfungiblePositionManager row, seen via search snippet)> — rotki keys it to ChainID.BASE (Optimism NFPM is 0x416b43...). Also surfaced as 'AERO-CL-POS (Slipstream Position NFT v1)' on dexrabbit.bitquery.io via a search snippet. The indexer config additionally lists a fourth Base NFPM 0xc741beb2156827704A1466575ccA1cBf726a1178 that is absent from the README; unverified, flag for follow-up.
- `slipstream_nonfungible_position_manager_gauge_caps`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Gauge Caps Deployment', row 'NonfungiblePositionManager')>
  - README only.
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base NFPM list); https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base-Gauge-Caps.json (NonfungiblePositionManager, alongside PoolFactory 0xaDe6...)> — Velodrome indexer config (separate org repo) lists it among Base NFPMs; the official Gauge Caps deploy-output JSON (different artifact, same repo as README) pairs it with PoolFactory 0xaDe6..., supporting the factory pairing. No explorer check possible.
- `slipstream_nonfungible_position_manager_gauges_v3`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Gauges V3 Deployment', row 'NonfungiblePositionManager')>
  - README only.
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/sugar-sdk/main/sugar/config.py (Base nfpm_contract_addr, paired with slipstream_factory_addr 0xf8f2...); https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base NFPM list); https://builddaily.io/resources/aerodrome/ (NonfungiblePositionManager); https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base-MinUnstake.json (NonfungiblePositionManager with PoolFactory 0xf8f2...)> — Sugar SDK explicitly pairs this NFPM with factory 0xf8f2..., confirming the deployment pairing. Note the Gauges V3 deploy output lives in the file named DeployCL-Base-MinUnstake.json.
- `slipstream_cl_gauge_factory`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Initial Deployment', row 'GaugeFactory')>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts (CONFIG.gaugeFactories[0])>
  - CLGaugeFactory: createGauge(...) sets pool.gauge and pool.nft; nft() getter returns the NFPM used by its gauges.
  - verifier: confirmed via <https://aerodrome.finance/security (Slipstream table, GaugeFactory row, seen via search snippet); https://deepwiki.com/aerodrome-finance/slipstream/7.3-deployment; https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base.json (GaugeFactory)> — Aerodrome's official site (different domain from the README) and the deploy-output JSON agree. Not present in the Velodrome indexer config (which lists only CLGaugeFactoryV2/V3) and no Basescan label was surfaced, so this is the weakest of the confirmed CL items; the README commit history (37eead2, May 2024) shows it in the original Base table.
- `slipstream_cl_gauge_factory_gauge_caps`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Gauge Caps Deployment', row 'GaugeFactory')>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts (CONFIG.gaugeFactories[1])>
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base CLGaugeFactoryV2); https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base-Gauge-Caps.json (GaugeFactory)> — Velodrome indexer names it CLGaugeFactoryV2 on Base, matching the README's Gauge Caps GaugeFactory; deploy-output JSON agrees.
- `slipstream_cl_gauge_factory_gauges_v3`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Gauges V3 Deployment', row 'GaugeFactory')>, <https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts (CONFIG.gaugeFactories[2], comment 'Aero Ignition CL gauge factory')>
  - DefiLlama also lists a 4th CL gauge factory 0x3e703fd2b6506e2abcce2c8b5633872a7d9b6fbc not present in the README (unverified).
  - verifier: confirmed via <https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml (Base CLGaugeFactoryV3); https://builddaily.io/resources/aerodrome/ (CLGaugeFactory); https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base-MinUnstake.json (GaugeFactory)> — Velodrome indexer names it CLGaugeFactoryV3 on Base. The DefiLlama-only fourth gauge factory 0x3e703fd2b6506e2abcce2c8b5633872a7d9b6fbc is not in the indexer config or any README; remains unverified.
- `slipstream_swap_router`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Initial Deployment', row 'SwapRouter')>
  - README only. Per-deployment routers also exist: 0xcbBb8035cAc7D4B3Ca7aBb74cF7BdF900215Ce0D (Gauge Caps), 0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F (Gauges V3).
  - verifier: confirmed via <Basescan label 'Aerodrome: SlipStream Swap Router' (Contract: Verified) at https://basescan.org/address/0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5 (seen via search snippet); https://aerodrome.finance/security (Slipstream SwapRouter row); README history https://raw.githubusercontent.com/aerodrome-finance/slipstream/7e6a97a/README.md (added in 'feat: swap router (#11)', Jul 2024)> — Basescan and Aerodrome's official site confirm. Caveat: Paraswap's dex-lib uses router 0x1b2b6cE813b99b840Fe632c63bcA5394938Ef01e for the initial Slipstream factory; that address appears in no Aerodrome deployment list or README revision and is most likely a Paraswap-specific router, not a refutation. The initial deploy-output JSON (DeployCL-Base.json) does not include SwapRouter because it was deployed later.
- `slipstream_quoter_v2`: <https://github.com/aerodrome-finance/slipstream (README 'Deployments' > 'Initial Deployment', row 'QuoterV2')>
  - README only. Useful for effective-spread quoting against 0x5e7B pools; other deployments list 'Quoter' 0x3d4C22254F86f64B7eC90ab8F7aeC1FBFD271c6C (Gauge Caps) and 0x514c8B5f54112481E28028F1166Bd78501089259 (Gauges V3). MixedQuoterV3 0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555 'supports 3 CL factories via bitmask encoding'.
  - verifier: confirmed via <https://raw.githubusercontent.com/paraswap/paraswap-dex-lib/master/src/dex/uniswap-v3/config.ts (AerodromeSlipstream quoter, Network.BASE); Basescan label 'Aerodrome: SlipStream Quoter' at https://basescan.org/address/0x254cf9e1e6e233aa1ac962cb9b05b2cfeaae15b0 (seen via search snippet); https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base.json (key 'Quoter')> — Paraswap and Basescan agree. The deploy-output JSON labels it 'Quoter' while the README says 'QuoterV2'; same address. Sugar SDK's Base quoter_contract_addr is MixedQuoterV3 0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555, consistent with the note above.

Unresolved:
- Explorer verification (basescan.org, base.blockscout.com, sourcify.dev, routescan) is outstanding: no address above was checked against on-chain verified-contract names; all come from the aerodrome-finance GitHub READMEs (official) plus DefiLlama adapters / Aave forum as independent corroboration.
- Official Aerodrome docs/security pages (aerodrome.finance/docs, aerodrome.finance/security, docs.aerodrome.finance, velodrome.finance/docs) and docs.base.org were not read (unverified), so there is no official-docs citation; GitHub READMEs were used instead.
- Which Slipstream CLFactory/NFPM is 'canonical' is not stated by the README: it lists three deployments (Initial 0x5e7B…, Gauge Caps 0xaDe6…, Gauges V3 0xf8f2…) and only says Gauges V3 is 'the current latest deployment of the gauges'. DefiLlama indexes all three factories as live. Confirm on-chain (allPoolsLength() per factory, recent PoolCreated blocks) which factories still receive new pools before deciding coverage.
- Deprecated early CL factory 0x9592cd9b267748cbFbDe90Ac9f7df3c437A6d51b (and 4th CL gauge factory 0x3e703fd2b6506e2abcce2c8b5633872a7d9b6fbc) appear only in a DefiLlama adapter comment, not in any Aerodrome source; unverified.
- Router 0xcF77a3Ba… , FactoryRegistry, the three NFPMs, SwapRouters and Quoters are single-source (official README only); no second corroboration found.
- Mapping NFPM→factory is inferred from code (each NFPM has an immutable `factory` and computes pool addresses from it) and README grouping, not verified on-chain via NFPM.factory(). Verified on chain since (2.8): each NFPM's `factory()` is its paired CLFactory.
- DynamicSwapFeeModule behaviour (fee scaling by tick crossings in the Gauges V3 deployment) was not researched beyond the README summary; CLPool.fee() is a live view that may change block to block for pools under that module.
- Event topic hashes were computed locally with a pure-Python keccak256 validated against three known hashes (v2 Swap, v3 Swap, v3 PoolCreated); not cross-checked against an explorer.

### Technical notes

#### Sources used (all read verbatim from raw GitHub unless noted)

- v2: `aerodrome-finance/contracts` @ main — `contracts/Pool.sol`, `contracts/factories/PoolFactory.sol`, `contracts/interfaces/IPool.sol`, `contracts/interfaces/factories/IPoolFactory.sol`, `contracts/interfaces/IRouter.sol`, `contracts/interfaces/IVoter.sol`, `README.md` (https://github.com/aerodrome-finance/contracts)
- Slipstream: `aerodrome-finance/slipstream` @ main — `contracts/core/CLPool.sol`, `contracts/core/CLFactory.sol`, `contracts/core/interfaces/ICLFactory.sol`, `contracts/core/interfaces/pool/{ICLPoolState,ICLPoolConstants,ICLPoolEvents,ICLPoolActions,ICLPoolDerivedState}.sol`, `contracts/core/libraries/Tick.sol`, `contracts/periphery/interfaces/INonfungiblePositionManager.sol`, `contracts/periphery/NonfungiblePositionManager.sol`, `contracts/gauge/interfaces/ICLGaugeFactory.sol`, `README.md`, `SPECIFICATION.md`, `CHANGELOG.md` (https://github.com/aerodrome-finance/slipstream)
- Cross-check: DefiLlama dimension-adapters `dexs/aerodrome/index.ts` and `dexs/aerodrome-slipstream/index.ts` (event ABIs + topic hash for v2 Swap).
- Topic hashes below were computed with a keccak256 implementation validated against the DefiLlama v2 Swap topic (0xb3e2...) and the canonical Uniswap-v3 Swap/PoolCreated topics.

---

#### A. Aerodrome v2-style pools (PoolFactory 0x420DD381b31aEf6683db6B902084cB0FFECe40Da)

#### A.1 PoolFactory (IPoolFactory.sol / PoolFactory.sol)

```solidity
event PoolCreated(address indexed token0, address indexed token1, bool indexed stable, address pool, uint256); // 5th arg unnamed = allPools.length AFTER push (i.e. 1-based count)
event SetCustomFee(address indexed pool, uint256 fee);
event SetFeeManager(address feeManager); event SetPauser(address pauser); event SetPauseState(bool state); event SetVoter(address voter);

function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address); // fee: 0 => volatile, 1 => stable, else address(0)
function isPool(address pool) external view returns (bool);
function allPools(uint256) external view returns (address);   // public array
function allPoolsLength() external view returns (uint256);
function getFee(address _pool, bool _stable) external view returns (uint256); // in basis points (1/10000)
function isPaused() external view returns (bool);
function voter() external view returns (address);
function implementation() external view returns (address);
uint256 public stableFee;    // initialized 5   (0.05%)
uint256 public volatileFee;  // initialized 30  (0.3%)
uint256 public constant MAX_FEE = 300;            // 3%
uint256 public constant ZERO_FEE_INDICATOR = 420; // customFee[pool]==420 => fee 0
```

- Topic0 `PoolCreated(address,address,bool,address,uint256)` = `0x2128d88d14c80cb081c1252a5acff7a264671bf199ce226b53788fb26065005e`
- Topic0 `SetCustomFee(address,uint256)` = `0xae468ce586f9a87660fdffc1448cee942042c16ae2f02046b134b5224f31936b`
- Fee lookup (PoolFactory.sol L114-117):
```solidity
function getFee(address pool, bool _stable) public view returns (uint256) {
    uint256 fee = customFee[pool];
    return fee == ZERO_FEE_INDICATOR ? 0 : fee != 0 ? fee : _stable ? stableFee : volatileFee;
}
```

- Emit in createPool: `emit PoolCreated(token0, token1, stable, pool, allPools.length);` Pools are deterministic EIP-1167 clones of `implementation`.

#### A.2 Pool (IPool.sol / Pool.sol)

Events:
```solidity
event Fees(address indexed sender, uint256 amount0, uint256 amount1);
event Mint(address indexed sender, uint256 amount0, uint256 amount1);
event Burn(address indexed sender, address indexed to, uint256 amount0, uint256 amount1);
event Swap(address indexed sender, address indexed to, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out);
event Sync(uint256 reserve0, uint256 reserve1);
event Claim(address indexed sender, address indexed recipient, uint256 amount0, uint256 amount1);
```

- Topic0 `Swap(address,address,uint256,uint256,uint256,uint256)` = `0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b` (matches DefiLlama)
- Topic0 `Sync(uint256,uint256)` = `0xcf2aa50876cdfbb541206f89af0ee78d44a2abf8d328e37fa4917f982149848a`
- Topic0 `Mint(address,uint256,uint256)` = `0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f`; `Burn(address,address,uint256,uint256)` = `0x5d624aa9c148153ab3446c1b154f660ee7701e549fe9b62dab7171b1c80e6fa2`; `Fees(address,uint256,uint256)` = `0x112c256902bf554b6ed882d2936687aaeb4225e8cd5b51303c90ca6cf43a8602`
- `Sync` is emitted from `_update()` on every mint/burn/swap/sync, after reserves are set to post-fee balances; so Sync(reserve0,reserve1) is the authoritative post-trade reserve snapshot. `Swap` is emitted right after `_update`, so Swap and Sync for a trade are in the same tx (Sync first).

Read functions:
```solidity
function getReserves() external view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast);
function stable() external view returns (bool);
function metadata() external view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, bool st, address t0, address t1); // dec0/dec1 are 10**decimals (e.g. 1e6, 1e18), NOT the decimals count
function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);
function tokens() external view returns (address, address);
function token0()/token1()/factory() external view returns (address);
function reserve0()/reserve1()/blockTimestampLast() external view returns (uint256);
function currentCumulativePrices() external view returns (uint256 reserve0Cumulative, uint256 reserve1Cumulative, uint256 blockTimestamp);
function lastObservation() external view returns (Observation memory); // struct Observation { uint256 timestamp; uint256 reserve0Cumulative; uint256 reserve1Cumulative; }
function observationLength() external view returns (uint256);
function quote(address tokenIn, uint256 amountIn, uint256 granularity) external view returns (uint256 amountOut);
function sample(address tokenIn, uint256 amountIn, uint256 points, uint256 window) external view returns (uint256[] memory);
uint256 public constant periodSize = 1800; // new observation pushed when >30 min since last
```
Fee is NOT stored in the pool; both `swap` and `getAmountOut` call `IPoolFactory(factory).getFee(address(this), stable)` at call time, fee units = 1/10000:
```solidity
function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256) {
    (uint256 _reserve0, uint256 _reserve1) = (reserve0, reserve1);
    amountIn -= (amountIn * IPoolFactory(factory).getFee(address(this), stable)) / 10000; // remove fee from amount received
    return _getAmountOut(amountIn, tokenIn, _reserve0, _reserve1);
}
```
In `swap`, fees are skimmed out of the pool (`_update0/_update1` to the fee accumulator) BEFORE the invariant check `_k(balance0,balance1) >= _k(reserve0,reserve1)`; i.e. fees do not stay in reserves.

#### A.3 Stable-swap invariant and iteration (Pool.sol, verbatim)

Volatile: `k = x*y`. Stable: `k = x^3*y + y^3*x` after normalizing both reserves to 1e18 (`decimals0/1 = 10**decimals`):
```solidity
function _k(uint256 x, uint256 y) internal view returns (uint256) {
    if (stable) {
        uint256 _x = (x * 1e18) / decimals0;
        uint256 _y = (y * 1e18) / decimals1;
        uint256 _a = (_x * _y) / 1e18;
        uint256 _b = ((_x * _x) / 1e18 + (_y * _y) / 1e18);
        return (_a * _b) / 1e18; // x3y+y3x >= k
    } else {
        return x * y; // xy >= k
    }
}
function _f(uint256 x0, uint256 y) internal pure returns (uint256) {           // f(x0,y) = x0*y*(x0^2+y^2) / 1e54 (fixed-point)
    uint256 _a = (x0 * y) / 1e18;
    uint256 _b = ((x0 * x0) / 1e18 + (y * y) / 1e18);
    return (_a * _b) / 1e18;
}
function _d(uint256 x0, uint256 y) internal pure returns (uint256) {           // df/dy = 3*x0*y^2 + x0^3
    return (3 * x0 * ((y * y) / 1e18)) / 1e18 + ((((x0 * x0) / 1e18) * x0) / 1e18);
}
function _get_y(uint256 x0, uint256 xy, uint256 y) internal view returns (uint256) {   // Newton: solve f(x0,y)=xy for y, max 255 iters
    for (uint256 i = 0; i < 255; i++) {
        uint256 k = _f(x0, y);
        if (k < xy) {
            uint256 dy = ((xy - k) * 1e18) / _d(x0, y);
            if (dy == 0) {
                if (k == xy) { return y; }
                if (_k(x0, y + 1) > xy) { return y + 1; }   // NB: calls _k (which re-normalizes by decimals) — quirk in source
                dy = 1;
            }
            y = y + dy;
        } else {
            uint256 dy = ((k - xy) * 1e18) / _d(x0, y);
            if (dy == 0) {
                if (k == xy || _f(x0, y - 1) < xy) { return y; }  // must return y with f(x0,y) >= xy, never y-1
                dy = 1;
            }
            y = y - dy;
        }
    }
    revert("!y");
}
function _getAmountOut(uint256 amountIn, address tokenIn, uint256 _reserve0, uint256 _reserve1) internal view returns (uint256) {
    if (stable) {
        uint256 xy = _k(_reserve0, _reserve1);                 // k in 1e18 units
        _reserve0 = (_reserve0 * 1e18) / decimals0;
        _reserve1 = (_reserve1 * 1e18) / decimals1;
        (uint256 reserveA, uint256 reserveB) = tokenIn == token0 ? (_reserve0, _reserve1) : (_reserve1, _reserve0);
        amountIn = tokenIn == token0 ? (amountIn * 1e18) / decimals0 : (amountIn * 1e18) / decimals1;
        uint256 y = reserveB - _get_y(amountIn + reserveA, xy, reserveB);   // initial guess y = reserveB
        return (y * (tokenIn == token0 ? decimals1 : decimals0)) / 1e18;
    } else {
        (uint256 reserveA, uint256 reserveB) = tokenIn == token0 ? (_reserve0, _reserve1) : (_reserve1, _reserve0);
        return (amountIn * reserveB) / (reserveA + amountIn);
    }
}
```
Off-chain replication for depth at ±X%: for stable pools, replicate `_k` → `_get_y` exactly in integer math (all divisions floor, 1e18 scale) with `amountIn` already net of `getFee()/10000`; for volatile use constant product with the same fee pre-deduction. Marginal price of a stable pool: dy/dx = (3x^2 y + y^3)/(x^3 + 3 x y^2) in normalized units.

#### A.4 Router (IRouter.sol) for quoting

```solidity
struct Route { address from; address to; bool stable; address factory; }
function getAmountsOut(uint256 amountIn, Route[] memory routes) external view returns (uint256[] memory amounts);
function poolFor(address tokenA, address tokenB, bool stable, address _factory) external view returns (address pool);
function getReserves(address tokenA, address tokenB, bool stable, address _factory) external view returns (uint256 reserveA, uint256 reserveB);
function defaultFactory() external view returns (address); function voter() external view returns (address); function factoryRegistry() external view returns (address);
```

#### A.5 Voter (IVoter.sol)

```solidity
event GaugeCreated(address indexed poolFactory, address indexed votingRewardsFactory, address indexed gaugeFactory, address pool, address bribeVotingReward, address feeVotingReward, address gauge, address creator); // topic0 0xef9f7d1ffff3b249c6b9bf2528499e935f7d96bb6d6ec4e7da504d1d3c6279e1
function gauges(address pool) external view returns (address);
function poolForGauge(address gauge) external view returns (address);
function isGauge(address) external view returns (bool); function isAlive(address gauge) external view returns (bool);
function createGauge(address _poolFactory, address _pool) external returns (address);
```

**State flag (2026-10-21, see §2.8):** at block ~52,918,274 this Voter killed its main gauges
(`isAlive` false for WETH/USDC v2 and Slipstream WETH/USDC 100) and de-whitelisted WETH, USDC and
AERO. Depthwatch's gauge-staked attribution (`Voter.gauges(pool)` for Aerodrome v2 LP,
`CLPool.gauge()` for Slipstream) reads whatever this live Voter and the pools report; gauges of a
successor contract would not be seen. Flagged as an open item (§3), not changed.

---

#### B. Slipstream (concentrated liquidity; Uniswap v3-core d8b1c63 / v3-periphery 6cce88e fork)

#### B.1 Deployment topology (IMPORTANT for indexing)

- Three live CLFactory deployments on Base per README (Initial 0x5e7BB104…, Gauge Caps 0xaDe65c38…, Gauges V3 0xf8f2eB49…), each with its own PoolImplementation, NonfungiblePositionManager, SwapRouter, Quoter and CLGaugeFactory. DefiLlama indexes PoolCreated from all three (+ a deprecated 0x9592cd9b… early factory). Depthwatch should subscribe to `PoolCreated` on every CL factory it wants to cover and remember factory→NFPM mapping.
- Pools are EIP-1167 clones: `pool = Clones.cloneDeterministic(poolImplementation, keccak256(abi.encode(token0, token1, tickSpacing)))` (CLFactory.sol L84-87), so pool address = OZ `predictDeterministicAddress(impl, salt, factory)`; NFPM uses `PoolAddress.computeAddress(factory, poolKey)` with the same scheme.
- `CLFactory.legacyCLFactory()` (immutable) — createPool requires `msg.sender == owner` if the pool already exists on the legacy factory; otherwise anyone can create. `getPool` does NOT fall back to the legacy factory.
- Default tickSpacing→fee enabled in the CLFactory constructor (CLFactory.sol L62-66; SPECIFICATION.md): `1→100` (1 bp), `50→500` (5 bp), `100→500` (5 bp), `200→3000` (30 bp), `2000→10000` (100 bp). Fees are in pips (1e-6). `enableTickSpacing` requires `fee <= 100_000` and tickSpacing ≤ 16384. Fees can be overridden per pool by a swap fee module (Custom or Dynamic) — pools are keyed by tickSpacing, NOT fee; fee is not part of the pool identity.

#### B.2 CLFactory (ICLFactory.sol)

```solidity
event PoolCreated(address indexed token0, address indexed token1, int24 indexed tickSpacing, address pool); // topic0 0xab0d57f0df537bb25e80245ef7748fa62353808c54d6e528a9dd20887aed9ac2
event TickSpacingEnabled(int24 indexed tickSpacing, uint24 indexed fee);                                      // topic0 0xebafae466a4a780a1d87f5fab2f52fad33be9151a7f69d099e8934c8de85b747
function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool);
function createPool(address tokenA, address tokenB, int24 tickSpacing, uint160 sqrtPriceX96) external returns (address pool);
function tickSpacingToFee(int24 tickSpacing) external view returns (uint24 fee);
function tickSpacings() external view returns (int24[] memory);
function allPools(uint256 index) external view returns (address); function allPoolsLength() external view returns (uint256);
function isPool(address pool) external view returns (bool);
function getSwapFee(address pool) external view returns (uint24);     // pips; consults swapFeeModule (200k-gas safe staticcall, accepted if <= 100_000) else tickSpacingToFee
function getUnstakedFee(address pool) external view returns (uint24); // 0 if voter.gauges(pool)==0 or !isAlive; else unstakedFeeModule or defaultUnstakedFee (init 100_000 = 10%)
function voter() external view returns (IVoter); function poolImplementation() external view returns (address); function legacyCLFactory() external view returns (ICLFactory); function factoryRegistry() external view returns (address);
function swapFeeModule()/unstakedFeeModule()/swapFeeManager()/unstakedFeeManager()/owner() external view returns (address); function defaultUnstakedFee() external view returns (uint24);
```
Note: Uniswap v3's `PoolCreated(address,address,uint24,int24,address)` topic (0x783cca1c…) does NOT match Slipstream; use 0xab0d57f0….

#### B.3 CLPool state/constants (ICLPoolState.sol, ICLPoolConstants.sol, CLPool.sol)

```solidity
function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked);
// NOTE: no feeProtocol field (Uniswap v3 slot0 has uint8 feeProtocol before unlocked). Slipstream Slot0 struct = {sqrtPriceX96, tick, observationIndex, observationCardinality, observationCardinalityNext, unlocked}.
function fee() external view returns (uint24);          // == ICLFactory(factory).getSwapFee(address(this)); pips; can change (fee modules)
function unstakedFee() external view returns (uint24);  // == ICLFactory(factory).getUnstakedFee(address(this))
function tickSpacing() external view returns (int24);
function liquidity() external view returns (uint128);        // in-range liquidity INCLUDING staked
function stakedLiquidity() external view returns (uint128);  // in-range liquidity staked in the gauge (subset of liquidity())
function gauge() external view returns (address);            // address(0) until CLGaugeFactory.createGauge sets it
function nft() external view returns (address);              // NFPM; address(0) until gauge created
function factory()/token0()/token1()/factoryRegistry() external view returns (address);
function maxLiquidityPerTick() external view returns (uint128);
function feeGrowthGlobal0X128()/feeGrowthGlobal1X128()/rewardGrowthGlobalX128() external view returns (uint256);
function gaugeFees() external view returns (uint128 token0, uint128 token1);
function rewardRate()/rewardReserve()/periodFinish()/rollover() external view returns (uint256); function lastUpdated() external view returns (uint32);
function tickBitmap(int16 wordPosition) external view returns (uint256);
function ticks(int24 tick) external view returns (
    uint128 liquidityGross,
    int128  liquidityNet,
    int128  stakedLiquidityNet,            // <-- extra vs Uniswap v3 (position 3)
    uint256 feeGrowthOutside0X128,
    uint256 feeGrowthOutside1X128,
    uint256 rewardGrowthOutsideX128,       // <-- extra vs Uniswap v3 (position 6)
    int56   tickCumulativeOutside,
    uint160 secondsPerLiquidityOutsideX128,
    uint32  secondsOutside,
    bool    initialized
);
function positions(bytes32 key) external view returns (uint128 _liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1);
function observations(uint256 index) external view returns (uint32 blockTimestamp, int56 tickCumulative, uint160 secondsPerLiquidityCumulativeX128, bool initialized);
function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
function snapshotCumulativesInside(int24 tickLower, int24 tickUpper) external view returns (int56 tickCumulativeInside, uint160 secondsPerLiquidityInsideX128, uint32 secondsInside);
function getRewardGrowthInside(int24 tickLower, int24 tickUpper, uint256 _rewardGrowthGlobalX128) external view returns (uint256 rewardGrowthInsideX128);
function initialize(address _factory, address _token0, address _token1, int24 _tickSpacing, address _factoryRegistry, uint160 _sqrtPriceX96) external;
```
Tick.Info storage order (Tick.sol L17-41) matches the `ticks()` tuple above: liquidityGross, liquidityNet, stakedLiquidityNet, feeGrowthOutside0X128, feeGrowthOutside1X128, rewardGrowthOutsideX128, tickCumulativeOutside, secondsPerLiquidityOutsideX128, secondsOutside, initialized. A Uniswap-v3 ABI decoder for `ticks()` WILL mis-decode Slipstream (10 fields vs 8). Depth math: walk tickBitmap/ticks exactly as v3 using liquidityNet; `stakedLiquidityNet` only matters for emissions/persistence analytics (in swap, both `liquidity` and `stakedLiquidity` are updated on tick crossing; fee split uses staked share).

#### B.4 CLPool events (ICLPoolEvents.sol) — same shapes as Uniswap v3 plus CollectFees; no ProtocolFees

```solidity
event Initialize(uint160 sqrtPriceX96, int24 tick);                                                             // 0x98636036cb66a9c19a37435efc1e90142190214e8abeb821bdba3f2990dd4c95
event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1); // 0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde
event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1);          // 0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0
event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1);                 // 0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c
event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick);  // 0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67 (identical to Uniswap v3)
event Flash(address indexed sender, address indexed recipient, uint256 amount0, uint256 amount1, uint256 paid0, uint256 paid1);
event IncreaseObservationCardinalityNext(uint16 observationCardinalityNextOld, uint16 observationCardinalityNextNew);
event SetFeeProtocol(uint8 feeProtocol0Old, uint8 feeProtocol1Old, uint8 feeProtocol0New, uint8 feeProtocol1New);
event CollectFees(address indexed recipient, uint128 amount0, uint128 amount1);                                   // 0x205860e66845f2bbc0966bfab80db9bf93fca93862ea2b9fcf6945748352b4a3 (gauge withdraws gaugeFees)
```
CLPool.swap emits `Swap(msg.sender, recipient, amount0, amount1, state.sqrtPriceX96, state.liquidity, state.tick)` — `liquidity` in the event is total in-range liquidity (incl. staked). Mint/Burn/Collect owner for NFPM positions is the NFPM (or the gauge for staked positions; Slipstream has overloaded burn/collect with an `owner` param, so LP identity must be resolved via NFPM events/Voter.gauges, not pool events).

#### B.5 NonfungiblePositionManager (INonfungiblePositionManager.sol)

```solidity
function positions(uint256 tokenId) external view returns (
    uint96 nonce, address operator, address token0, address token1,
    int24 tickSpacing,            // <-- replaces Uniswap v3's uint24 fee at position 5
    int24 tickLower, int24 tickUpper, uint128 liquidity,
    uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,
    uint128 tokensOwed0, uint128 tokensOwed1);
struct MintParams { address token0; address token1; int24 tickSpacing; int24 tickLower; int24 tickUpper; uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min; address recipient; uint256 deadline; uint160 sqrtPriceX96; } // mint creates+initializes the pool if sqrtPriceX96 != 0 and pool missing
event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1); // 0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f
event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1); // 0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4
event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1);           // 0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01
event TokenDescriptorChanged(address indexed tokenDescriptor); event TransferOwnership(address indexed owner);
// inherited: ERC721 Transfer(address,address,uint256) 0xddf252ad…; IERC4906 MetadataUpdate(uint256) emitted on increase/decrease/collect
```
Staked positions: the NFT is transferred to the CLGauge (ERC721 Transfer to gauge address) and `CLPool.stake()` moves liquidity into `stakedLiquidity`; use `Voter.gauges(pool)` / `CLGaugeFactory.isGauge` to classify holders when computing LP concentration.

#### B.6 CLGaugeFactory (ICLGaugeFactory.sol)

`createGauge(address _forwarder, address _pool, address _feesVotingReward, address _rewardToken, bool _isPool)` (called by Voter); getters `voter()`, `minter()`, `implementation()`, `nft()`, `notifyAdmin()`, `isGauge(address)`; V3 adds emission caps / minStakeTime / penaltyRate events (`SetEmissionCap`, `SetPoolMinStakeTime`, `SetPenaltyRate`, …). On gauge creation it sets `pool.gauge` and `pool.nft`.


## aero

Aerodrome and Velodrome merged into Aero on 2026-10-21: "In 2026, Aerodrome will merge with
Velodrome […] to become Aero […] operating on MetaDEX03" (aerodrome-finance/docs@99680a7,
`content/about.mdx` line 11). On Base the new system has its own AERO token, one v2 pool factory
per pool type, one Slipstream CLFactory with its own NonfungiblePositionManager and swap hook, a
FactoryRegistry, and new voters and gauges. The Aerodrome contracts of the section above are not
paused and their pools still trade, but their gauges were killed at blocks 52,918,274–52,918,331
(§2.8).
Depthwatch indexes both platforms: Aero's pools under the DEX ids `aero-v2` and
`aero-slipstream`.

Sources: the deployment files of two public repositories, read at their remote HEADs
(`git ls-remote`; the raw.githubusercontent.com files are byte-identical to the clones):
dromos-labs/metadex-public@8b506b4 (`deployment-addresses/{root,leaf,pools,gaugestack,migration}-base.json`,
sources under `V3/src`) and dromos-labs/metadex-slipstream-public@f99f209
(`deployment-addresses/cl-base.json`, sources under `contracts`). Both READMEs link the protocol to
<https://aero.xyz>, and each repository's `VERSIONS` file lists these Base files under version
1.1.0, first distribution 2026-10-21. aero.xyz, basescan, docs.base.org and base.org could not be
read, and nothing here is attributed to them. Every entry was read on Base mainnet through
Alchemy's endpoint on 2026-10-28 (§2.9); a value read again then replaces the earlier reading.

| key                           | name                                                                   | address                                      | source confidence | independent check |
| ----------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- | ----------------- | ----------------- |
| `aero_token`                  | AERO token (Aero's; `name()` 'Aero')                                   | `0x3f5bF3EdAc59d650D8fDf9657a71F2f904A3a4Ee` | high              | confirmed         |
| `aero_v2_volatile_factory`    | Aero VolatilePoolFactory (v2 constant-product pools)                   | `0x8E6a9FCd1d638CC760Ffba397605Fe3355dE76D2` | high              | confirmed         |
| `aero_v2_stable_factory`      | Aero StablePoolFactory (v2 x³y + xy³ pools)                            | `0x78589E876edcEbdce72ee3436ab3c9AD3a7cEF2D` | high              | confirmed         |
| `aero_v2_volatile_fee_module` | Aero CustomFeeModule of the volatile factory                           | `0x7949DE8d67E4F6b8509Bdbb43FF0503aF1247a7A` | high              | confirmed         |
| `aero_v2_stable_fee_module`   | Aero CustomFeeModule of the stable factory                             | `0x0195fC76Da986D66B2A468133a1be41E90893Da6` | high              | confirmed         |
| `aero_factory_registry`       | Aero FactoryRegistry (pool → gauge for every Aero factory)             | `0x7b2A2c12dC5Ea2a31455952a05031C3E4BB28F3E` | high              | confirmed         |
| `aero_cl_factory`             | Aero Slipstream CLFactory ("Slipstream V3")                            | `0x9CB220581b91b0C83223012FE69688b92aD07a76` | high              | confirmed         |
| `aero_cl_position_manager`    | Aero Slipstream NonfungiblePositionManager ('Slipstream V3 Deposit')   | `0x4857DB576eE0e45F10525eC59527BfD10beeC60b` | high              | confirmed         |
| `aero_cl_swap_hook`           | Aero Slipstream DynamicSwapFeeHook (the CLFactory's default swap hook) | `0xC0ed888AfE87ed1AcF01D9f19bB850159e3ce434` | high              | confirmed         |

Sources and notes per item (`addresses.ts`: `TOKENS.AERO`, `aeroV2`, `aeroSlipstream`):
- `aero_token`: metadex-public@8b506b4 `root-base.json`, key `token`.
  - Confirmed at blocks 53,211,601–53,211,732: `name()` 'Aero', `symbol()` 'AERO', 18 decimals,
    `totalSupply()` 2,129,922,247.87e18; `MINTER()` 0x59268a34…, `VOTING_ESCROW()` 0xbf7977e1…,
    `MIGRATION()` 0x22a2f734…; the root Voter's `TOKEN()` returns it. It is token0 of the first
    volatile pool, 0xf634058d… (AERO/USDC, `PoolCreated` at block 52,884,700), and of CL pool
    0xd0acf293… (AERO/USDC, tick spacing 200).
  - Aerodrome's AERO (`aerodrome_aero_token` above) also answers `symbol()` 'AERO' (its
    `name()` is 'Aerodrome'), so the two are told apart by address only. The `MIGRATION()`
    contract (`migration-base.json` `aerodromeMigration`) converts Aerodrome's AERO one way:
    `Migration.depositLiquid` locks the old tokens in Aerodrome's escrow and pays the same amount
    of the new token, while its budget lasts. That is a conversion, not a price peg: each AERO is
    priced from its own pools.
- `aero_v2_volatile_factory`: metadex-public@8b506b4 `pools-base.json`, key `volatilePoolFactory`.
  - Confirmed at blocks 53,211,601–53,211,635: `allPoolsLength()` 279, and every one of the 279
    pools returns `POOL_TYPE()` 'V2_VOLATILE' and `factory()` pointing back; `implementation()`
    0x0526cf03… (`volatilePoolImplementation`; pool 0x800eb395…'s code is its EIP-1167 clone);
    `factoryRegistry()` 0x7b2a2c12…; `defaultFee()` 30 (bps); `isPaused()` false; `feeModule()`
    0x7949de8d…; `getPool(WETH, USDC)` 0x800eb395… in either order, while the Aerodrome
    3-argument `getPool(a, b, bool)` reverts. First block with code 52,880,042; first `PoolCreated`
    at 52,884,700.
- `aero_v2_stable_factory`: metadex-public@8b506b4 `pools-base.json`, key `stablePoolFactory`.
  - Confirmed at the same blocks: `allPoolsLength()` 21, every pool 'V2_STABLE' with `factory()`
    pointing back; `implementation()` 0xf525988f…; `defaultFee()` 5; `feeModule()` 0x0195fc76…;
    `getPool(WETH, USDC)` 0x4b0fa525… (empty reserves). First block with code 52,880,046; 13
    `PoolCreated` at 52,886,973. Six `getAmountOut` answers of three stable pools at block
    53,085,844 equal the x³y + xy³ solver with the pool's fee to the wei.
- `aero_v2_volatile_fee_module`: metadex-public@8b506b4 `pools-base.json`, key
  `volatileCustomFeeModule` (constructor argument: the volatile factory).
  - Confirmed: the volatile factory's `feeModule()` at 53,211,601 and 53,213,030; source
    `V3/src/fees/CustomFeeModule.sol`: `getFee` reads only `customFee[pool]` (an override, 0 for the
    420 sentinel) and reverts `NoCustomFee` without one, after which the factory's `getBaseFee`
    returns `defaultFee`. Per-pool fees at 53,211,635 in §2.9.
- `aero_v2_stable_fee_module`: metadex-public@8b506b4 `pools-base.json`, key
  `stableCustomFeeModule` (constructor argument: the stable factory).
  - Confirmed: the stable factory's `feeModule()` at the same blocks; the same source as the
    volatile module. Per-pool fees in §2.9.
- `aero_factory_registry`: metadex-public@8b506b4 `leaf-base.json`, key `factoryRegistry` (also
  in metadex-slipstream-public's `leaf-base.json`).
  - Confirmed at 53,211,601: `leafVoter()` 0x382409fa…; `targetFactories()` = [volatile factory,
    stable factory, CLFactory], each `isTargetFactoryApproved`; `factoryToTargetsLength` 279 / 21 /
    489, equal to the three factories' `allPoolsLength()`; `targetToGauge`: 0x800eb395… →
    0x1d12ef78…, CL 0x4a7af46b… → 0x46a9dca7…, 0x45adce4b… → 0xe932a095…, 0x4b0fa525… → 0 (no
    gauge). Every factory's `factoryRegistry()` and the LeafVoter's `FACTORY_REGISTRY()` return it.
  - `targetFactories()` lists only the factories approved now: an earlier set was unregistered at
    block 52,884,126, and its pools are still recorded but no longer listed. It is not a
    discovery root.
- `aero_cl_factory`: metadex-slipstream-public@f99f209 `cl-base.json`, key `clFactory`.
  - Confirmed at 53,211,601: `voter()` 0x382409fa… (the LeafVoter), `poolImplementation()`
    0x1642634c…, `positionManager()` 0x4857db57…, `factoryRegistry()` 0x7b2a2c12…,
    `defaultSwapHook()` 0xc0ed888a…, `owner()` the Safe 0x42255e3c…, `allPoolsLength()` 489,
    `tickSpacings()` [1, 10, 50, 100, 150, 200, 250], `defaultUnstakedFee()` 50,000;
    `getPool(WETH, USDC, 50)` 0x4a7af46b… in either order and with both the int24 and the uint24
    overload, `getPool(WETH, USDC, 100)` 0x2a430beb…; `allPools(0)` 0xbb5507da… and `allPools(488)`
    0x3055c021… point back. `getSwapFee` and `swapFeeModule` revert: the fee comes from the swap
    hook. First block with code 52,881,649; first `PoolCreated` at 52,885,483.
- `aero_cl_position_manager`: metadex-slipstream-public@f99f209 `cl-base.json`, key
  `nftPositionManager`.
  - Confirmed at 53,211,601–53,211,794: `name()` 'Slipstream V3 Deposit', `symbol()` 'AERO-CL',
    `factory()` the CLFactory, `WETH9()` 0x4200…0006; `CLFactory.positionManager()`,
    `CLPool.nft()` (0x4a7af46b…), `CLGauge.nft()` (0x46a9dca7…) and `CLGaugeFactory.nft()` return
    it; `positions()` decodes as the 12-output Slipstream struct (tickSpacing fifth). Its runtime
    code holds the topic of the 6-field `IncreaseLiquidity` (0x0f8712c4…, §2.9) and not the
    4-field 0x3067048b… of the Aerodrome NFPMs.
- `aero_cl_swap_hook`: metadex-slipstream-public@f99f209 `cl-base.json`, key `dynamicSwapFeeHook`
  (constructor argument: the CLFactory).
  - Confirmed by its views at 53,211,907–53,213,030: `CLFactory.defaultSwapHook()` returns it and
    `getPoolSwapHook(pool)` returns it for all 489 pools; `FACTORY()` the CLFactory;
    `getAfterSwapFee` 0; `dynamicFeeConfig(pool)` decodes for all 489 with `initialFeeEnabled`
    false; `defaultFeeCap()` 50,000 pips. Source: metadex-public@8b506b4
    `V3/src/hooks/dynamic/DynamicSwapFeeHook.sol`.

Recorded for context only (not in `addresses.ts`; each is a full address from the deployment
files, confirmed by the reads named):
- LeafVoter `0x382409fad8503FbCdbB27A4211551fa03e884078` (`leaf-base.json` `leafVoter`): the
  CLFactory's `voter()` and every Aero gauge's `voter()`; the old Voter's pool views
  (`gauges(pool)`, `isAlive`, `poolForGauge`, `isRegistered`) all revert on it (53,211,746), so
  gauges are read from the FactoryRegistry or `CLPool.gauge()`.
- Root Voter `0x49d7d4f17Ec56Ef8fA04E464AF5D1A4942CC31e6` (`root-base.json` `voter`): `TOKEN()`
  the new AERO, `MINTER()` 0x59268a34…, `VOTING_ESCROW()` 0xbf7977e1… (53,211,732).
- sAERO escrow `0xBF7977E1521e9a3032bf7243Ee4712f311f13915` (`root-base.json` `votingEscrow`) and
  Minter `0x59268A34ba897e82368feE39839FFC661D4f9C97` (`root-base.json` `minter`): the new AERO's
  `VOTING_ESCROW()` and `MINTER()`.
- AerodromeMigration `0x22a2F7340a3fB4C7C389D91eE954766B12476721` (`migration-base.json`
  `aerodromeMigration`): the new AERO's `MIGRATION()`; the Aerodrome Voter's `emergencyCouncil()`.
- CL pool implementation `0x1642634C8CB1C9f1B84c9a1a08534F8c3F4E89f8` (`cl-base.json`
  `clPoolImplementation`): `CLFactory.poolImplementation()`; 24,315 bytes of code, `POOL_TYPE()`
  'CL', `factory()` 0 (an uninitialised template); pool 0x4a7af46b…'s runtime code is its 45-byte
  EIP-1167 clone.
- v2 pool implementations `0x0526cF035C1156b5C598b0d3c2445e38af2e8bDE` (volatile) and
  `0xf525988f88B7D8b64631D86070FEC5BFDc50C174` (stable) (`pools-base.json`): the factories'
  `implementation()`.
- Gauge factories `0x9FBCf2Df0DC553ce40Ef63963Bff465b76792B7E` (volatile, `GAUGE_TYPE` 'v2'),
  `0x1e0f776E88649285f99e65Fa599aD6e0f9D97800` (stable, 'v2') (`gaugestack-base.json`) and
  `0xf437f62053ACB121665b8fDBfeA8F214FB8E589d` (CL, 'cl'; `cl-base.json` `clGaugeFactory`): the
  FactoryRegistry's `gaugeFactories()`, paired with the three pool factories in that order.
- MEV tax modules `0x830D07BDe136752BCefe0B59a14c2C7af07814AF` (volatile),
  `0x78ee48646a7e1507B79443a1d5494095D16AF3B8` (stable) (`pools-base.json`) and
  `0x29F12cE5Be3D88b56D245B7f4E969C518F799a4a` (CL, `cl-base.json` `clMevTaxModule`): the v2
  factories' `mevTaxModule()` (53,213,030). The tax is 0 at or below a priority fee of 1 gwei
  (volatile) or 2 gwei (stable), and 0 in an `eth_call`.
- DiscountRegistry `0xaA48AAef655FB7CD7Acc04717f66022a4771a345` (`pools-base.json`
  `discountRegistry`): per-caller swap-fee discounts. The swap hook applies them to CL swaps; the
  v2 factories store the pointer but never ask it.

Unresolved:
- The swap hook's bytecode was not compared with its source; only its views and the
  `dynamicFeeConfig` decode were checked.
- Three factories registered in the FactoryRegistry and unregistered at block 52,884,126 have
  pools (for example an AERO (Aero)/USDC pool 0x02afd0e8…); only shortened addresses are known
  (0x9bc8b3f6…, 0xaed253f1…, 0xc6bde6e9…), so they are not indexed, and whether their pools hold
  liquidity is unverified.
- Factories the FactoryRegistry approves later are not indexed until they are added here and to
  `addresses.ts`.
- The stable-pool solver of these pools differs from Aerodrome's in one convergence check
  (`_f(x0, y + 1)` where Aerodrome has `_k(x0, y + 1)`); the six answers above match to the wei,
  but a rare 1-wei difference of mixed-decimal pools is not ruled out.

### Technical notes

#### ABI deltas against Aerodrome (sources at the commits above)

- **v2 pools** (`V3/src/pools/{Pool,VolatilePool,StablePool}.sol`): `getReserves()` and the
  `Swap(address,address,uint256,uint256,uint256,uint256)` event are Aerodrome's (topic0
  0xb3e27736…). `metadata()` returns 6 values (dec0, dec1, r0, r1, t0, t1: no `stable` flag),
  `stable()` reverts, and `POOL_TYPE()` returns bytes32 'V2_VOLATILE' or 'V2_STABLE'.
- **v2 factories** (`V3/src/interfaces/factories/IPoolFactory.sol`): `PoolCreated(address indexed
  token0, address indexed token1, address pool, uint256)` (topic0 0xebbbe9dc…; Aerodrome's has a
  `bool indexed stable`, 0x2128d88d…); `getPool(tokenA, tokenB)` (selector 0x531aa03e);
  `getBaseFee(pool, caller, amount0In, amount1In, reserve0, reserve1)` in bps asks `feeModule()`
  and falls back to `defaultFee()`; `getFee(…)` adds the MEV tax.
- **CL pools** (`contracts/core/CLPool.sol`): `slot0()`, `ticks()`, `liquidity()`, `fee()`,
  `tickSpacing()`, `gauge()`, `nft()` and the `Swap` event as Slipstream (Uniswap v3's topic0
  0xc42079f9…). `fee()` returns the swap hook's fee for an empty caller context: the hook
  computes `min(baseFee + dynamic part, feeCap)` for the first swap of a block and keeps it for the
  block; with `initialFeeEnabled` the first transaction of a block pays `initialFee` instead.
- **CLFactory** (`contracts/core/interfaces/ICLFactory.sol`): Slipstream's `PoolCreated(address
  indexed token0, address indexed token1, int24 indexed tickSpacing, address pool)` (topic0
  0xab0d57f0…), `getPool` with an int24 and a uint24 overload, `tickSpacings()`,
  `tickSpacingToFee`, plus `defaultSwapHook()` and `getPoolSwapHook(pool)`.
- **NonfungiblePositionManager** (`contracts/periphery/interfaces/INonfungiblePositionManager.sol`):
  `IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1,
  int24 tickLower, int24 tickUpper)` (topic0 0x0f8712c47eb813e705bf827a60bdd551e6f2e055b4a1c2004304d52208a5a513);
  `DecreaseLiquidity`, `Collect`, `Transfer` and the 12-output `positions()` are unchanged.
- **Gauges**: a CLGauge takes custody of staked NFTs (`CLGauge._deposit` transfers the token to
  itself) and answers `stakedContains(depositor, tokenId)`; a v2 gauge's `balanceOf(account)` is
  the LP an account staked and `stakingToken()` is the pool.

---

## trade

The routers and quoters of the dashboard's single-pool swap (`exactInputSingle`, recipient the
connected account) and the token allowlist, in `addresses.ts` as `TRADE_ROUTES` and `TRADE_TOKENS`
(subpath `@depthwatch/chain/addresses`). Each router is bound to one pool factory: a swap goes to
the router whose `factory()` is the pool's own `factory()`. Every source below was read again on
2026-11-03 at the commit named (the repository's remote HEAD that day, `git ls-remote`), and every
address was read on Base mainnet through the public endpoint `https://mainnet.base.org` at block
53,467,794 (2026-11-03T16:55:35Z; §2.10). The Aerodrome Slipstream factory 0x9592… (deprecated,
`SLIPSTREAM_DEPRECATED_EARLY_DEPLOYMENT`) has no router or quoter in any source and gets no route.

| key                                 | name                                                 | address                                      | source confidence | independent check |
| ----------------------------------- | ---------------------------------------------------- | -------------------------------------------- | ----------------- | ----------------- |
| `uniswap_v3_swap_router_02`         | Uniswap SwapRouter02 (v3 factory 0x3312…)            | `0x2626664c2603336E57B271c5C0b26F421741e481` | high              | confirmed         |
| `uniswap_v3_quoter_v2`              | Uniswap QuoterV2 (v3 factory 0x3312…)                | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` | high              | confirmed         |
| `slipstream_swap_router`            | Slipstream SwapRouter (initial, factory 0x5e7B…)     | `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5` | high              | confirmed         |
| `slipstream_quoter_v2`              | Slipstream QuoterV2 (initial, factory 0x5e7B…)       | `0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0` | high              | confirmed         |
| `slipstream_swap_router_gauge_caps` | Slipstream SwapRouter (gauge-caps, factory 0xaDe6…)  | `0xcbBb8035cAc7D4B3Ca7aBb74cF7BdF900215Ce0D` | medium            | confirmed         |
| `slipstream_quoter_gauge_caps`      | Slipstream Quoter (gauge-caps, factory 0xaDe6…)      | `0x3d4C22254F86f64B7eC90ab8F7aeC1FBFD271c6C` | medium            | confirmed         |
| `slipstream_swap_router_gauges_v3`  | Slipstream SwapRouter (gauges-v3, factory 0xf8f2…)   | `0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F` | medium            | confirmed         |
| `slipstream_quoter_gauges_v3`       | Slipstream Quoter (gauges-v3, factory 0xf8f2…)       | `0x514c8B5f54112481E28028F1166Bd78501089259` | medium            | confirmed         |
| `aero_cl_swap_router`               | Aero Slipstream SwapRouter (CLFactory 0x9CB2…)       | `0x9Ee35Bf1bd69a03c6F0393582030fCe8Bb93D418` | medium            | not confirmed     |
| `aero_metaquoter`                   | Aero Metaquoter (FactoryRegistry 0x7b2A…, CL quotes) | `0x1dDfeC5058180C207F55BB77D95AcDd0d8227868` | medium            | not confirmed     |

Sources and notes per item (verdict last):
- `uniswap_v3_swap_router_02`: <https://raw.githubusercontent.com/Uniswap/docs/main/content/protocols/v3/deployments/v3-base-deployments.mdx>
  (Uniswap/docs@1c7597d, row SwapRouter02; the page says these addresses were deployed from
  `@uniswap/swap-router-contracts@1.1.0`) and
  <https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json>
  (Uniswap/contracts@ac1f0be, `latest.SwapRouter02`, deployment tx 0x7b983c25…; the `history` entry
  records constructor `factoryV3` 0x33128a8f…, `_positionManager` 0x03a520b3…, `_WETH9` 0x4200…0006,
  `_factoryV2` 0). These replace the third-party verifier citations of the `## uniswap-v3` entry.
  - Block 53,467,794: 24,497 bytes of code; `factory()` = the v3 factory 0x33128a8f…; `WETH9()` =
    0x4200…0006.
  - Verdict: confirmed; route `uniswap-v3`.
- `uniswap_v3_quoter_v2`: the same docs page (row QuoterV2) and registry (`latest.QuoterV2`,
  deployment tx 0x083ce62f…). The registry's `history` entry records constructor `_factory`
  0x9DAaA9041E84025aF8b8d941B302B22204f0a267, which disagrees with the chain: that address has code
  but answers neither `factory()` nor `WETH9()`, and the quoter's own `factory()` is the v3 factory.
  The registry entry is taken as a data error; the reading wins.
  - Block 53,467,794: 8,273 bytes; `factory()` = 0x33128a8f…; `WETH9()` = 0x4200…0006;
    `quoteExactInputSingle` 0.001 WETH → USDC, fee 500 = 2.293248 USDC on 0xd0b53d92…, whose
    `factory()` is 0x33128a8f….
  - Verdict: confirmed (already in `addresses.ts` as `uniswapV3.quoterV2`).
- `slipstream_swap_router`: <https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/README.md>
  (aerodrome-finance/slipstream@f8717fa, "Initial Deployment", row SwapRouter) and
  <https://raw.githubusercontent.com/aerodrome-finance/docs/main/content/security.mdx>
  (aerodrome-finance/docs@99680a7, Slipstream table, row SwapRouter, which lists only this
  deployment's PoolFactory, Quoter and SwapRouter). Not in `DeployCL-Base.json` (deployed later).
  - Block 53,467,794: 9,908 bytes; `factory()` = 0x5e7bb104… (initial); `WETH9()` = 0x4200…0006.
  - Verdict: confirmed; answers item 8 of §3.
- `slipstream_quoter_v2`: the same README (row QuoterV2) and docs page (row Quoter), and
  <https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base.json>
  (key `Quoter`, with `PoolFactory` 0x5e7B…).
  - Block 53,467,794: 6,934 bytes; `factory()` = 0x5e7bb104…; `WETH9()` = 0x4200…0006;
    `quoteExactInputSingle` 0.001 WETH → USDC, tick spacing 100 = 2.293781 USDC on 0xb2cc224c…,
    whose `factory()` is 0x5e7bb104….
  - Verdict: confirmed.
- `slipstream_swap_router_gauge_caps` and `slipstream_quoter_gauge_caps`: the README ("Gauge Caps
  Deployment", rows SwapRouter and Quoter) and
  <https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base-Gauge-Caps.json>
  (keys `SwapRouter`, `Quoter`, with `PoolFactory` 0xaDe6…). Aerodrome's docs page does not list
  them, hence medium.
  - Block 53,467,794: router 9,908 bytes, quoter 6,934 bytes; both `factory()` = 0xade65c38…
    (gauge-caps) and `WETH9()` = 0x4200…0006; quote 0.001 WETH → USDC, tick spacing 50 = 2.294111
    USDC on 0xc758d81b…, whose `factory()` is 0xade65c38….
  - Verdict: confirmed.
- `slipstream_swap_router_gauges_v3` and `slipstream_quoter_gauges_v3`: the README ("Gauges V3
  Deployment", rows SwapRouter and Quoter) and
  <https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base-MinUnstake.json>
  (keys `SwapRouter`, `Quoter`, with `PoolFactory` 0xf8f2…). Not on Aerodrome's docs page.
  - Block 53,467,794: router 9,908 bytes, quoter 6,934 bytes; both `factory()` = 0xf8f2eb49…
    (gauges-v3) and `WETH9()` = 0x4200…0006; quote 0.001 WETH → USDC, tick spacing 50 = 2.293505
    USDC on 0x3fe04a59…, whose `factory()` is 0xf8f2eb49….
  - Verdict: confirmed.
- `aero_cl_swap_router`: <https://raw.githubusercontent.com/dromos-labs/metadex-slipstream-public/f99f2095918cab69eafeffa2c3d0a8762de737b7/deployment-addresses/cl-base.json>
  (dromos-labs/metadex-slipstream-public@f99f209, key `swapRouter`; constructor arguments the
  CLFactory 0x9cb22058… and WETH 0x4200…0006).
  - Block 53,467,794: 10,060 bytes; `factory()` = 0x9cb22058… (the Aero CLFactory); `WETH9()` =
    0x4200…0006.
  - Aero's own pages: app.aero.xyz did not resolve when first tried. On 2026-11-03 a
    script fetched <https://app.aero.xyz/docs/security/> ("Security Overview | Aero Docs") as
    static HTML: its "Aero Slipstream" table lists SwapRouter 0x9Ee35Bf1… under "All chains", its
    "Chain-specific addresses", Base table lists CLFactory 0x9CB22058… and FactoryRegistry
    0x7b2A2c12…, and it links "MetaDEX Slipstream Repository" to
    github.com/dromos-labs/metadex-slipstream-public; <https://aero.xyz/> links
    github.com/Dromos-Labs. That page was not opened in a browser, which is what the first item
    of Unresolved below asks for.
  - Verdict: not confirmed (Aero's contracts page not yet confirmed in a browser; the CL MEV-tax
    threshold, Unresolved below, is unverified); the route is in `TRADE_ROUTES` with a `hold`, so
    `tradeRouteFor` never returns it, and the `aero-slipstream` venue stays off.
- `aero_metaquoter`: the same `cl-base.json` (key `metaquoter`; constructor argument the
  FactoryRegistry 0x7b2a2c12…) and the same Aero docs table (row Metaquoter, "All chains"). Source:
  `contracts/periphery/lens/Metaquoter.sol` at f99f209; it has no `factory()` and resolves each
  pool's factory through `FactoryRegistry.targetToFactory(pool)`, so `factoryRegistry()` is its
  binding.
  - Block 53,467,794: 15,299 bytes; `factoryRegistry()` = 0x7b2a2c12… (`aeroV2.factoryRegistry`);
    `factory()` reverts; `quoteExactInputSingleV3(0x2a430beb…, WETH, 0.001 WETH, 0)` = 2.292127
    USDC, pool 0x2a430beb… (WETH/USDC tick spacing 100) `factory()` 0x9cb22058…; at 53,467,892 the
    registry's `targetToFactory(0x2a430beb…)` is 0x9cb22058… and `isTargetFactoryApproved` of it is
    true.
  - Verdict: not confirmed, as the router above; venue off.

Recorded for context only (not in `addresses.ts`): Paraswap's dex-lib pairs other routers and
quoters with these factories (the `## aerodrome` notes). At block 53,467,794 each has code and is
bound to the factory Paraswap names: router 0x1b2b6ce8… (12,190 bytes) and gauges-v3 router
0x33a47a12… (9,908 bytes), quoters 0xfa2cb6d6… and 0x86d33dcb… (6,934 bytes), `factory()` 0x5e7b…,
0xf8f2…, 0xade6… and 0xf8f2… respectively. More than one router serves a factory; the ones above
are those of Aerodrome's own repository, and nothing else is used.

ABI sources (the minimal ABIs in `packages/chain/src/abi/trade.ts`):
Uniswap/swap-router-contracts@v1.1.0 `contracts/{SwapRouter02,V3SwapRouter}.sol`,
`interfaces/{IV3SwapRouter,IMulticallExtended}.sol`; Uniswap/v3-periphery@24ccf01
`contracts/interfaces/{IQuoterV2,IPeripheryPayments,IPeripheryImmutableState}.sol` and
`contracts/lens/QuoterV2.sol`; Uniswap/v3-core@5ea68a7
`contracts/interfaces/{IUniswapV3Factory,pool/IUniswapV3PoolImmutables}.sol` (both the repository's
HEAD on 2026-11-03, `git ls-remote`: 24ccf014fe7f81d74a14c1689d6fdf123f280e45 and
5ea68a77cb541c6b3812df783be71ba8c081e25f). Uniswap's Base deployments page names v3-periphery
v1.0.0 for its deployments, but QuoterV2 is not in that tag (`contracts/lens/QuoterV2.sol` at
`v1.0.0` answers 404), so the QuoterV2 ABI rests on HEAD and on its selector 0xc6a5026a in the
deployed code (§2.10);
aerodrome-finance/slipstream@f8717fa `contracts/periphery/{SwapRouter,lens/QuoterV2,base/Multicall,base/PeripheryPayments}.sol`,
`contracts/periphery/interfaces/{ISwapRouter,IQuoterV2,IPeripheryPayments,IPeripheryImmutableState}.sol`,
`contracts/core/interfaces/{ICLFactory,pool/ICLPoolConstants,pool/ICLPoolState}.sol`;
dromos-labs/metadex-slipstream-public@f99f209 `contracts/periphery/{SwapRouter,lens/Metaquoter}.sol`,
`contracts/periphery/interfaces/{ISwapRouter,IMetaquoter}.sol`. Facts the swap depends on:
SwapRouter02's `ExactInputSingleParams` has no deadline (`multicall(uint256 deadline, bytes[])` adds
it) and reads recipient `address(2)` (`Constants.ADDRESS_THIS`) as the router itself; every
Slipstream router (Aerodrome's and Aero's) carries `deadline` inside the struct, keys pools by
`int24 tickSpacing`, reads recipient `address(0)` as the router itself, has `multicall(bytes[])`
and ends `exactInputSingle` with `refundETH()`; all of them have `unwrapWETH9(uint256
amountMinimum, address recipient)`, so native ETH out is the swap to the router followed by
`unwrapWETH9(minOut, account)` in one multicall. SwapRouter02's `exactInputSingle`
(swap-router-contracts@v1.1.0 `V3SwapRouter.sol`) ends at the minimum-output check and refunds
nothing: ETH a pool does not take stays in the router, where anyone's `refundETH()` takes it, so
native ETH in on SwapRouter02 is the swap followed by `refundETH()` (v3-periphery
`IPeripheryPayments.sol`) in the same multicall. No quoter signals a partial fill: QuoterV2
(v3-periphery and Slipstream) returns the output of the input it used, so a quote whose
`sqrtPriceX96After` is the open price limit is refused for every quoter.

Unresolved:
- Aero's contracts page: a maintainer opens <https://app.aero.xyz/docs/security/> in a browser
  and confirms the two Aero rows; then the `hold` can be cleared in a change that cites this
  section.
- The Aero CL MEV-tax module 0x29F12cE5… (`## aero`) applies a tax above some priority fee; its
  threshold for CL swaps was not read. A taxed swap fails the minimum-output check (gas lost, no
  funds), but the panel sets the priority fee only once the threshold is known.
- No runtime code was compared byte for byte with its source: the bindings above rest on the
  views, on matching quotes and on the selectors found in the code (§2.10).

---

## tokens-and-chain

| key              | name                                                            | address                                      | source confidence | independent check |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------- | ----------------- | ----------------- |
| `usdc`           | USDC (native, Circle-issued)                                    | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | high              | confirmed         |
| `usdbc`          | USDbC (bridged USDC, legacy)                                    | `0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA` | high              | confirmed         |
| `weth`           | WETH (WETH9 predeploy)                                          | `0x4200000000000000000000000000000000000006` | high              | confirmed         |
| `cbbtc`          | cbBTC (Coinbase Wrapped BTC)                                    | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | high              | confirmed         |
| `cbeth`          | cbETH (Coinbase Wrapped Staked ETH)                             | `0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22` | high              | confirmed         |
| `wsteth`         | wstETH (Lido, canonical bridged)                                | `0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452` | high              | confirmed         |
| `dai`            | DAI (bridged via Base standard bridge)                          | `0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb` | high              | confirmed         |
| `usdt_bridged`   | USDT (Bridged Tether USD - NOT a Tether-issued deployment)      | `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2` | medium            | confirmed         |
| `eurc`           | EURC (Circle euro stablecoin)                                   | `0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42` | high              | confirmed         |
| `aerodrome_aero` | AERO (Aerodrome's; Aero's AERO is `aero_token` under `## aero`) | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | high              | confirmed         |
| `degen`          | DEGEN                                                           | `0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed` | high              | confirmed         |
| `virtual`        | VIRTUAL (Virtuals Protocol)                                     | `0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b` | high              | confirmed         |
| `brett`          | BRETT (Brett on Base)                                           | `0x532f27101965dd16442E59d40670FaF5eBB142E4` | high              | confirmed         |
| `multicall3`     | Multicall3                                                      | `0xcA11bde05977b3631167028862bE2a173976CA11` | high              | confirmed         |

Sources and notes per item:
- `usdc`: <https://developers.circle.com/stablecoins/usdc-contract-addresses>, <https://www.circle.com/blog/usdc-now-available-natively-on-base>, <https://basescan.org/address/0x833589fcd6edb6e08f4c7c32d4f71b54bda02913>
  - 6 decimals. FiatTokenProxy (Circle standard). Native USDC went live on Base 2023-09-05. Basescan label 'Circle: USDC Token'. Base Sepolia test USDC is 0x036CbD53842c5426634e7929541eC2318f3dCF7e (same Circle docs page). Do not confuse with bridged USDbC.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json> — Uniswap default token list (chainId 8453) lists 'USD Coin' USDC at this address with 6 decimals. Second independent source: Aave address book https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Base.sol (USDC_UNDERLYING, DECIMALS 6). Both match the claim exactly (case-insensitive). No conflicting address found.
- `usdbc`: <https://basescan.org/token/0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA>, <https://help.coinbase.com/en/coinbase/getting-started/crypto-education/usd-base-coin>, <https://www.circle.com/blog/usdc-now-available-natively-on-base>
  - 6 decimals. Proxy contract, Basescan label 'Base: USDbC Token'. Lock-and-mint token bridged from Ethereum USDC via the Base standard bridge at mainnet launch; NOT issued by Circle (Circle Mint does not accept it). Liquidity has largely migrated to native USDC (one-way swap UI). Treat as legacy/declining depth.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json> — Uniswap default token list lists 'USD Base Coin' USDbC at this address, 6 decimals. Also AaveV3Base.sol (bgd-labs address book) USDbC_UNDERLYING = same address, DECIMALS 6. Matches claim. Legacy/declining-liquidity characterisation not independently checked but is consistent with the bridged-token nature.
- `weth`: <https://docs.base.org/base-chain/specs/protocol/execution/evm/predeploys>, <https://docs.base.org/base-chain/network-information/base-contracts>, <https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments>
  - 18 decimals. OP-Stack predeploy WETH9, same address on Base Sepolia. Listed as the wrapped native token for Uniswap v3 Base deployment. Standard WETH9 ABI: deposit() payable, withdraw(uint256).
  - verifier: confirmed via <https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Base.sol> — Aave address book WETH_UNDERLYING = 0x4200...0006, DECIMALS 18. Also Uniswap default token list base.json lists 'Wrapped Ether' WETH at same address, 18 decimals. Matches claim (OP-Stack WETH9 predeploy).
- `cbbtc`: <https://www.coinbase.com/campaigns/wrapped-assets>, <https://www.coinbase.com/blog/coinbase-wrapped-btc-cbbtc-is-now-live>, <https://basescan.org/address/0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf>, <https://docs.chain.link/ccip/directory/mainnet/token/cbBTC>
  - 8 decimals (Chainlink CCIP directory lists cbBTC with 8 decimals; Coinbase page does not state decimals). Basescan label 'Coinbase: cbBTC Token', verified. Same address used on Ethereum and Arbitrum. Several impostor 'cbBTC' tokens exist on Base (e.g. 0x8b79ec..., 0xdba27f..., 0xe2e1d6...) - ignore them.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json> — Uniswap default token list lists 'Coinbase Wrapped BTC' cbBTC at this address with 8 decimals. Also AaveV3Base.sol cbBTC_UNDERLYING = same address, DECIMALS 8. Confirms both address and the 8-decimals claim (which the Coinbase page did not state). The docs.chain.link CCIP directory claim was not re-checked (unverified).
- `cbeth`: <https://www.coinbase.com/price/coinbase-wrapped-staked-eth>, <https://basescan.org/token/0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22>
  - 18 decimals. Coinbase price page 'Network & Addresses' table lists this for Base; Basescan label 'Coinbase: cbETH Token'. Non-rebasing, exchange-rate token (not 1:1 with ETH). Look-alike 'Coinbase Ethereum' at 0x19c04be3... is not it.
  - verifier: confirmed via <https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Base.sol> — Aave address book cbETH_UNDERLYING = this address, DECIMALS 18. Also Uniswap default token list base.json 'Coinbase Wrapped Staked ETH' cbETH, same address, 18 decimals. Matches claim.
- `wsteth`: <https://docs.lido.fi/deployed-contracts/>, <https://research.lido.fi/t/wsteth-deployment-to-base-and-ownership-acceptance-by-lido-dao/5668>, <https://basescan.org/token/0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452>
  - 18 decimals. ERC20Bridged proxy (Lido custom bridge over the Base canonical bridge), DAO-approved Nov 2023. Lido L2ERC20TokenBridge on Base: 0xac9D11cD4D7eF6e54F14643a393F68Ca014287AB. Basescan name 'Wrapped liquid staked Ether 2.0'.
  - verifier: confirmed via <https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Base.sol> — Aave address book wstETH_UNDERLYING = this address, DECIMALS 18 (independent of Lido). Lido's docs source file on GitHub (https://raw.githubusercontent.com/lidofinance/docs/main/docs/deployed-contracts/index.md, a different URL from docs.lido.fi) lists Base wstETH 'WstETH ERC20Bridged' proxy at the same address and L2ERC20TokenBridge at 0xac9D11cD4D7eF6e54F14643a393F68Ca014287AB, matching the claim's bridge address. Optimism wstETH is 0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb (different), so no chain confusion. docs.lido.fi itself is unverified.
- `dai`: <https://basescan.org/token/0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb>, <https://basescan.org/address/0x50c5725949a6f0c72e6c4a641f24049a917db0cb>
  - 18 decimals. OptimismMintableERC20 whose constructor args point at L1 DAI 0x6B175474E89094C44Da98b954EedeAC495271d0F; Basescan label 'Maker: DAI Token'. No Sky/MakerDAO documentation page listing a Base address was found - identity rests on Basescan labelling plus the L1 token mapping. DAI has been upgraded to USDS on L1 (Sept 2025) but DAI is not deprecated.
  - verifier: confirmed via <https://raw.githubusercontent.com/ethereum-optimism/ethereum-optimism.github.io/master/data/DAI/data.json> — Superchain token list DAI entry: 'Dai Stablecoin', 18 decimals, base.address = 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb, ethereum.address = 0x6B175474E89094C44Da98b954EedeAC495271d0F (matches the L1 mapping in the claim). Also in Uniswap default token list base.json at the same address, 18 decimals. Fills the gap noted above (no Maker/Sky doc page) with the canonical Superchain bridge registry.
- `usdt_bridged`: <https://basescan.org/token/0xfde4c96c8593536e31f229ea8f37b2ada2699bb2>, <https://basescan.org/address/0xfde4c96c8593536e31f229ea8f37b2ada2699bb2>, <https://www.coindesk.com/price/usdtbase>, <https://tether.to/en/supported-protocols/>
  - 6 decimals. Basescan token name 'Bridged Tether USD (USDT)', contract name 'Bridged USDT Token' - a permissionless standard-bridge mint/burn representation of Ethereum USDT. Tether's supported-protocols page does not list Base, and no Tether-issued native USDT or USDT0 OFT on Base was found as of 2026-10-23. This is the token most DEX pools on Base label 'USDT', so it is the right address for observing USDT pools, but it should be tagged as bridged/unofficial in the UI (as of 2026-10-25 no UI or API field tags it; the bridged status is recorded only in the `addresses.ts` comment). Confidence is 'medium' only for the 'official' question; the address identity itself is explorer-confirmed.
  - verifier: confirmed via <https://raw.githubusercontent.com/ethereum-optimism/ethereum-optimism.github.io/master/data/USDT/data.json> — Superchain (standard-bridge) token list USDT entry: name 'Tether USD', symbol USDT, 6 decimals, base.address = 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2, ethereum.address = 0xdac17f958d2ee523a2206206994597c13d831ec7. Address and 6 decimals confirmed. Its presence in the Superchain standard-bridge registry is consistent with the 'bridged, not Tether-issued' characterisation. The negative claim that no Tether-native USDT/USDT0 exists on Base is not independently re-verified (tether.to not fetched), so keep the 'bridged/unofficial' UI tag; the address identity itself is solid.
- `eurc`: <https://developers.circle.com/stablecoins/eurc-contract-addresses>, <https://www.circle.com/blog/eurc-now-available-on-base>, <https://basescan.org/token/0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42>
  - 6 decimals. FiatTokenProxy. Basescan label 'Circle: EURC Token'.
  - verifier: confirmed via <https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Base.sol> — Aave address book EURC_UNDERLYING = this address, DECIMALS 6. Also Uniswap default token list base.json 'EURC' at same address, 6 decimals. Matches claim.
- `aerodrome_aero` (`aero` until 2026-10-28): <https://aerodrome.finance/security>, <https://github.com/aerodrome-finance/contracts>, <https://basescan.org/token/0x940181a94a35a4569e4529a3cdfb74e38fd98631>
  - 18 decimals. Listed in the AERO row of Aerodrome's security/contracts table and in the aerodrome-finance/contracts README (Aero.sol). Basescan label 'Aerodrome: AERO Token'.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json> — Uniswap default token list (chainId 8453) lists 'Aerodrome Finance' AERO at this address with 18 decimals, independent of Aerodrome's own site/repo. Matches claim. (Not present in Aave address book, as expected.)
- `degen`: <https://basescan.org/token/0x4ed4e862860bed51a9570b96d89af5e1b0efefed>, <https://basescan.org/address/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed>, <https://www.mexc.com/support/articles/17827791514537>
  - 18 decimals, verified source. Basescan label 'Degen: DEGEN Token'; MEXC listing notice links the same Basescan page. No degen.tips docs page surfaced in search. Many 'Degen *' look-alikes exist (DEGENC 0x99298c..., DGENAI 0x54eaf6..., POV 0x4c96a6..., degenOS 0x1014fc...).
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json> — Uniswap default token list lists 'Degen' DEGEN at this address with 18 decimals. Matches claim; a curated list is a stronger identity anchor than Basescan labels alone given the many look-alikes.
- `virtual`: <https://whitepaper.virtuals.io/info-hub/important-links-and-resources/contract-address>, <https://basescan.org/token/0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b>
  - 18 decimals. Official whitepaper 'Contract Address' page lists this as the $VIRTUAL Base token (Ethereum version is 0x44ff8620b8cA30902395A7bD3F2407e1A091BF73 - do not use on Base). Basescan label 'Virtual Protocol: VIRTUAL Token'.
  - verifier: confirmed via <https://raw.githubusercontent.com/Uniswap/default-token-list/main/src/tokens/base.json> — Uniswap default token list lists 'Virtuals Protocol' VIRTUAL at this address with 18 decimals on chainId 8453. Matches claim. The list also carries 'aixbt by Virtuals' at 0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825 - a different token, do not confuse.
- `brett`: <https://basescan.org/token/0x532f27101965dd16442e59d40670faf5ebb142e4>, <https://www.dextools.io/token/brett>
  - 18 decimals, verified source, ownership renounced, ~10B max supply per Basescan. No basedbrett.com page surfaced in search; identity rests on Basescan token page (holders ~660k-810k) and DexTools. Numerous impersonators on Base (e.g. 0xbbe3c3..., 0xC3e1BE..., 0x802cbf..., 'Brett2.0' 0x885129...) - pin by address, never by symbol.
  - verifier: confirmed via <https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x532f27101965dd16442E59d40670FaF5eBB142E4/info.json> — TrustWallet assets repo entry: name 'Brett', symbol BRETT, type BASE, decimals 18, id = this address, website https://www.basedbrett.com/. Web search also surfaced a Seamless governance proposal on tally.xyz and a blockchain.com buying guide citing the same address (not fetched; unverified). Ethereum-mainnet 'BRETT' at 0x80eE5c641A8fFC607545219a3856562F56427FE9 (9 decimals) is a different token. Not in Uniswap default list - pin by address as advised above.
- `multicall3`: <https://docs.base.org/base-chain/specs/protocol/execution/evm/preinstalls>, <https://basescan.org/address/0xca11bde05977b3631167028862be2a173976ca11>, <https://github.com/mds1/multicall3>, <https://cdn.jsdelivr.net/npm/viem@2.52.2/chains/definitions/base.ts>
  - Listed by Base docs as a protocol preinstall (implementation = mds1/multicall v3.1.0). Verified on Basescan (solc 0.8.12, MIT, exact match, >1.3M txs). viem's base chain definition records blockCreated 5022 for Multicall3 on 8453 - use that as the lower bound when calling with historical block tags. Same address on Base Sepolia.
  - verifier: confirmed via <https://raw.githubusercontent.com/wevm/viem/main/src/chains/definitions/base.ts> — viem source on GitHub (different URL/domain from the jsdelivr copy cited above): id 8453, multicall3 address 0xca11bde05977b3631167028862be2a173976ca11, blockCreated 5022 - confirms both address and the block lower bound. Also https://raw.githubusercontent.com/mds1/multicall3/main/deployments.json has entries for chainId 8453 and 84532 whose explorer URLs embed the same address (the file keys deployments by URL, not an 'address' field). The docs.optimism.io preinstalls page is unverified. Note these are the same two projects cited above, just via different URLs; no source anywhere gives a different Multicall3 address for Base.

Unresolved:
- USDT: no Tether-issued (native) USDT and no USDT0 OFT deployment on Base was found as of 2026-10-23; tether.to/en/supported-protocols does not list Base. 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2 is Basescan-labelled 'Bridged USDT Token' (permissionless standard-bridge representation). Re-check tether.to and usdt0.to before labelling any Base USDT as official.
- DAI: no Sky/MakerDAO documentation page listing the Base DAI address was found; identity of 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb rests on Basescan's 'Maker: DAI Token' label and its OptimismMintableERC20 constructor pointing at L1 DAI.
- DEGEN and BRETT: no issuer/official-site page (degen.tips, basedbrett.com) surfaced in search; identities rest on Basescan token/address labels (plus a MEXC listing notice for DEGEN). Both tokens have many impersonators on Base.
- cbBTC decimals (8) sourced from Chainlink's CCIP directory and an aggregator, not from a Coinbase page; confirm via decimals() on chain.
- Flashblocks pending-block field semantics are inconsistent across Base docs (one page says hash/number are null for the pending block, another says number = block being built); verify against a live mainnet-preconf.base.org response.
- Rate limits for mainnet-preconf.base.org (HTTP and WS) are not quantified in the docs; PublicNode's Base WebSocket URL was not verified.
- Denim upgrade dates (Sepolia Oct 2026 / Mainnet Nov 2026) are targets marked 'Planning' in Base docs; a third-party post cites Sepolia 2026-10-21 18:00 UTC and mainnet Nov 2026 - not confirmed on docs.base.org. Denim will remove Flashblocks subscriptions and the pending tag.
- docs.base.org's block-explorers page names 'Blockscout' but the snippet did not show the base.blockscout.com URL; the URL and its /address/ and /token/ formats were confirmed from base.blockscout.com pages themselves.
- Every fact above comes from search-result snippets rather than full page reads (unverified in full).

### Technical notes

#### Chain identity

- **Base Mainnet**: chainId **8453** (hex `0x2105`); native currency **ETH** ("Ether", 18 decimals). Base Sepolia: 84532, explorer sepolia.basescan.org. Sources: https://docs.base.org/get-started/connect-to-base , https://docs.base.org/base-account/reference/core/provider-rpc-methods/wallet_addEthereumChain , https://docs.base.org/base-chain/api-reference/rpc-overview
- Both mainnet and Sepolia public endpoints are archive-enabled per the RPC overview page.

#### Public RPC endpoints

| Endpoint                                                                                                                                                                                                                                                                                         | Notes                                                                                                                                                                                                                                    | Source                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `https://mainnet.base.org`                                                                                                                                                                                                                                                                       | Official public HTTP RPC. Rate-limited, "not suitable for production". **HTTP only - no WebSocket / eth_subscribe.** `eth_getBlockReceipts` returns HTTP 403 here. All Base public endpoints are Flashblocks-enabled (accept `pending`). | https://docs.base.org/base-chain/api-reference/rpc-overview , https://docs.base.org/base-chain/flashblocks/apps                            |
| `https://mainnet-preconf.base.org` / `wss://mainnet-preconf.base.org`                                                                                                                                                                                                                            | Official Flashblocks-aware public endpoint (HTTP + WS). Rate-limited. Sepolia: `https://sepolia-preconf.base.org`, `wss://sepolia-preconf.base.org`.                                                                                     | https://docs.base.org/base-chain/flashblocks/api-reference , https://docs.base.org/base-chain/api-reference/flashblocks-api/newFlashblocks |
| `wss://mainnet.flashblocks.base.org/ws`                                                                                                                                                                                                                                                          | Raw Flashblocks stream **for node operators only**; apps should not consume it directly.                                                                                                                                                 | https://docs.base.org/base-chain/node-operators/run-a-base-node                                                                            |
| `https://base-rpc.publicnode.com`                                                                                                                                                                                                                                                                | PublicNode public gateway (WS variant advertised on the page but URL not verified).                                                                                                                                                      | https://base-rpc.publicnode.com/                                                                                                           |
| `https://base.drpc.org` / `wss://base.drpc.org`                                                                                                                                                                                                                                                  | dRPC public endpoint.                                                                                                                                                                                                                    | https://drpc.org/public-endpoints/base                                                                                                     |
| `https://base.llamarpc.com` / `wss://base.llamarpc.com`                                                                                                                                                                                                                                          | LlamaNodes public endpoint.                                                                                                                                                                                                              | https://llamarpc.com/base                                                                                                                  |
| `https://public.1rpc.io/base`                                                                                                                                                                                                                                                                    | 1RPC public endpoint (older form `https://1rpc.io/base` appears in a 2023 Automata post; current docs use `public.1rpc.io`).                                                                                                             | https://www.1rpc.io/ecosystem/base , https://docs.1rpc.io/using-the-web3-api/networks                                                      |
| Base docs' node-provider list (Alchemy, QuickNode, dRPC, CDP, Ankr, Blast, Blockdaemon, NodeReal, Nodies, NOWNodes, OnFinality, All That Node, 1RPC): https://docs.base.org/base-chain/node-operators/node-providers . Flashblocks-aware providers named by Base docs: Alchemy, QuickNode, dRPC. |

#### Block time

- Canonical block interval **2 s**; each block is composed of **10 Flashblocks** (index 1-10) streamed every **~200 ms**. Sources: https://docs.base.org/base-chain/flashblocks/faq , https://docs.base.org/specifications/flashblocks
- **Denim upgrade (planned, NOT active as of 2026-10-23)**: moves Base to five canonical blocks per second (200 ms blocks) and **removes Flashblocks** (subscriptions and `pending` state become unavailable). Docs target: Base Sepolia October 2026, Base Mainnet November 2026 (status "Planning"; activation heights/client versions undecided). Migration map: `eth_subscribe("newFlashblocks")` -> `newHeads`; `eth_subscribe("pendingLogs")` -> `logs`; `pending`-tag reads -> ordinary `latest` reads (no preconfirmation equivalent). Sources: https://docs.base.org/upgrades/denim/overview , https://docs.base.org/upgrades/denim/migrate-from-flashblocks , https://docs.base.org/upgrades/denim/200ms-blocks . **Design implication for Depthwatch:** abstract the "fast tick" source behind an interface so the Flashblocks path can be swapped for 200 ms canonical `newHeads` after Denim.

#### Flashblocks (sub-block preconfirmations)

- **Mainnet go-live: 16 July 2025** (Base engineering deep dive: "launch on July 16th ... concluded a four-month development journey from testnet to mainnet"; Base Build X post same day; press coverage 17 July). Sepolia testnet since Feb 2025; staged mainnet rollout from May 2025. Built with Flashbots (rollup-boost; block builder op-rbuilder). Sources: https://blog.base.dev/flashblocks-deep-dive , https://blog.base.dev/accelerating-base-with-flashblocks , https://x.com/buildonbase/status/1895223243713458184 , https://x.com/buildonbase/status/1923058518896132214 , https://www.theblock.co/post/363109/coinbase-base-flashblocks
- **Mechanism:** the builder emits partial blocks every ~200 ms, each carrying ~10% of a block's gas; nodes apply them to a "pending" state. Optional: nodes/apps that ignore them behave exactly as before.
- **HTTP consumption - `pending` block tag:** on a Flashblocks-aware endpoint, `"pending"` returns the live pre-confirmed block-in-progress, refreshed every ~200 ms, i.e. state up to ~1.8 s ahead of `latest`. Methods documented as accepting `pending`: `eth_getBlockByNumber`, `eth_getBalance`, `eth_getTransactionByHash`, `eth_getTransactionCount`, `eth_getCode`, `eth_getStorageAt`, `eth_call`, `eth_simulateV1`, `eth_estimateGas`, `eth_getLogs`. `eth_getTransactionReceipt` returns receipts for preconfirmed txs **without any tag** (client v0.8.0+). Pending block has the same shape as a sealed block; docs say `hash`/`number` may be `null` for the pending block in one place and "number = block being built" in another (inconsistent - handle both). If no flashblock is available some providers silently fall back to `latest`. Sources: https://docs.base.org/base-chain/flashblocks/apps , https://docs.base.org/base-chain/flashblocks/api-reference , https://docs.base.org/base-chain/api-reference/flashblocks-api/flashblocks-api-overview , https://docs.getblock.io/flashblocks/base-flashblocks
- **WebSocket consumption - `eth_subscribe` (standard method name; no `base_*` namespace exists; Chainstack's "base_subscribe_newflashblocks" is just their doc slug):**
  - `eth_subscribe("newFlashblocks")` -> one Flashblock object per message (~200 ms), containing the accumulated pre-confirmed state for the in-progress block. Requires client v0.3.1+. Only on Flashblocks WS endpoints (`wss://mainnet-preconf.base.org` or a provider). https://docs.base.org/base-chain/api-reference/flashblocks-api/newFlashblocks
  - `eth_subscribe("newFlashblockTransactions")` -> preconfirmed transactions with full data. Requires v0.8.0+. https://docs.base.org/base-chain/api-reference/flashblocks-api/newFlashblockTransactions
  - `eth_subscribe("pendingLogs", filter?)` -> logs from preconfirmed txs matching an optional address/topics filter (best fit for watching Swap/Mint/Burn events ahead of the 2 s block). https://docs.base.org/base-chain/api-reference/flashblocks-api/pendingLogs
  - Docs recommend throttling heavy handlers (events every ~200 ms). The official `mainnet.base.org` endpoint cannot do any of this (HTTP only).
- Flashblocks-aware `eth_call`/`eth_estimateGas` were "still in development" at the July 2025 deep-dive; the current API reference lists them as accepting `pending`.

#### Explorer URL formats

- **Basescan (Etherscan family, listed by docs.base.org as the Base explorer):**
  - Address/contract: `https://basescan.org/address/{address}` (e.g. https://basescan.org/address/0xca11bde05977b3631167028862be2a173976ca11)
  - Token tracker: `https://basescan.org/token/{address}` ; holder filter `?a={holderAddress}` (e.g. https://basescan.org/token/0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA)
  - Transaction: `https://basescan.org/tx/{hash}`
  - Testnet: `https://sepolia.basescan.org/...` ; API hosts `https://api.basescan.org/api`, `https://api-sepolia.basescan.org/api`. Sources: https://docs.base.org/get-started/connect-to-base , https://docs.base.org/chain/block-explorers
- **Blockscout (also linked from Base docs/Coinbase Wallet):**
  - `https://base.blockscout.com/address/{address}` (e.g. https://base.blockscout.com/address/0x8B77cd4cc5E0C35542bBfB1004C860eD1e9F8EF5)
  - `https://base.blockscout.com/token/{address}` (e.g. https://base.blockscout.com/token/0x226a2fa2556c48245e57cd1cba4c6c9e67077dd2)
  - `https://base.blockscout.com/tx/{hash}` ; REST API `https://base.blockscout.com/api/v2/`. Sources: https://base.blockscout.com/tokens , https://www.blog.blockscout.com/blockscout-base/ , https://docs.blockscout.com/api-reference/get-token-info.md

#### Token decimals (for amount normalisation)

| Token                                                                                                 | Decimals | Source                                                     |
| ----------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| USDC, USDbC, EURC, USDT(bridged)                                                                      | 6        | Basescan token pages / Circle docs / 1inch EURC spec       |
| cbBTC                                                                                                 | 8        | https://docs.chain.link/ccip/directory/mainnet/token/cbBTC |
| WETH, cbETH, wstETH, DAI, AERO, DEGEN, VIRTUAL, BRETT                                                 | 18       | Basescan token pages ("Token Contract (WITH 18 Decimals)") |
| Always read `decimals()` on chain at startup rather than hard-coding; the table is for sanity checks. |

#### Multicall3 interface (verified source on Basescan; https://github.com/mds1/multicall3)

```solidity
struct Call  { address target; bytes callData; }
struct Call3 { address target; bool allowFailure; bytes callData; }
struct Call3Value { address target; bool allowFailure; uint256 value; bytes callData; }
struct Result { bool success; bytes returnData; }
function aggregate(Call[] calldata calls) payable returns (uint256 blockNumber, bytes[] memory returnData);
function tryAggregate(bool requireSuccess, Call[] calldata calls) payable returns (Result[] memory);
function tryBlockAndAggregate(bool requireSuccess, Call[] calldata calls) payable returns (uint256 blockNumber, bytes32 blockHash, Result[] memory);
function aggregate3(Call3[] calldata calls) payable returns (Result[] memory);
function aggregate3Value(Call3Value[] calldata calls) payable returns (Result[] memory);
function getBlockNumber() view returns (uint256);
function getCurrentBlockTimestamp() view returns (uint256);
function getEthBalance(address addr) view returns (uint256);
function getBasefee() view returns (uint256);
```
viem's `base` chain definition already wires `contracts.multicall3 = { address: 0xcA11bde05977b3631167028862bE2a173976CA11, blockCreated: 5022 }`, so `publicClient.multicall()` works out of the box (https://cdn.jsdelivr.net/npm/viem@2.52.2/chains/definitions/base.ts). Pair `aggregate3` with `blockTag: "pending"` on a Flashblocks endpoint for sub-second depth snapshots, and with `latest` for the canonical 2 s series.

#### Research caveats

All evidence came from web-search result snippets; no page was read in full (unverified in full). EIP-55 checksums above were computed locally with viem `getAddress` and match the casing shown on Circle/Coinbase/Basescan pages.


## Open items (Base mainnet, chainId 8453)

A second pass over the research above: the medium and low-confidence items re-checked, what an indexer still needs, the on-chain checks, and what remains unresolved.

## 0. Headline

- **No address was disputed**: every verdict address equals the claimed address (case-insensitive). The real gaps are (a) medium/low-confidence items that were single-sourced, (b) things an indexer needs that were not researched (start blocks, event topics, ABI deltas between Slipstream/Aerodrome-v2 and the Uniswap originals, position-owner attribution, USD pricing feeds, RPC limits), and (c) one factual correction to the v4 notes (the `ModifyPosition` event does exist in v4-periphery, but the Base PositionManager predates it).

## 1. Unconfirmed and medium/low-confidence items, re-checked

| Key                                                             | Claimed                                    | Final answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Source                                                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uniswap_universal_router_v2_2_0` (medium)                      | 0xBE2257d1aAfBE6B73F67A9ac971C2F0B344Bb3c5 | **Confirmed** (still all Uniswap-authored). Registry key `UniversalRouter#v2.2` = 0xbe2257d1…, timestamp 2026-09-24; universal-router-sdk `V2_2_0` creationBlock **51740773**. Note the registry's bare `UniversalRouter` key (= "latest") is **2.1.2 (0xd6145b2D…)**, so 2.2.0 is a parallel permissioned-pools line, not the default router.                                                                                                                                                            | https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json ; https://raw.githubusercontent.com/Uniswap/sdks/main/sdks/universal-router-sdk/src/utils/constants.ts |
| `uniswap_v4_quoter` vs `_legacy`                                | 0xE1A6…CA47 / 0x0d5e…048D                  | Use **0xE1A6C5803e3c44368b171BD680c7D32dfc92CA47**: registry `V4Quoter` latest (2025-05-09) and sdk-core `BASE_ADDRESSES.v4QuoterAddress` agree.                                                                                                                                                                                                                                                                                                                                                          | same registry file; https://raw.githubusercontent.com/Uniswap/sdks/main/sdks/sdk-core/src/addresses.ts                                                                                     |
| `aerodrome_v2_router` (medium)                                  | 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43 | **Confirmed** by Velodrome's own sugar-sdk Base config (`router_contract_addr`).                                                                                                                                                                                                                                                                                                                                                                                                                          | https://raw.githubusercontent.com/velodrome-finance/sugar-sdk/main/sugar/config.py                                                                                                         |
| `aerodrome_factory_registry` (medium)                           | 0x5C3F18F06CC09CA1910767A34a20F771039E37C0 | **Confirmed** (`REGISTRY_8453`). Use `FactoryRegistry.poolFactories()` to enumerate factories instead of hard-coding.                                                                                                                                                                                                                                                                                                                                                                                     | https://raw.githubusercontent.com/velodrome-finance/sugar/main/deployments/base.env                                                                                                        |
| `slipstream_cl_factory_deprecated_early` (low)                  | 0x9592cd9b267748cbFbDe90Ac9f7df3c437A6d51b | **Real, historical.** DefiLlama's adapter indexes it from block **13592962** with comment "Deprecated early Slipstream factory (Apr 2024, 22 pools)"; Velodrome's Envio indexer lists it as a 4th Base CLFactory. Pool count still unverified.                                                                                                                                                                                                                                                            | https://raw.githubusercontent.com/DefiLlama/dimension-adapters/master/dexs/aerodrome-slipstream/index.ts ; https://raw.githubusercontent.com/velodrome-finance/indexer/main/config.yaml    |
| `slipstream_nonfungible_position_manager` ×3 (medium)           | 0x8279…5b72 / 0xa990…D55F / 0xe1f8…8b53    | **Confirmed.** `DeployCL-Base.json` pairs NFPM 0x827922… with PoolFactory 0x5e7B…; sugar-sdk pairs `nfpm_contract_addr` 0xe1f8cd… with `slipstream_factory_addr` 0xf8f2…; indexer lists all three.                                                                                                                                                                                                                                                                                                        | https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/script/constants/output/DeployCL-Base.json ; sugar-sdk config.py ; indexer config.yaml                                 |
| 4th NFPM 0xc741beb2156827704A1466575ccA1cBf726a1178             | (flagged)                                  | **Verified on chain in §2.8** (`NFPM.factory()` = 0x9592…, the deprecated factory, at block 53,061,932). First seen only in the Velodrome indexer NFPM list.                                                                                                                                                                                                                                                                                                                                              | indexer config.yaml                                                                                                                                                                        |
| 4th CL gauge factory 0x3e703fd2b6506e2abcce2c8b5633872a7d9b6fbc | (flagged)                                  | **Unverified** — DefiLlama adapter only; absent from Aerodrome README, deploy JSONs, indexer. Not needed for depth; needed only if you resolve gauges by factory rather than via `Voter.gauges(pool)`.                                                                                                                                                                                                                                                                                                    | DefiLlama adapter above                                                                                                                                                                    |
| `slipstream_swap_router` / `slipstream_quoter_v2` (medium)      | 0xBE6D…18a5 / 0x254c…15b0                  | Quoter **confirmed** (`DeployCL-Base.json` key `Quoter` = 0x254cF9E1…). SwapRouter only in README + Basescan snippet (deployed later, not in deploy JSON). Per-factory routers/quoters from README: Gauge Caps SwapRouter 0xcbBb8035cAc7D4B3Ca7aBb74cF7BdF900215Ce0D / Quoter 0x3d4C22254F86f64B7eC90ab8F7aeC1FBFD271c6C; Gauges V3 SwapRouter 0x698Cb2b6dd822994581fEa6eA4Fc755d1363A92F / Quoter 0x514c8B5f54112481E28028F1166Bd78501089259 / MixedQuoterV3 0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555. | https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/README.md                                                                                                              |
| `usdt_bridged` (medium)                                         | 0xfde4C96c…                                | Fine as-is; nothing new found.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                          |

## 2. Missing items the indexer will certainly need

### 2.1 Backfill start blocks (none were researched)

| Contract                                           | Start block                                                                                                                                                                                                                                                                                             | Source                                                                                                                                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uniswap v3 Factory 0x33128a8f…                     | **~1371680** (substreams package example `--start-block=1371680 # Uniswap V3 on Base`; consistent with registry deploy timestamp 2023-07-16). Uniswap's own v3-subgraph Base config uses `startblock` **2009445** (later; probably public launch). Use 1371680 and let `PoolCreated` scanning prove it. | https://substreams.dev/packages/coinranking-uniswap-v3-forks/v0.2.0 ; https://raw.githubusercontent.com/Uniswap/v3-subgraph/main/config/base/config.json ; https://raw.githubusercontent.com/Uniswap/contracts/main/deployments/json/8453.json |
| Uniswap v4 PoolManager                             | **25350988**                                                                                                                                                                                                                                                                                            | https://raw.githubusercontent.com/Uniswap/v4-subgraph/main/networks.json (`base.PoolManager.startBlock`)                                                                                                                                       |
| Uniswap v4 PositionManager                         | **25350993**                                                                                                                                                                                                                                                                                            | same file                                                                                                                                                                                                                                      |
| Aerodrome v2 PoolFactory 0x420DD381…               | **3200559** (2023-08-28 02:41 UTC); first `PoolCreated` ≈ 3204872                                                                                                                                                                                                                                       | https://substreams.dev/packages/aerodrome-v2/latest                                                                                                                                                                                            |
| Slipstream CLFactory 0x9592… (deprecated)          | 13592962                                                                                                                                                                                                                                                                                                | DefiLlama adapter (above)                                                                                                                                                                                                                      |
| Slipstream CLFactory 0x5e7B… (initial)             | 13843704                                                                                                                                                                                                                                                                                                | DefiLlama adapter                                                                                                                                                                                                                              |
| Slipstream CLFactory 0xaDe6… (Gauge Caps)          | 36953918                                                                                                                                                                                                                                                                                                | DefiLlama adapter                                                                                                                                                                                                                              |
| Slipstream CLFactory 0xf8f2… (Gauges V3)           | 44394724                                                                                                                                                                                                                                                                                                | DefiLlama adapter                                                                                                                                                                                                                              |
| Universal Router 1.2 / 2.0 / 2.1.1 / 2.1.2 / 2.2.0 | 9107268 / 25350999 / 43501203 / 51446913 / 51740773                                                                                                                                                                                                                                                     | universal-router-sdk constants.ts                                                                                                                                                                                                              |

### 2.2 Event signatures and topic0 (not in the pack; computed locally with a pure-Python keccak validated against the known v3 `Swap` hash 0xc42079f9…)

Non-obvious ones first (these break naive "reuse the Uniswap ABI" code):

| Protocol / event                                         | Signature                                                                                                                                                                                                         | topic0                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Aerodrome v2 `PoolFactory.PoolCreated`                   | `PoolCreated(address indexed token0, address indexed token1, bool indexed stable, address pool, uint256)`                                                                                                         | 0x2128d88d14c80cb081c1252a5acff7a264671bf199ce226b53788fb26065005e                          |
| Aerodrome v2 `Pool.Swap` (**differs from UniV2**)        | `Swap(address indexed sender, address indexed to, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out)`                                                                                  | 0xb3e2773606abfd36b5bd91394b3a54d1398336c65005baf7bf7a05efeffaf75b (UniV2's is 0xd78ad95f…) |
| Aerodrome v2 `Pool.Sync` (uint256, not uint112)          | `Sync(uint256 reserve0, uint256 reserve1)`                                                                                                                                                                        | 0xcf2aa50876cdfbb541206f89af0ee78d44a2abf8d328e37fa4917f982149848a                          |
| Aerodrome v2 `Mint` / `Burn` / `Fees`                    | `Mint(address indexed,uint256,uint256)` / `Burn(address indexed,address indexed,uint256,uint256)` / `Fees(address indexed,uint256,uint256)`                                                                       | 0x4c209b5f… / 0x5d624aa9… / 0x112c2569…                                                     |
| Slipstream `CLFactory.PoolCreated` (**differs from v3**) | `PoolCreated(address indexed token0, address indexed token1, int24 indexed tickSpacing, address pool)`                                                                                                            | 0xab0d57f0df537bb25e80245ef7748fa62353808c54d6e528a9dd20887aed9ac2 (v3's is 0x783cca1c…)    |
| Slipstream `CLFactory.TickSpacingEnabled`                | `TickSpacingEnabled(int24 indexed tickSpacing, uint24 indexed fee)`                                                                                                                                               | 0xebafae466a4a780a1d87f5fab2f52fad33be9151a7f69d099e8934c8de85b747                          |
| Slipstream `CLPool.Swap/Mint/Burn/Collect`               | identical to Uniswap v3                                                                                                                                                                                           | 0xc42079f9… / 0x7a53080b… / 0x0c396cd9… / 0x70935338…                                       |
| Slipstream `CLPool.CollectFees` (gauge fee drain)        | `CollectFees(address indexed recipient, uint128 amount0, uint128 amount1)`                                                                                                                                        | 0x205860e6…                                                                                 |
| Slipstream `CLGauge.Deposit/Withdraw`                    | `Deposit(address indexed user, uint256 indexed tokenId, uint128 indexed liquidityToStake)` / `Withdraw(...)` same params                                                                                          | 0x1c8ab8c7… / 0x8903a5b5…                                                                   |
| Aerodrome v2 `Gauge.Deposit/Withdraw`                    | `Deposit(address indexed from, address indexed to, uint256 amount)` / `Withdraw(address indexed from, uint256 amount)`                                                                                            | 0x5548c837… / 0x884edad9…                                                                   |
| Aerodrome `Voter.GaugeCreated`                           | `GaugeCreated(address indexed poolFactory, address indexed votingRewardsFactory, address indexed gaugeFactory, address pool, address bribeVotingReward, address feeVotingReward, address gauge, address creator)` | 0xef9f7d1f…                                                                                 |
| Uniswap v4 `Initialize`                                  | `Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)`                                            | 0xdd466e67…                                                                                 |
| Uniswap v4 `ModifyLiquidity`                             | `ModifyLiquidity(bytes32 indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)`                                                                              | 0xf208f491…                                                                                 |
| Uniswap v4 `Swap`                                        | `Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)`                                                               | 0x40e9cecb…                                                                                 |
| v4 POSM `Subscription/Unsubscription`                    | `(uint256 indexed tokenId, address indexed subscriber)`                                                                                                                                                           | 0x97094923… / 0xa0ebb1de…                                                                   |
| v3 `FeeAmountEnabled`                                    | `FeeAmountEnabled(uint24 indexed fee, int24 indexed tickSpacing)`                                                                                                                                                 | 0xc66a3fdf…                                                                                 |

Sources for the signatures: https://raw.githubusercontent.com/aerodrome-finance/contracts/main/contracts/interfaces/IPool.sol , …/IPoolFactory.sol , …/IVoter.sol , …/IGauge.sol ; https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/contracts/core/interfaces/ICLFactory.sol , …/pool/ICLPoolEvents.sol , …/gauge/interfaces/ICLGauge.sol ; https://raw.githubusercontent.com/Uniswap/v4-core/main/src/interfaces/IPoolManager.sol ; https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/interfaces/INotifier.sol . Full hashes are in the computation output; recompute in CI from the ABI rather than pasting.

### 2.3 ABI deltas vs. the Uniswap v3 reference (depth maths will silently break without these)

**Slipstream `CLPool`** (https://raw.githubusercontent.com/aerodrome-finance/slipstream/main/contracts/core/interfaces/pool/ICLPoolState.sol , …/core/CLPool.sol , …/core/CLFactory.sol):
- `slot0()` returns **6** fields `(sqrtPriceX96, tick, observationIndex, observationCardinality, observationCardinalityNext, unlocked)` — no `feeProtocol`. Decoding with the v3 ABI corrupts `unlocked`.
- `ticks(int24)` returns **10** fields incl. `int128 stakedLiquidityNet` and `uint256 rewardGrowthOutsideX128`; v3 TickLens cannot be pointed at these pools. Use `SugarHelper.getPopulatedTicks(pool, startTick)` (0x0AD09A66af0154a84e86F761313d02d0abB6edd5, README) or read `tickBitmap(int16)` + `ticks()` via Multicall3.
- `fee()` is **live**: `return ICLFactory(factory).getSwapFee(address(this))`, which staticcalls the factory's `swapFeeModule` (DynamicSwapFeeModule on all three deployments: 0x090b2A6b…, 0xF4Ecd78E…, 0x87D8f999…) with a 200k-gas cap, falling back to `tickSpacingToFee`. Fee can change per block → snapshot it with every depth sample; effective-spread must use the fee at the block, not a static tier.
- `unstakedFee()` (denominator 1e6, default 100000 = 10%) and `stakedLiquidity()`: fee accrual to unstaked LPs is scaled, but **price impact uses `liquidity()`**, so depth = v3 formula; only fee-APR style metrics need staked split.
- `CLFactory` constructor enables tickSpacing→fee: **1→100, 50→500, 100→500, 200→3000, 2000→10000**; read `tickSpacings()` / `TickSpacingEnabled` logs because more may have been enabled on Base.
- Pool address = `Clones.predictDeterministicAddress(poolImplementation, keccak256(abi.encode(token0, token1, tickSpacing)), factory)` — not the v3 init-code-hash CREATE2. `NFPM.positions()` returns `int24 tickSpacing` where v3 returns `uint24 fee` (…/periphery/interfaces/INonfungiblePositionManager.sol).

**Aerodrome v2 `Pool`** (https://raw.githubusercontent.com/aerodrome-finance/contracts/main/contracts/Pool.sol , …/factories/PoolFactory.sol):
- Fee = `PoolFactory.getFee(pool, stable)` in **1/10000 units** (`stableFee = 5`, `volatileFee = 30`, `MAX_FEE = 300`, sentinel `ZERO_FEE_INDICATOR = 420` ⇒ 0%). Fee is taken on input, custom per pool (`SetCustomFee` events).
- Stable pools use `x³y + xy³ = k` with reserves normalised to 1e18 via `decimals0/1`; `getAmountOut` runs an iterative `_get_y` (≤255 Newton steps). **There is no closed-form ±1/2/5% depth for sAMM pools** — compute depth by root-finding on the on-chain `getAmountOut(amountIn, tokenIn)` view (or port `_f/_d/_get_y`). Volatile pools: `(amountIn·reserveB)/(reserveA+amountIn)`.
- Pool address = `Clones.cloneDeterministic(implementation, keccak256(abi.encodePacked(token0, token1, stable)))`; `getPool(tokenA, tokenB, bool)`, `allPoolsLength()`, `metadata()` (dec0, dec1, r0, r1, stable, t0, t1).

**Uniswap v4** (https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/interfaces/IStateView.sol , …/src/PositionManager.sol , …/src/libraries/PositionInfoLibrary.sol , https://raw.githubusercontent.com/Uniswap/v4-core/main/src/PoolManager.sol , …/libraries/Pool.sol , …/libraries/Hooks.sol , …/libraries/LPFeeLibrary.sol):
- `StateView.getSlot0(poolId) → (sqrtPriceX96, tick, protocolFee, lpFee)`, `getTickBitmap(poolId, int16 word)`, `getTickInfo(poolId, tick) → (liquidityGross, liquidityNet, feeGrowthOutside0, feeGrowthOutside1)`, `getTickLiquidity`, `getLiquidity`, `getPositionInfo(poolId, owner, tickLower, tickUpper, salt)`. **No v4 TickLens exists** — walk bitmap words (256 ticks × tickSpacing per word) and batch via Multicall3.
- POSM: `positionInfo(tokenId)` packs `200 bits poolId | 24 tickUpper | 24 tickLower | 8 hasSubscriber`; `poolKeys(bytes25)` recovers the PoolKey; `nextTokenId` starts at 1; POSM calls `poolManager.modifyLiquidity` with `salt = bytes32(tokenId)`.
- **Correction to the v4 notes above:** `IPositionManager` _does_ declare `event ModifyPosition(PoolId indexed id, address indexed sender, int24 tickLower, int24 tickUpper, int256 liquidityDelta, bytes32 salt)` ("Emitted by the position manager for each modifyLiquidity call… `sender` is the unlock locker (end user)"), emitted in `_modifyLiquidity` and `_burn`. It was added by v4-periphery PR #528 (May 2026, renamed in #546) and reached `main` via PR #476 on **2026-05-27**. The Base POSM 0x7C5f… was deployed **2025-01-21** (registry), so it will **not** emit it; the `PermissionedPositionManager` 0xC09255D86DB563cBc11C2fCf4a0C512e160111B4 (2026-09-23) presumably does. Keep attributing via `PoolManager.ModifyLiquidity` with `sender == POSM && salt == bytes32(tokenId)`. Sources: https://github.com/Uniswap/v4-periphery/pull/476 , https://github.com/Uniswap/v4-periphery/pull/528 .
- Swap sign convention confirmed from source: `amountSpecified < 0` = exact input; event amounts are the swapper's `BalanceDelta` (negative = paid in). The `emit Swap` happens inside `_swap` **before** `swap()` applies `afterSwap` hook deltas, so hook-returned deltas are not in the event. Event `fee` = `swapFee` actually used (lpFee or hook override, combined with protocol fee).
- Hook flag bits on the hook address: `BEFORE_SWAP 1<<7`, `AFTER_SWAP 1<<6`, `BEFORE_SWAP_RETURNS_DELTA 1<<3`, `AFTER_SWAP_RETURNS_DELTA 1<<2`, `ALL_HOOK_MASK (1<<14)-1`; `DYNAMIC_FEE_FLAG = 0x800000`, `OVERRIDE_FEE_FLAG = 0x400000`, `MAX_LP_FEE = 1_000_000`. Pools whose hook has `BEFORE_SWAP_RETURNS_DELTA` can price off-curve — tick-based depth is wrong for them; flag/exclude.
- Native ETH is `currency0 = 0x0000…0000` (v4-subgraph whitelists it); map to WETH for pricing.
- PoolId check values (keccak of `abi.encode(PoolKey)`, validated: ETH/USDC fee 3000/ts 60 → 0xe070797535b13431808f8fc81fdbe7b41362960ed0b55bc2b6117c49c51b7eb9 matches the Coinbase CDP docs example https://docs.cdp.coinbase.com/coinbase-for-agents/wallet-mcp/plugins/uniswap ; WETH/USDC 500/10 → 0x90333bb05c258fe0dddb2840ef66f1a05165aa7dac6815d24e807cc6ebd943a0 = v4-subgraph Base `stablecoinWrappedNativePoolId`). ETH/USDC 500/10 = 0x96d4b53a38337a5733179751781178a2613306063c511b78cd02684739288c0a (the value above is correct; existence still unverified).

### 2.4 Position / LP-owner attribution (needed for LP concentration; not covered)

- **Slipstream staked NFTs are owned by the CLGauge**, not the LP. Resolve gauge via `Voter.gauges(pool)` / `Voter.isAlive(gauge)` (0x16613524…), then `CLGauge.stakedValues(depositor)`, `stakedContains(depositor, tokenId)`, and `Deposit/Withdraw(user, tokenId, liquidityToStake)` events. `CLPool.stake()` emits nothing.
- **Aerodrome v2 LP tokens staked in `Gauge`** (`stakingToken() == pool`): `Gauge.balanceOf(account)`, `totalSupply()`, `Deposit(from, to, amount)` / `Withdraw(from, amount)`. Pool LP `Transfer` to the gauge address must be reattributed.
- **ALM wrappers** hold Slipstream NFTs on behalf of many users (ALMCore 0x0000000cE42D4981513060aB7E50B9e5e2D19AF1 / 0xd17613D9…, ALM factories 0x5B1b1aaC…, 0xE46EC969…) — the indexer config lists `ALMLPWrapper` Deposit/Withdraw/Transfer; `LpSugar.Lp.alm` / `Position.alm` expose it. Without this, "top LP = ALM contract".
- **v4 non-POSM liquidity**: positions are keyed `(sender, tickLower, tickUpper, salt)`; hooks and vaults (e.g. Arrakis hook factory 0xeF129a430032C8183abA158C1a70799e3b840dF9 from block 28450225, v4-subgraph networks.json) add liquidity directly. Index every `ModifyLiquidity` by `sender`, not just POSM.
- **Bulk readers available on Base** (sugar base.env): `LpSugar` 0x69dD9db6d8f8E7d83887A704f447b1a584b599A1 (`all(limit, offset, filter)`, `byAddress`, `positions(limit, offset, account)`, `positionsByFactory`, `positionsUnstakedConcentrated`; `MAX_LPS 500`, `MAX_POSITIONS 200`; `Lp` struct has `liquidity, type(tickSpacing), tick, sqrt_ratio, reserve0/1, staked0/1, gauge, pool_fee, unstaked_fee, nfpm, alm`), `RewardsSugar` 0x1b121EfD…, `SLIPSTREAM_HELPER` 0x9c62ab10577fB3C20A22E231b7703Ed6D456CC7a, `SugarHelper` 0x0AD09A66… (`getAmountsForLiquidity`, `principal`, `fees`, `poolFees`, `getPopulatedTicks`). https://raw.githubusercontent.com/velodrome-finance/sugar/main/contracts/LpSugar.vy

### 2.5 USD pricing (nothing in the pack)

Chainlink Base-mainnet proxies — from a third-party snapshot (kukapay `feeds.json`, 52 Base feeds); ETH/USD independently corroborated by a search snippet of https://data.chain.link/feeds/base/base/eth-usd ("0x7104…Bb70", 0.15% deviation). Verify `description()`/`decimals()` on first run:

| Pair                 | Proxy                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------- |
| ETH/USD              | 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70                                              |
| USDC/USD             | 0x7e860098F58bBFC8648a4311b374B1D669a2bc6B                                              |
| USDT/USD             | 0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9                                              |
| DAI/USD              | 0x591e79239a7d679378eC8c847e5038150364C78F                                              |
| BTC/USD              | 0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F                                              |
| cbETH/USD, cbETH/ETH | 0xd7818272B9e248357d13057AAb0B417aF31E817d , 0x806b4Ac04501c29769051e42783cF04dCE41440b |
| wstETH/ETH           | 0x43a5C292A453A3bF3606fa856197f09D7B74251a                                              |
| AERO/USD             | 0x4EC5970fC728C5f65ba413992CD5fF6FD70fcfF0                                              |
| EURC/USD             | 0xDAe398520e2B67cd3f27aeF9Cf14D93D927f8250                                              |
| DEGEN/USD            | 0xE62BcE5D7CB9d16AB8b4D622538bc0A50A5799c2                                              |

Source: https://raw.githubusercontent.com/kukapay/chainlink-feeds-mcp/main/feeds.json . **Missing from that snapshot: cbBTC/USD, VIRTUAL/USD, BRETT/USD, wstETH/USD, USDbC/USD** — see unresolved. Fallbacks: Pyth on Base 0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a (Base docs snippet https://docs.base.org/chain/oracles and Pyth docs source https://raw.githubusercontent.com/pyth-network/documentation/main/pages/price-feeds/core/contract-addresses/evm.mdx ; Hermes now requires an API key after the 2026-07-31 Core upgrade); Aerodrome's own `price_oracle_contract_addr` 0xfbC91Fc9C6E70Afbea84b69FB0bF5EBa7F90aaFd (sugar-sdk); or derive from the WETH/USDC v3 pool + ETH/USD feed.

### 2.6 Chain / RPC facts

- docs.base.org: public endpoints are rate-limited, **HTTP only (no WS)**, and `eth_getLogs` should keep `toBlock − fromBlock` **< 2,000 blocks**; `fromBlock=toBlock="pending"` returns Flashblocks (~200 ms) pre-confirmations. (search snippets of https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_getLogs and https://docs.base.org/base-chain/api-reference/rpc-overview ; the page itself is unverified). Liquidity-persistence (historical `slot0`/`ticks` at past blocks) needs an **archive** provider.
- Uniswap v3 fee tier 100 / tickSpacing 1 **is enabled** on Base: USDC/USDbC 0.01% pool 0x06959273E9A65433De71F5A452D529544E07dDD0 exists (https://dexpaprika.com/base/pool/0x06959273e9a65433de71f5a452d529544e07ddd0 , https://defillama.com/yields/pool/169d2475-30aa-427c-baa8-dbc249732c95).
- New Uniswap Base contracts since the pack: `MixedRouteQuoterV2` 0x94a7d36e2AE728d6A2B2ee533b0a260385596D8b (2026-10-16), `PermissionedHooks` 0x5750be78fedfb2fa48faa6c6623400ba4538a8c0, `ReservesLens` 0x0000001b173C3bbF3984D417d8614E3eed34865B (registry). Only relevant if you quote through them.

### 2.7 On-chain checks (2026-10-25)

Read from Base mainnet through Alchemy's endpoint at block 53,056,381 (Multicall3 `eth_call` and
`eth_getCode`) while building seeded discovery (`depthwatch discover --seed`); the contracts
themselves are the source.
- UniswapV3Factory `feeAmountTickSpacing`: 100 → 1, 200 → 4, 300 → 6, 400 → 8, 500 → 10,
  3000 → 60, 10000 → 200; 2500 → 0 (not enabled). Seeded discovery asks the seven enabled tiers.
- Slipstream `CLFactory.tickSpacings()`: initial (0x5e7b…) `[1, 50, 100, 200, 2000, 10]`,
  gauge-caps (0xade6…) `[1, 50, 100, 200, 2000, 10, 500]`, gauges-v3 (0xf8f2…)
  `[1, 50, 100, 200, 2000, 500, 10, 80, 150]` (the first half of item 6 below).
- Uniswap v4: StateView (0xa3c0…) has no code at block 25,350,988, the `startBlock` in
  `addresses.ts`, where the PoolManager has code, so StateView was deployed later.
  `PoolManager.extsload(keccak256(abi.encodePacked(poolId, uint256(6))))` for the ETH/USDC 500/10
  PoolId 0x96d4b53a… returns a slot0 word whose low 160 bits equal StateView `getSlot0`'s
  sqrtPriceX96 (3849834864091013526660869), with lpFee 500 at offset 208: the pool exists and is
  initialized (item 4 below), and the storage layout above holds.
- Creation blocks found by the seed's binary search over `eth_getCode` / PoolManager slot0
  (seed block 53,056,975) and confirmed by the creation log in a 10-block `eth_getLogs` window:
  Uniswap v3 WETH/USDC 500 (0xd0b53d…) 3,620,407, the creation date the uniswap-v3 section left
  unconfirmed (about 2023-09-06 counting 2 s blocks back from the head, as dexpaprika says);
  Aerodrome v2 WETH/USDC (0xcdac0d…) 3,647,441; Slipstream WETH/cbBTC tickSpacing 200
  (0x04cb59…) 39,733,898; Uniswap v4 ETH/USDC 500/10 (0x96d4b53a…) 25,384,555.

### 2.8 On-chain verification of every `addresses.ts` entry (2026-10-25)

Every address in `packages/chain/src/addresses.ts` (including the non-default
`SLIPSTREAM_DEPRECATED_EARLY_DEPLOYMENT`; the Aero entries added on 2026-10-28 are in §2.9) was
read on Base mainnet through Alchemy's endpoint at
block **53,061,932** (read-only `eth_getCode` and `eth_call`, about 560 requests). Each contract has
code (`eth_getCode` ≠ `0x`) and answers one view that only that contract answers that way. No
address was changed. "Verified on-chain" below means: code present and the check holds at that
block.

| `addresses.ts` entry                                     | address       | on-chain check (block 53,061,932)                                                                                                                              | verdict                             |
| -------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `multicall3`                                             | `0xca11…ca11` | `getBlockNumber()` = 53,061,932, `getChainId()` = 8453                                                                                                         | verified on-chain                   |
| `TOKENS.WETH` (`wrappedNative`)                          | `0x4200…0006` | `symbol()` WETH, `decimals()` 18                                                                                                                               | verified on-chain                   |
| `TOKENS.USDC`                                            | `0x8335…2913` | USDC, 6                                                                                                                                                        | verified on-chain                   |
| `TOKENS.USDBC`                                           | `0xd9aa…b6ca` | USDbC, 6                                                                                                                                                       | verified on-chain                   |
| `TOKENS.CBBTC`                                           | `0xcbb7…33bf` | cbBTC, 8                                                                                                                                                       | verified on-chain                   |
| `TOKENS.CBETH`                                           | `0x2ae3…ec22` | cbETH, 18                                                                                                                                                      | verified on-chain                   |
| `TOKENS.WSTETH`                                          | `0xc1cb…e452` | wstETH, 18                                                                                                                                                     | verified on-chain                   |
| `TOKENS.DAI`                                             | `0x50c5…b0cb` | DAI, 18                                                                                                                                                        | verified on-chain                   |
| `TOKENS.USDT`                                            | `0xfde4…9bb2` | USDT, 6 (`name()` "Tether USD", now the `addresses.ts` name; the bridged status is recorded only in the `addresses.ts` comment)                                | verified on-chain                   |
| `TOKENS.EURC`                                            | `0x60a3…db42` | EURC, 6                                                                                                                                                        | verified on-chain                   |
| `TOKENS.AERO` (now `TOKENS.AERO_AERODROME`)              | `0x9401…8631` | AERO, 18 (`name()` "Aerodrome", now the `addresses.ts` name; it was "Aerodrome Finance")                                                                       | verified on-chain                   |
| `TOKENS.DEGEN`                                           | `0x4ed4…efed` | DEGEN, 18                                                                                                                                                      | verified on-chain                   |
| `TOKENS.VIRTUAL`                                         | `0x0b3e…7e1b` | VIRTUAL, 18 (`name()` "Virtual Protocol", now the `addresses.ts` name; it was "Virtuals Protocol")                                                             | verified on-chain                   |
| `TOKENS.BRETT`                                           | `0x532f…42e4` | BRETT, 18                                                                                                                                                      | verified on-chain                   |
| `uniswapV3.factory`                                      | `0x3312…fdfd` | `feeAmountTickSpacing(500)` = 10                                                                                                                               | verified on-chain                   |
| `uniswapV3.positionManager`                              | `0x03a5…34f1` | `name()` "Uniswap V3 Positions NFT-V1", `symbol()` UNI-V3-POS, `factory()` = the v3 factory, `WETH9()` = WETH                                                  | verified on-chain                   |
| `uniswapV3.tickLens`                                     | `0x0cde…ac6d` | `getPopulatedTicksInWord(0xd0b53d… WETH/USDC 500, -78)` = 256 ticks; tick -197130 liquidityNet equals the pool's own `ticks(-197130)`                          | verified on-chain                   |
| `uniswapV3.quoterV2`                                     | `0x3d4e…b76a` | `factory()` = the v3 factory; `quoteExactInputSingle` 0.001 WETH → USDC, fee 500 = 2.343436 USDC, the pool's slot0 price less the 0.05 % fee                   | verified on-chain                   |
| `uniswapV4.poolManager`                                  | `0x4985…2b2b` | `extsload` of the slot0 word of ETH/USDC 500/10 (PoolId 0x96d4b53a…, found by `discover --seed`): sqrtPriceX96 ≠ 0, lpFee 500                                  | verified on-chain                   |
| `uniswapV4.stateView`                                    | `0xa3c0…7a71` | `poolManager()` = the PoolManager; `getSlot0(0x96d4b53a…)` sqrtPriceX96 equals the `extsload` word                                                             | verified on-chain                   |
| `uniswapV4.positionManager`                              | `0x7c5f…9bdc` | `name()` "Uniswap v4 Positions NFT", `symbol()` UNI-V4-POSM, `poolManager()` = the PoolManager                                                                 | verified on-chain                   |
| `uniswapV4.quoter`                                       | `0xe1a6…ca47` | `poolManager()` = the PoolManager; `quoteExactInputSingle` 0.001 ETH → USDC on ETH/USDC 500/10 = 2.342965 USDC (0.013 % from slot0 − fee)                      | verified on-chain                   |
| `aerodromeV2.poolFactory`                                | `0x420d…40da` | `allPoolsLength()` = 29,832; `getPool(WETH, USDC, false)` = 0xcdac0d…, whose `factory()` points back                                                           | verified on-chain                   |
| `aerodromeV2.router`                                     | `0xcf77…4e43` | `defaultFactory()` = the PoolFactory, `weth()` = WETH; `getAmountsOut` 0.001 WETH → USDC (volatile) = 2.334827 USDC                                            | verified on-chain                   |
| `aerodromeV2.voter`                                      | `0x1661…80a5` | `factoryRegistry()` = 0x5c3f18f0… (`aerodrome_factory_registry` above); `gauges(0xcdac0d…)` = 0x519bbd1d…, `poolForGauge` and the gauge's `voter()` point back | verified on-chain; state flag below |
| `aerodromeSlipstream[initial].factory`                   | `0x5e7b…809a` | `allPoolsLength()` = 3,663; `getPool(WETH, USDC, 100)` = 0xb2cc224c…, whose `factory()` points back                                                            | verified on-chain                   |
| `aerodromeSlipstream[initial].positionManager`           | `0x8279…5b72` | `name()` "Slipstream Position NFT v1", `symbol()` AERO-CL-POS, `factory()` = 0x5e7b… (its paired factory)                                                      | verified on-chain                   |
| `aerodromeSlipstream[gauge-caps].factory`                | `0xade6…716a` | `allPoolsLength()` = 2,271; `allPools(2270)` = 0x300bb6ca…, whose `factory()` points back                                                                      | verified on-chain                   |
| `aerodromeSlipstream[gauge-caps].positionManager`        | `0xa990…d55f` | same name/symbol, `factory()` = 0xade6… (its paired factory)                                                                                                   | verified on-chain                   |
| `aerodromeSlipstream[gauges-v3].factory`                 | `0xf8f2…61ef` | `allPoolsLength()` = 4,870; `allPools(4869)` = 0xfa93d386…, whose `factory()` points back                                                                      | verified on-chain                   |
| `aerodromeSlipstream[gauges-v3].positionManager`         | `0xe1f8…8b53` | same name/symbol, `factory()` = 0xf8f2… (its paired factory)                                                                                                   | verified on-chain                   |
| `SLIPSTREAM_DEPRECATED_EARLY_DEPLOYMENT.factory`         | `0x9592…d51b` | `allPoolsLength()` = 22; `getPool(WETH, USDC, 100)` = 0xc90586d1…, whose `factory()` points back                                                               | verified on-chain                   |
| `SLIPSTREAM_DEPRECATED_EARLY_DEPLOYMENT.positionManager` | `0xc741…1178` | same name/symbol, `factory()` = 0x9592… : the pairing holds (`addresses.ts` now records it as confirmed)                                                       | verified on-chain                   |

`NATIVE_ETH` (`address(0)`) is the native-ETH sentinel of v4 PoolKeys, not a contract, and was not
checked. Every `symbol()` and `decimals()` matches `addresses.ts`. Three display names differed
from the token's own `name()` (USDT, AERO, VIRTUAL; not address problems); `addresses.ts` now uses
each token's `name()` (USDT's re-read on 2026-10-25: "Tether USD"), pinned by `addresses.test.ts`.

Deploy blocks (first block with code, binary search over archive `eth_getCode`) against the
`startBlock` each log scan starts from:

| contract                        | deploy block | `startBlock` in `addresses.ts` | result                                                                                                       |
| ------------------------------- | ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| UniswapV3Factory                | 1,371,680    | 1,371,680                      | equal (answers item 3 below)                                                                                 |
| v4 PoolManager                  | 25,350,988   | 25,350,988                     | equal                                                                                                        |
| v4 StateView                    | 25,350,997   | (25,350,988)                   | 9 blocks after the PoolManager; seeding reads it at the head only                                            |
| Aerodrome PoolFactory           | 3,200,559    | 3,200,559                      | equal                                                                                                        |
| Slipstream initial CLFactory    | 13,843,704   | 13,843,704                     | equal                                                                                                        |
| Slipstream gauge-caps CLFactory | 36,953,918   | 36,953,918                     | equal                                                                                                        |
| Slipstream gauges-v3 CLFactory  | 44,394,724   | 44,394,724                     | equal                                                                                                        |
| Slipstream deprecated-early     | 13,527,358   | 13,592,962                     | later than the deploy, but equal to the creation block of `allPools(0)` (0x41cdc450…), so no pool is skipped |

Deprecated-early factory liquidity (second half of item 6 below): of its 22 pools, two have
in-range liquidity at block 53,062,061 (WETH/BRETT 0xec4e900b… and WETH/0xac1bd2… 0xbfd9f3b7…);
the other 20 have `liquidity()` = 0.

**Flag: Aerodrome Voter state.** The Voter at `0x1661…80a5` is Aerodrome's (the checks above), but
at the head `isAlive` is false for the gauges of WETH/USDC v2 volatile (0x519bbd1d…) and of
Slipstream WETH/USDC 100 (0xf33a96b5…), and `isWhitelistedToken` is false for WETH, USDC and AERO;
all of these were true at blocks 20,000,000, 30,000,000 and 40,000,000. Binary search over archive
state: the WETH/USDC v2 gauge was killed at block 52,918,274 (2026-10-21T23:38:15Z) and WETH
de-whitelisted at 52,918,349 (2026-10-21T23:40:45Z). The killed gauge still holds staked LP
(`totalSupply` 32,254,554,226,826,442) and `rewardRate` is non-zero. Whether Aerodrome moved
gauges or voting to another contract was not looked up. Depthwatch only
reads `gauges(pool)` to attribute gauge-staked LP, which still answers; gauges created by any
successor contract would not be seen. To be resolved against Aerodrome's sources.
Resolved on 2026-10-28: Aerodrome became Aero on 2026-10-21, and the gauges moved to Aero's
contracts (`## aero`, §2.9). The Voter's emergency council killed 950 gauges in four batches at
blocks 52,918,274–52,918,331, and at 52,918,920 `emergencyCouncil()` became Aero's
AerodromeMigration contract; all 2,013 Aerodrome gauges now read `isAlive` false.

Quoter cross-checks at block 53,063,332 (the live run's second snapshot), $10k and $100k each way:
Uniswap QuoterV2 on WETH/USDC 500, the `slipstream_quoter_v2` above (0x254c…15b0, not in
`addresses.ts`) on Slipstream WETH/USDC tickSpacing 100 (0xb2cc224c…), and the Aerodrome v2 pools'
own `getAmountOut` (WETH/USDC volatile, USDC/USDT stable 0x96508ae8…) return exactly the average
prices Depthwatch stored. The V4Quoter on ETH/cbBTC 500/10 (PoolId 0x2fbe93bf…) differs by 0.0125 %
per leg: `StateView.getSlot0` reports a **protocol fee** of 125 pips per direction on that pool, and
every one of the 82 tracked v4 pools carries one: 25 / 125 / 500 / 1,000 pips on the 100 / 500 /
3,000 / 10,000 tiers (a quarter of the LP fee on the two lowest tiers, a sixth and a tenth on the
others). The v4 swap fee combines the protocol fee with the
LP fee (`calculateSwapFee`, Uniswap v4 section above). Follow-up: the v4 adapter now carries
slot0's `protocolFee` per direction into the pool state and the swap walk charges
`protocolFee + lpFee − ⌊protocolFee · lpFee / 1e6⌋` (625 pips for 500 + 125, 3,499 for 3,000 +
500; core `swap/protocolFee.ts`, docs/METRICS.md Conventions); the cross-check above predates it.

### 2.9 On-chain verification of the Aero entries (2026-10-28)

The Aero entries of `addresses.ts` (`## aero` above) were read on Base mainnet through Alchemy's
endpoint at blocks 53,211,601–53,213,030 (read-only `eth_call`, `eth_getCode` and 10-block
`eth_getLogs`, about 2,500 compute units). Each has code and answers views that only that
contract answers that way; every link below was read in both directions where both ends have a
view.

| `addresses.ts` entry                   | address       | on-chain check                                                                                                                                                          | verdict           |
| -------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `TOKENS.AERO`                          | `0x3f5b…a4ee` | `name()` 'Aero', `symbol()` 'AERO', 18 decimals (53,211,732); `MINTER()`, `VOTING_ESCROW()`, `MIGRATION()` as in `## aero`; root Voter `TOKEN()` returns it             | verified on-chain |
| `TOKENS.AERO_AERODROME`                | `0x9401…8631` | `name()` 'Aerodrome', `symbol()` 'AERO' (53,211,601); the entry `TOKENS.AERO` had until 2026-10-28 (§2.8)                                                               | verified on-chain |
| `aeroV2.volatileFactory`               | `0x8e6a…76d2` | `allPoolsLength()` 279, all 279 pools 'V2_VOLATILE' with `factory()` pointing back (53,211,635); `getPool(WETH, USDC)` 0x800eb395…, whose `factory()` points back       | verified on-chain |
| `aeroV2.stableFactory`                 | `0x7858…ef2d` | `allPoolsLength()` 21, all 21 pools 'V2_STABLE' with `factory()` pointing back; `getPool(WETH, USDC)` 0x4b0fa525…                                                       | verified on-chain |
| `aeroV2.volatileFeeModule`             | `0x7949…7a7a` | the volatile factory's `feeModule()` at 53,211,601 and 53,213,030                                                                                                       | verified on-chain |
| `aeroV2.stableFeeModule`               | `0x0195…3da6` | the stable factory's `feeModule()` at the same blocks                                                                                                                   | verified on-chain |
| `aeroV2.factoryRegistry`               | `0x7b2a…8f3e` | `targetFactories()` = the three factories; `factoryRegistry()` of each factory returns it; `targetToGauge(0x800eb395…)` 0x1d12ef78…, whose `stakingToken()` is the pool | verified on-chain |
| `aeroSlipstream[aero].factory`         | `0x9cb2…7a76` | `allPoolsLength()` 489; `getPool(WETH, USDC, 50)` 0x4a7af46b…, whose `factory()` points back; `allPools(488)` 0x3055c021… points back                                   | verified on-chain |
| `aeroSlipstream[aero].positionManager` | `0x4857…c60b` | `name()` 'Slipstream V3 Deposit', `symbol()` 'AERO-CL', `factory()` = the CLFactory; `CLFactory.positionManager()` returns it                                           | verified on-chain |
| `aeroSlipstream[aero].swapHook`        | `0xc0ed…e434` | `CLFactory.defaultSwapHook()` and `getPoolSwapHook` of all 489 pools return it; `FACTORY()` = the CLFactory                                                             | verified on-chain |

Start blocks (first block with code, binary search over archive `eth_getCode`) and the first
pools:

| contract                 | first code | first `PoolCreated`                                                   | `startBlock` in `addresses.ts`    |
| ------------------------ | ---------- | --------------------------------------------------------------------- | --------------------------------- |
| Aero VolatilePoolFactory | 52,880,042 | 52,884,700 (tx 0x8ef28798…: AERO (Aero)/USDC → 0xf634058d…, length 1) | `aeroV2.startBlock` 52,880,042    |
| Aero StablePoolFactory   | 52,880,046 | 52,886,973 (13 pools; the first WETH/msETH 0x45adce4b…)               | (covered by `aeroV2.startBlock`)  |
| Aero CLFactory           | 52,881,649 | 52,885,483                                                            | `aeroSlipstream[aero].startBlock` |

Event topics, computed with keccak256 and seen on chain: v2 `PoolCreated(address,address,address,uint256)`
0xebbbe9dc3a19d2f959ac76ac0372b4983cdfb945f5d6aef4873c36fabb2ba8aa (the factories' creation
logs; Aerodrome's is 0x2128d88d…); CL `PoolCreated` 0xab0d57f0… (unchanged from Slipstream); NFPM
`IncreaseLiquidity(uint256,uint128,uint256,uint256,int24,int24)`
0x0f8712c47eb813e705bf827a60bdd551e6f2e055b4a1c2004304d52208a5a513 (in the NFPM's runtime code,
which does not hold the 4-field 0x3067048b…); `DecreaseLiquidity` 0x26f6a048… unchanged. Swaps
of Aero v2 pools decode as Aerodrome v2's `Swap` (0xb3e27736…) and swaps of Aero CL pools as
Uniswap v3's (0xc42079f9…): 279 and 9,187 decoded swaps in sampled windows after the launch.

ABI facts read on chain: an Aero v2 pool's `metadata()` has 6 outputs and `stable()` reverts
(0x800eb395…, 53,211,635–53,211,794); the factories' `stableFee()`, `volatileFee()` and
3-argument `getPool` revert; the CLFactory's `getSwapFee` and `swapFeeModule` revert; the LeafVoter's
`gauges(pool)`, `isAlive`, `poolForGauge` and `isRegistered` revert (53,211,746). A volatile pool's
`getAmountOut(1e18, WETH)` on 0x800eb395… at 53,211,732 is 2,351,367,683, exactly x·y = k with
30 bps taken from the input.

v2 fees at 53,211,635 (`customFee(pool)` of the module and the factory's fee for each pool):
volatile, 223 pools at the default 30 bps and 56 overrides (44 × 100, 3 × 80, 2 × 70, 3 × 1, and
one each of 5, 25, 28 and 60); stable, 14 at the default 5 bps and 7 overrides (5 × 30, 1 × 1,
1 × 4). The factory's fee equals the override, or the default where the module has none.

Swap hook census at 53,213,030 (every pool of the CLFactory): `getPoolSwapHook` 0xc0ed888a… for
489 of 489; `dynamicFeeConfig` decodes for all 489, `initialFeeEnabled` false for all; the
hook's `defaultFeeCap()` 50,000 pips, `defaultScalingFactor()` 0, `secondsAgo()` 600. `fee()`
over the 489 pools: minimum 5, median 1,965, 90th percentile 10,000, maximum 25,000 pips; one
pool at its own cap. WETH/USDC tick spacing 50 (0x4a7af46b…, config baseFee 225, feeCap 5,000,
scalingFactor 30,000,000) read `fee()` 2,055 at 53,211,635, 645 at 53,211,732, 765 at 53,211,794
and 465 at 53,213,030: the fee is a reading of the block, not a tier. Its gauge 0x46a9dca7… held
511 of the NFPM's tokens at 53,211,659.

### 2.10 On-chain verification of the trade routes (2026-11-03)

The routers and quoters of `## trade`, read through `https://mainnet.base.org` (public, no key) at
block **53,467,794** (2026-11-03T16:55:35Z): `eth_getCode`, then the views through Multicall3, then
one `eth_call` quote of 0.001 WETH → USDC per quoter on a WETH/USDC pool the venue's factory
returns from `getPool` (about 30 requests in all). WETH9 is 0x4200…0006 everywhere.

| `TRADE_ROUTES` entry              | address       | on-chain check (block 53,467,794)                                                                     | verdict           |
| --------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- | ----------------- |
| `uniswap-v3` router               | `0x2626…e481` | 24,497 bytes; `factory()` 0x3312…fdfd (`uniswapV3.factory`); `WETH9()` WETH                           | verified on-chain |
| `uniswap-v3` quoter               | `0x3d4e…b76a` | 8,273 bytes; `factory()` 0x3312…fdfd; `WETH9()` WETH; quote 2.293248 USDC (pool 0xd0b5…f224, fee 500) | verified on-chain |
| `aerodrome-slipstream` initial    | `0xbe6d…18a5` | 9,908 bytes; `factory()` 0x5e7b…809a; `WETH9()` WETH                                                  | verified on-chain |
| quoter                            | `0x254c…15b0` | 6,934 bytes; `factory()` 0x5e7b…809a; `WETH9()` WETH; quote 2.293781 USDC (0xb2cc…dc59, spacing 100)  | verified on-chain |
| `aerodrome-slipstream` gauge-caps | `0xcbbb…ce0d` | 9,908 bytes; `factory()` 0xade6…716a; `WETH9()` WETH                                                  | verified on-chain |
| quoter                            | `0x3d4c…1c6c` | 6,934 bytes; `factory()` 0xade6…716a; `WETH9()` WETH; quote 2.294111 USDC (0xc758…54e0, spacing 50)   | verified on-chain |
| `aerodrome-slipstream` gauges-v3  | `0x698c…a92f` | 9,908 bytes; `factory()` 0xf8f2…61ef; `WETH9()` WETH                                                  | verified on-chain |
| quoter                            | `0x514c…9259` | 6,934 bytes; `factory()` 0xf8f2…61ef; `WETH9()` WETH; quote 2.293505 USDC (0x3fe0…392a, spacing 50)   | verified on-chain |
| `aero-slipstream` router          | `0x9ee3…d418` | 10,060 bytes; `factory()` 0x9cb2…7a76 (`aeroSlipstream[aero].factory`); `WETH9()` WETH                | on chain; held    |
| Metaquoter                        | `0x1ddf…7868` | 15,299 bytes; `factoryRegistry()` 0x7b2a…8f3e; `factory()` reverts; quote 2.292127 USDC (0x2a43…bc24) | on chain; held    |

Each quote pool's `token0()` is WETH, `token1()` USDC and `factory()` the route's factory; the
five quotes lie within 0.09 % of one another. `fee()` at the block: 500, 150, 175, 375 and 818 pips.

At block 53,468,151 every selector of `abi/trade.ts` appears as a PUSH4 in the runtime code of the
contracts it is used with: SwapRouter02 `exactInputSingle` 0x04e45aaf, `multicall(uint256,bytes[])`
0x5ae401dc; QuoterV2 `quoteExactInputSingle` 0xc6a5026a; the four Slipstream routers
`exactInputSingle` 0xa026383e, `multicall(bytes[])` 0xac9650d8; the three Slipstream quoters
`quoteExactInputSingle` 0x9e7defe6; the Metaquoter `quoteExactInputSingleV3` 0x0a674142,
`factoryRegistry()` 0x3bf0c9fb; and on every router `unwrapWETH9(uint256,address)` 0x49404b7c,
`factory()` 0xc45a0155, `WETH9()` 0x4aa4a4fc (`addresses.trade.test.ts` pins them). At block
53,471,577 (2026-11-03T19:01:41Z) SwapRouter02's runtime code (24,497 bytes, one `eth_getCode`
through `https://mainnet.base.org`) also holds `refundETH()` 0x12210e8a as a PUSH4.

### 2.11 Token checks for the trade allowlist (2026-11-03)

Every reference token of `addresses.ts` was read through `https://mainnet.base.org` at block
**53,467,830** (2026-11-03T16:56:47Z), about 100 requests:
- `decimals()`, `symbol()`, `name()`; the EIP-1967 implementation, admin and beacon slots and the
  `org.zeppelinos.proxy.implementation` slot (Circle's proxies); identity views (`version()`,
  `remoteToken()`, `bridge()`, `owner()`, `paused()`).
- A scan of the runtime code (the implementation's, for a proxy) for the PUSH4 selectors of 38
  rebasing, transfer-fee and freeze functions (`rebase`, `sharesOf`, `scaledBalanceOf`,
  `isExcludedFromFee`, `taxFee`, `basisPointsRate`, `isBlacklisted`, `pause`, …). A heuristic: it
  finds only the names it knows.
- An `eth_simulateV1` transfer of 0.1 % of the largest WETH- or USDC-pool balance of the token
  (Uniswap v3, Aerodrome v2 and Slipstream, Aero CL) from that pool to an empty address, then of
  half of it back to the pool: the balances of both sides must move by exactly the amount and the
  only log must be one `Transfer` of that amount. A fee-on-transfer token taxes exactly these
  pool ↔ account transfers.
- The verified source of each address and implementation on Sourcify
  (`https://sourcify.dev/server/v2/contract/8453/<address>`), and for DEGEN, VIRTUAL, BRETT and
  Aero's AERO the source itself.

| token (`TOKENS.`) | decimals | contract (Sourcify)                                          | proxy                                   | transfer test | swap list |
| ----------------- | -------- | ------------------------------------------------------------ | --------------------------------------- | ------------- | --------- |
| `WETH`            | 18       | WETH9 (match)                                                | no                                      | exact         | allowed   |
| `USDC`            | 6        | FiatTokenProxy → FiatTokenV2_2 0x2ce6…d779 (exact match)     | zeppelinos slot; pausable, blacklist    | exact         | allowed   |
| `USDBC`           | 6        | Proxy → UpgradeableOptimismMintableERC20 0x1833…b463 (match) | EIP-1967, admin 0xd94e…f94f             | exact         | allowed   |
| `CBBTC`           | 8        | FiatTokenProxy → FiatTokenV2_1 0x7458…aa72 (exact match)     | zeppelinos slot; pausable, blacklist    | exact         | allowed   |
| `CBETH`           | 18       | Proxy → UpgradeableOptimismMintableERC20 0x07a7…4e1f (match) | EIP-1967, admin 0xd94e…f94f             | exact         | allowed   |
| `WSTETH`          | 18       | OssifiableProxy → ERC20Bridged 0x69ce…3309 (exact match)     | EIP-1967, admin 0x0e37…eacf             | exact         | allowed   |
| `DAI`             | 18       | OptimismMintableERC20 (match)                                | no                                      | exact         | allowed   |
| `USDT` (bridged)  | 6        | `USDT` is L2StandardERC20 (exact match)                      | no                                      | exact         | allowed   |
| `EURC`            | 6        | FiatTokenProxy → FiatTokenV2_2 0x2ce6…d779 (exact match)     | zeppelinos slot; pausable, blacklist    | exact         | allowed   |
| `AERO_AERODROME`  | 18       | Aero (match)                                                 | no                                      | exact         | held back |
| `DEGEN`           | 18       | DegenToken (exact match)                                     | no; owner can pause and mint ≤ 1 %/year | exact         | allowed   |
| `VIRTUAL`         | 18       | OptimismMintableERC20 with LayerZero OFT (exact match)       | no; `owner()` 0                         | exact         | allowed   |
| `BRETT`           | 18       | BrettToken (match)                                           | no; `owner()` 0; fee code inert (below) | exact         | allowed   |
| `AERO`            | 18       | Token, Solady ERC20 (match)                                  | no                                      | exact         | allowed   |

Every `decimals()`, `symbol()` and `name()` equals `addresses.ts`. Simulation holders (pools):
WETH and USDC 0x6c561b44…, USDbC 0x98c7a233…, cbBTC 0x7aea2e8a…, cbETH 0x03bf2066…, wstETH
0xa6385c73…, DAI 0xc18f50d6…, USDT 0x2dbe0e26…, EURC 0xe846373c…, Aerodrome's AERO 0x6cdcb1c4…,
DEGEN 0xc9034c3e…, VIRTUAL 0x792f465e…, BRETT 0xba3f9458…, AERO 0xc85d5cb7…. Notes:
- The selector scan hit only Circle's `isBlacklisted`, `blacklist`, `pause` and `paused` (USDC,
  EURC, cbBTC) and DEGEN's `pause`/`paused`. A paused or blacklisted token makes the swap revert:
  gas lost, no funds.
- Rebasing: none of the sources is a rebasing token. wstETH is Lido's wrapped, non-rebasing
  token (not stETH); cbETH on Base is a standard-bridge token whose balances change only by
  transfer, mint and burn (`remoteToken()` is L1 cbETH 0xbe989514…); bridged USDT has no
  `basisPointsRate` fee code (unlike Ethereum's USDT; `l1Token()` 0xdac17f95…).
- BRETT's source has buy and sell fees with a swap-back, all owner-set: at block 53,467,875
  `buyTotalFees()` and `sellTotalFees()` are 0, `limited()` false, `maxTransaction()` and
  `maxWallet()` the whole supply and `owner()` address(0), so the `onlyOwner` setters can no
  longer run; the swap-back returns early while its fee counters are 0, and the simulation logged
  a single `Transfer` both ways.
- Aerodrome's AERO passes the same checks but is held back: it shares the symbol
  AERO with Aero's AERO, and Aero's `MIGRATION()` converts it one way.

Swap allowlist (`TRADE_TOKENS`, 13 tokens): WETH (native ETH trades through it), USDC, cbBTC,
cbETH, wstETH, AERO (Aero's), DAI, EURC, USDT (bridged), USDbC, DEGEN, VIRTUAL, BRETT.

Not established read-only:
- Upgrades: USDC, EURC, cbBTC, USDbC, cbETH and wstETH are proxies whose admins can replace the
  implementation; the checks hold for the implementations read at the block.
- `transferFrom` (how the routers pay a pool) was not simulated, only `transfer`; the fork test
  (docs/DEPLOY.md, "Before switching on") asserts the balance difference of real swaps.
- Rebasing over time was not measured (no balance was compared across blocks); the conclusion
  rests on the verified sources.

## 3. Still unresolved (do not guess; resolve at first run)

1. Chainlink proxies for **cbBTC/USD, VIRTUAL/USD, BRETT/USD, wstETH/USD, USDbC/USD** on Base (docs.chain.link, data.chain.link and reference-data-directory are unverified; the kukapay snapshot predates cbBTC). Verify the whole table on-chain via `description()`.
2. Pyth "Upgraded Address" for Base after the 2026-07-31 Core upgrade — the docs source shows only 0x8250f4aF… for Base (likely in the "Not upgraded" group); confirm on docs.pyth.network.
3. Exact creation block of the Uniswap v3 Factory (1371680 is a third-party sync start, consistent with the 2023-07-16 deploy date) — confirm from the contract-creation tx. Answered on chain in 2.8: the factory's first block with code is 1,371,680, equal to the `startBlock`.
4. Existence/liquidity of v4 ETH/USDC 500/10 (0x96d4b53a…88c0a) — compute is right, but no explorer/aggregator hit; discover pools from `Initialize` logs instead of seeding. Answered on chain in 2.7: it is initialized.
5. Identity of CL gauge factory 0x3e703fd2… (DefiLlama only): still unverified. NFPM 0xc741beb2… is resolved: on chain in 2.8 its `factory()` is the deprecated CLFactory 0x9592…, the pairing `addresses.ts` records.
6. Which Slipstream tick spacings beyond the constructor's five are enabled on each of the three factories (read `tickSpacings()`; answered in 2.7), and whether the deprecated factory 0x9592… still has live liquidity (answered in 2.8: 2 of its 22 pools have in-range liquidity).
7. The Graph subgraph IDs for Uniswap v3/v4 and Aerodrome on Base — Uniswap states public deployments are unofficial; only a substreams package "uniswap-v4-base-3" surfaced. Not required if Depthwatch reads chain directly.
8. Slipstream `SwapRouter` 0xBE6D8f0d… remains README + Basescan-snippet only (not in deploy JSON); low importance for a read-only observatory. Answered in `## trade` and §2.10: Aerodrome's docs page lists it, and its `factory()` is the initial CLFactory.
