/**
 * Verified Base mainnet (chainId 8453) addresses. Source: docs/research/base-contracts.md (every
 * entry below carries an "independent check: confirmed" verdict there, except the Aero trade
 * route, which is held; §2.8 records the on-chain check of each, §2.9 that of the Aero entries,
 * §2.10 that of the trade routes). All lowercase. Token names are each token's own `name()`.
 */
import { type Address, type Dex, NATIVE_ETH, type TokenInfo } from '@depthwatch/core'

export interface SlipstreamDeployment {
  /** Human label (Aerodrome: from the aerodrome-finance/slipstream README). */
  name: string
  factory: Address
  /** The NonfungiblePositionManager paired with this factory (each deployment has its own). */
  positionManager: Address
  /** First block to scan `PoolCreated` from. */
  startBlock: bigint
}

/** An Aero Slipstream deployment: its pools take their fee from a swap hook, not a fee module. */
export interface AeroSlipstreamDeployment extends SlipstreamDeployment {
  /**
   * The reviewed DynamicSwapFeeHook (the factory's `defaultSwapHook()` when reviewed). A pool on
   * another hook, or with the hook's initial fee enabled, is hooked (`PoolMeta.hooks`).
   */
  swapHook: Address
}

export interface ChainAddresses {
  multicall3: Address
  /** WETH9 predeploy; native ETH (v4 currency0 == 0x0) maps here for pricing. */
  wrappedNative: Address
  uniswapV3: {
    factory: Address
    positionManager: Address
    tickLens: Address
    quoterV2: Address
    startBlock: bigint
  }
  uniswapV4: {
    poolManager: Address
    stateView: Address
    positionManager: Address
    quoter: Address
    startBlock: bigint
  }
  aerodromeV2: {
    poolFactory: Address
    router: Address
    voter: Address
    startBlock: bigint
  }
  /** Three live CLFactory deployments, each with its own NFPM. Pool ids stay `aerodrome-slipstream:<pool>`. */
  aerodromeSlipstream: SlipstreamDeployment[]
  /** Aero v2 (`aero-v2`): one factory per pool type; pool ids `aero-v2:<pool>`. */
  aeroV2: {
    /** V2_VOLATILE pools (constant product). */
    volatileFactory: Address
    /** V2_STABLE pools (x³y + xy³). */
    stableFactory: Address
    /** The CustomFeeModule the volatile factory's `feeModule()` must return to read a fee. */
    volatileFeeModule: Address
    /** The CustomFeeModule the stable factory's `feeModule()` must return to read a fee. */
    stableFeeModule: Address
    /** Pool → gauge (`targetToGauge`); not a discovery root. */
    factoryRegistry: Address
    /** First block with code of the earlier factory. */
    startBlock: bigint
  }
  /** Aero Slipstream (`aero-slipstream`) CLFactory deployments; pool ids `aero-slipstream:<pool>`. */
  aeroSlipstream: AeroSlipstreamDeployment[]
  /** Curated token list for display and sanity checks; decimals are still read on chain. */
  referenceTokens: TokenInfo[]
  /** USD anchors for `derivePrices` (USD-pegged stablecoins only). */
  stablecoinAnchors: Record<Address, number>
}

const token = (address: Address, symbol: string, name: string, decimals: number): TokenInfo => ({
  address,
  symbol,
  name,
  decimals,
})

/** Native ETH as a TokenInfo (Uniswap v4 pools with currency0 == address(0)). */
export const NATIVE_ETH_TOKEN: TokenInfo = token(NATIVE_ETH, 'ETH', 'Ether', 18)

export const TOKENS = {
  WETH: token('0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18),
  USDC: token('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', 'USD Coin', 6),
  USDBC: token('0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', 'USDbC', 'USD Base Coin', 6),
  CBBTC: token('0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', 'cbBTC', 'Coinbase Wrapped BTC', 8),
  CBETH: token(
    '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22',
    'cbETH',
    'Coinbase Wrapped Staked ETH',
    18,
  ),
  WSTETH: token(
    '0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452',
    'wstETH',
    'Wrapped liquid staked Ether 2.0',
    18,
  ),
  DAI: token('0x50c5725949a6f0c72e6c4a641f24049a917db0cb', 'DAI', 'Dai Stablecoin', 18),
  /**
   * Bridged (standard-bridge) USDT, not Tether-issued. The name is its `name()`; the bridged
   * status is recorded only here (no UI or API field marks it).
   */
  USDT: token('0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', 'USDT', 'Tether USD', 6),
  EURC: token('0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42', 'EURC', 'EURC', 6),
  /**
   * Aerodrome's AERO. It still trades; the new token's `MIGRATION()` contract converts it one way,
   * 1:1, which is no price peg. Its symbol is also "AERO": the address tells the two apart.
   */
  AERO_AERODROME: token('0x940181a94a35a4569e4529a3cdfb74e38fd98631', 'AERO', 'Aerodrome', 18),
  DEGEN: token('0x4ed4e862860bed51a9570b96d89af5e1b0efefed', 'DEGEN', 'Degen', 18),
  VIRTUAL: token('0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b', 'VIRTUAL', 'Virtual Protocol', 18),
  BRETT: token('0x532f27101965dd16442e59d40670faf5ebb142e4', 'BRETT', 'Brett', 18),
  /** Aero's AERO (2026-10-21), listed last so the older tokens keep their order. */
  AERO: token('0x3f5bf3edac59d650d8fdf9657a71f2f904a3a4ee', 'AERO', 'Aero', 18),
} as const satisfies Record<string, TokenInfo>

export const REFERENCE_TOKENS: readonly TokenInfo[] = Object.freeze([
  NATIVE_ETH_TOKEN,
  ...Object.values(TOKENS),
])

/** USD = 1 anchors. EURC is euro-pegged and deliberately excluded. */
export const STABLECOIN_ANCHORS: Readonly<Record<Address, number>> = Object.freeze({
  [TOKENS.USDC.address]: 1,
  [TOKENS.USDBC.address]: 1,
  [TOKENS.DAI.address]: 1,
  [TOKENS.USDT.address]: 1,
})

/**
 * Deprecated early Slipstream factory (Apr 2024, 22 pools). Its NFPM pairing is confirmed on chain
 * (docs/research/base-contracts.md §2.8: `NFPM.factory()` of 0xc741beb2… is this factory, 0x9592…,
 * at block 53,061,932). Not part of the defaults: two of its 22 pools had in-range liquidity there.
 * Add it to `aerodromeSlipstream` via `createChainReader({ addresses })` to index them.
 */
export const SLIPSTREAM_DEPRECATED_EARLY_DEPLOYMENT: SlipstreamDeployment = {
  name: 'deprecated-early',
  factory: '0x9592cd9b267748cbfbde90ac9f7df3c437a6d51b',
  positionManager: '0xc741beb2156827704a1466575cca1cbf726a1178',
  startBlock: 13_592_962n,
}

export const BASE_ADDRESSES: ChainAddresses = {
  multicall3: '0xca11bde05977b3631167028862be2a173976ca11',
  wrappedNative: TOKENS.WETH.address,
  uniswapV3: {
    factory: '0x33128a8fc17869897dce68ed026d694621f6fdfd',
    positionManager: '0x03a520b32c04bf3beef7beb72e919cf822ed34f1',
    tickLens: '0x0cdee061c75d43c82520ed998c23ac2991c9ac6d',
    quoterV2: '0x3d4e44eb1374240ce5f1b871ab261cd16335b76a',
    // Third-party sync start consistent with the 2023-07-16 deploy; PoolCreated scanning proves it.
    startBlock: 1_371_680n,
  },
  uniswapV4: {
    poolManager: '0x498581ff718922c3f8e6a244956af099b2652b2b',
    stateView: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
    positionManager: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
    // msgSender-capable V4Quoter (sdk-core since 7.19.5); the legacy 0x0d5e0f97… also works on plain pools.
    quoter: '0xe1a6c5803e3c44368b171bd680c7d32dfc92ca47',
    startBlock: 25_350_988n,
  },
  aerodromeV2: {
    poolFactory: '0x420dd381b31aef6683db6b902084cb0ffece40da',
    router: '0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43',
    voter: '0x16613524e02ad97edfef371bc883f2f5d6c480a5',
    startBlock: 3_200_559n,
  },
  aerodromeSlipstream: [
    {
      name: 'initial',
      factory: '0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a',
      positionManager: '0x827922686190790b37229fd06084350e74485b72',
      startBlock: 13_843_704n,
    },
    {
      name: 'gauge-caps',
      factory: '0xade65c38cd4849adba595a4323a8c7ddfe89716a',
      positionManager: '0xa990c6a764b73bf43cee5bb40339c3322fb9d55f',
      startBlock: 36_953_918n,
    },
    {
      name: 'gauges-v3',
      factory: '0xf8f2eb4940cfe7d13603dddd87f123820fc061ef',
      positionManager: '0xe1f8cd9ac4e4a65f54f38a5cdafca44f6dd68b53',
      startBlock: 44_394_724n,
    },
  ],
  aeroV2: {
    volatileFactory: '0x8e6a9fcd1d638cc760ffba397605fe3355de76d2',
    stableFactory: '0x78589e876edcebdce72ee3436ab3c9ad3a7cef2d',
    volatileFeeModule: '0x7949de8d67e4f6b8509bdbb43ff0503af1247a7a',
    stableFeeModule: '0x0195fc76da986d66b2a468133a1be41e90893da6',
    factoryRegistry: '0x7b2a2c12dc5ea2a31455952a05031c3e4bb28f3e',
    // The volatile factory's first block with code; the stable factory's is 52,880,046.
    startBlock: 52_880_042n,
  },
  aeroSlipstream: [
    {
      name: 'aero',
      factory: '0x9cb220581b91b0c83223012fe69688b92ad07a76',
      positionManager: '0x4857db576ee0e45f10525ec59527bfd10beec60b',
      swapHook: '0xc0ed888afe87ed1acf01d9f19bb850159e3ce434',
      startBlock: 52_881_649n,
    },
  ],
  referenceTokens: [...REFERENCE_TOKENS],
  stablecoinAnchors: { ...STABLECOIN_ANCHORS },
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

function normalizeAddress(value: unknown, path: string): Address {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value))
    throw new TypeError(`addresses.${path}: expected a 20-byte hex address, got ${String(value)}`)
  return value.toLowerCase() as Address
}

/**
 * Shallow merge of overrides onto the Base defaults (each top-level section replaced as a whole;
 * a section set to `undefined` keeps the default). Every address of the result is lowercased, so
 * checksummed overrides compare equal to the lowercase log/call data the adapters work with
 * (DESIGN rule 2); a malformed address throws.
 */
export function resolveAddresses(overrides?: Partial<ChainAddresses>): ChainAddresses {
  const merged: ChainAddresses = { ...BASE_ADDRESSES }
  for (const [key, value] of Object.entries(overrides ?? {}))
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[key] = value
  const at = (path: string, value: unknown) => normalizeAddress(value, path)
  return {
    multicall3: at('multicall3', merged.multicall3),
    wrappedNative: at('wrappedNative', merged.wrappedNative),
    uniswapV3: {
      ...merged.uniswapV3,
      factory: at('uniswapV3.factory', merged.uniswapV3.factory),
      positionManager: at('uniswapV3.positionManager', merged.uniswapV3.positionManager),
      tickLens: at('uniswapV3.tickLens', merged.uniswapV3.tickLens),
      quoterV2: at('uniswapV3.quoterV2', merged.uniswapV3.quoterV2),
    },
    uniswapV4: {
      ...merged.uniswapV4,
      poolManager: at('uniswapV4.poolManager', merged.uniswapV4.poolManager),
      stateView: at('uniswapV4.stateView', merged.uniswapV4.stateView),
      positionManager: at('uniswapV4.positionManager', merged.uniswapV4.positionManager),
      quoter: at('uniswapV4.quoter', merged.uniswapV4.quoter),
    },
    aerodromeV2: {
      ...merged.aerodromeV2,
      poolFactory: at('aerodromeV2.poolFactory', merged.aerodromeV2.poolFactory),
      router: at('aerodromeV2.router', merged.aerodromeV2.router),
      voter: at('aerodromeV2.voter', merged.aerodromeV2.voter),
    },
    aerodromeSlipstream: merged.aerodromeSlipstream.map((d, i) => ({
      ...d,
      factory: at(`aerodromeSlipstream[${i}].factory`, d.factory),
      positionManager: at(`aerodromeSlipstream[${i}].positionManager`, d.positionManager),
    })),
    aeroV2: {
      ...merged.aeroV2,
      volatileFactory: at('aeroV2.volatileFactory', merged.aeroV2.volatileFactory),
      stableFactory: at('aeroV2.stableFactory', merged.aeroV2.stableFactory),
      volatileFeeModule: at('aeroV2.volatileFeeModule', merged.aeroV2.volatileFeeModule),
      stableFeeModule: at('aeroV2.stableFeeModule', merged.aeroV2.stableFeeModule),
      factoryRegistry: at('aeroV2.factoryRegistry', merged.aeroV2.factoryRegistry),
    },
    aeroSlipstream: merged.aeroSlipstream.map((d, i) => ({
      ...d,
      factory: at(`aeroSlipstream[${i}].factory`, d.factory),
      positionManager: at(`aeroSlipstream[${i}].positionManager`, d.positionManager),
      swapHook: at(`aeroSlipstream[${i}].swapHook`, d.swapHook),
    })),
    referenceTokens: merged.referenceTokens.map((t, i) => ({
      ...t,
      address: at(`referenceTokens[${i}].address`, t.address),
    })),
    stablecoinAnchors: Object.fromEntries(
      Object.entries(merged.stablecoinAnchors).map(([address, usd]) => [
        at(`stablecoinAnchors[${address}]`, address),
        usd,
      ]),
    ),
  }
}

/** DEXes of the swap panel: `exactInputSingle` in one pool, in two encodings. */
export type TradeVenue = Extract<Dex, 'uniswap-v3' | 'aerodrome-slipstream' | 'aero-slipstream'>

/**
 * A router and quoter bound to one pool factory: `router.factory()` and the quoter's `factory()`
 * (the Metaquoter's `factoryRegistry()`) as read on chain (docs/research/base-contracts.md
 * `## trade`, §2.10). A swap goes to `router` only for a pool whose own `factory()` is `factory`.
 * Compiled in on purpose: `resolveAddresses` overrides never reach it, and data never supplies it.
 */
export interface TradeRoute {
  venue: TradeVenue
  /** `uniswap-v3`, or the `name` of the Slipstream deployment of `factory`. */
  deployment: string
  factory: Address
  router: Address
  quoter: Address
  /** `swap-router-02`: `multicall(deadline, [exactInputSingle])`; `slipstream`: deadline inside. */
  routerAbi: 'swap-router-02' | 'slipstream'
  quoterAbi: 'quoter-v2' | 'slipstream-quoter-v2' | 'metaquoter'
  /** Why the route must not be used, whatever the trade flags say; null once cleared. */
  hold: string | null
}

const slipstream = (name: string, router: Address, quoter: Address) =>
  Object.freeze<TradeRoute>({
    venue: 'aerodrome-slipstream',
    deployment: name,
    factory: BASE_ADDRESSES.aerodromeSlipstream.find((d) => d.name === name)!.factory,
    router,
    quoter,
    routerAbi: 'slipstream',
    quoterAbi: 'slipstream-quoter-v2',
    hold: null,
  })

/** Every route, held ones included. The deprecated Slipstream factory 0x9592… has none. */
export const TRADE_ROUTES: readonly TradeRoute[] = Object.freeze([
  Object.freeze<TradeRoute>({
    venue: 'uniswap-v3',
    deployment: 'uniswap-v3',
    factory: BASE_ADDRESSES.uniswapV3.factory,
    router: '0x2626664c2603336e57b271c5c0b26f421741e481',
    quoter: BASE_ADDRESSES.uniswapV3.quoterV2,
    routerAbi: 'swap-router-02',
    quoterAbi: 'quoter-v2',
    hold: null,
  }),
  slipstream(
    'initial',
    '0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5',
    '0x254cf9e1e6e233aa1ac962cb9b05b2cfeaae15b0',
  ),
  slipstream(
    'gauge-caps',
    '0xcbbb8035cac7d4b3ca7abb74cf7bdf900215ce0d',
    '0x3d4c22254f86f64b7ec90ab8f7aec1fbfd271c6c',
  ),
  slipstream(
    'gauges-v3',
    '0x698cb2b6dd822994581fea6ea4fc755d1363a92f',
    '0x514c8b5f54112481e28028f1166bd78501089259',
  ),
  Object.freeze<TradeRoute>({
    venue: 'aero-slipstream',
    deployment: 'aero',
    factory: BASE_ADDRESSES.aeroSlipstream[0]!.factory,
    router: '0x9ee35bf1bd69a03c6f0393582030fce8bb93d418',
    quoter: '0x1ddfec5058180c207f55bb77d95acdd0d8227868',
    routerAbi: 'slipstream',
    quoterAbi: 'metaquoter',
    hold: "Aero's contracts page not yet confirmed in a browser; CL MEV-tax threshold unverified (base-contracts.md, ## trade)",
  }),
])

/** The route for a pool of `factory` on `venue`, or undefined (no such route, or held). */
export function tradeRouteFor(venue: Dex, factory: string): TradeRoute | undefined {
  const key = factory.toLowerCase()
  return TRADE_ROUTES.find((r) => r.venue === venue && r.factory === key && r.hold === null)
}

/**
 * The swap panel's token allowlist (base-contracts.md §2.11): reference tokens whose simulated transfers
 * moved exactly the amount sent, pool → account and back, and whose verified source has no
 * rebasing and no live transfer fee. Aerodrome's AERO is left out: it shares the symbol AERO with
 * Aero's, and Aero's `MIGRATION()` converts it one way. Native ETH trades as WETH.
 */
export const TRADE_TOKENS: readonly TokenInfo[] = Object.freeze(
  [
    TOKENS.WETH,
    TOKENS.USDC,
    TOKENS.CBBTC,
    TOKENS.CBETH,
    TOKENS.WSTETH,
    TOKENS.AERO,
    TOKENS.DAI,
    TOKENS.EURC,
    TOKENS.USDT,
    TOKENS.USDBC,
    TOKENS.DEGEN,
    TOKENS.VIRTUAL,
    TOKENS.BRETT,
  ].map((t) => Object.freeze({ ...t })),
)

/** Whether `address` (any case) is on the trade allowlist. */
export function isTradeToken(address: string): boolean {
  const key = address.toLowerCase()
  return TRADE_TOKENS.some((t) => t.address === key)
}
