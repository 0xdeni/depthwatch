/**
 * The trade group of addresses.ts against docs/research/base-contracts.md (`## trade`, §2.10,
 * §2.11) and the ABIs of abi/trade.ts against the Solidity signatures of their sources.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type AbiFunction,
  decodeFunctionData,
  encodeFunctionData,
  toFunctionSelector,
  toFunctionSignature,
} from 'viem'
import { describe, expect, it } from 'vitest'
import {
  clFactoryGetPoolAbi,
  metaquoterAbi,
  quoterV2Abi,
  slipstreamQuoterV2Abi,
  slipstreamSwapRouterAbi,
  swapRouter02Abi,
  tradeErc20Abi,
  tradePoolAbi,
  uniswapV3GetPoolAbi,
} from './abi/trade.js'
import {
  BASE_ADDRESSES,
  isTradeToken,
  SLIPSTREAM_DEPRECATED_EARLY_DEPLOYMENT,
  TOKENS,
  TRADE_ROUTES,
  TRADE_TOKENS,
  tradeRouteFor,
} from './addresses.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DOC = readFileSync(join(ROOT, 'docs', 'research', 'base-contracts.md'), 'utf8').toLowerCase()
const ZERO = '0x0000000000000000000000000000000000000000'

const tradeAddresses = (): string[] => [
  ...TRADE_ROUTES.flatMap((r) => [r.factory, r.router, r.quoter]),
  ...TRADE_TOKENS.map((t) => t.address),
]

describe('trade addresses', () => {
  it('are lowercase 20-byte addresses, none of them zero', () => {
    for (const address of tradeAddresses()) {
      expect(address).toMatch(/^0x[0-9a-f]{40}$/)
      expect(address).not.toBe(ZERO)
    }
  })

  it('each appears in full in docs/research/base-contracts.md', () => {
    expect(tradeAddresses().filter((a) => !DOC.includes(a))).toEqual([])
  })

  it('bind each indexed factory of a trade venue to one router, the deprecated one to none', () => {
    const factories = TRADE_ROUTES.map((r) => `${r.venue}:${r.factory}`)
    expect(factories).toEqual([
      `uniswap-v3:${BASE_ADDRESSES.uniswapV3.factory}`,
      ...BASE_ADDRESSES.aerodromeSlipstream.map((d) => `aerodrome-slipstream:${d.factory}`),
      ...BASE_ADDRESSES.aeroSlipstream.map((d) => `aero-slipstream:${d.factory}`),
    ])
    expect(new Set(TRADE_ROUTES.map((r) => r.router)).size).toBe(TRADE_ROUTES.length)
    expect(TRADE_ROUTES.map((r) => r.factory)).not.toContain(
      SLIPSTREAM_DEPRECATED_EARLY_DEPLOYMENT.factory,
    )
    expect(TRADE_ROUTES[0]?.quoter).toBe(BASE_ADDRESSES.uniswapV3.quoterV2)
  })

  it('pins the routers and quoters read on chain (§2.10)', () => {
    expect(TRADE_ROUTES.map((r) => [r.deployment, r.router, r.quoter, r.routerAbi])).toEqual([
      [
        'uniswap-v3',
        '0x2626664c2603336e57b271c5c0b26f421741e481',
        '0x3d4e44eb1374240ce5f1b871ab261cd16335b76a',
        'swap-router-02',
      ],
      [
        'initial',
        '0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5',
        '0x254cf9e1e6e233aa1ac962cb9b05b2cfeaae15b0',
        'slipstream',
      ],
      [
        'gauge-caps',
        '0xcbbb8035cac7d4b3ca7abb74cf7bdf900215ce0d',
        '0x3d4c22254f86f64b7ec90ab8f7aec1fbfd271c6c',
        'slipstream',
      ],
      [
        'gauges-v3',
        '0x698cb2b6dd822994581fea6ea4fc755d1363a92f',
        '0x514c8b5f54112481e28028f1166bd78501089259',
        'slipstream',
      ],
      [
        'aero',
        '0x9ee35bf1bd69a03c6f0393582030fce8bb93d418',
        '0x1ddfec5058180c207f55bb77d95acdd0d8227868',
        'slipstream',
      ],
    ])
  })

  it('holds the Aero route until its contracts page is confirmed, so tradeRouteFor never returns it', () => {
    const aero = TRADE_ROUTES.find((r) => r.venue === 'aero-slipstream')!
    expect(aero.hold).toMatch(/^Aero's contracts page not yet confirmed in a browser;/)
    expect(aero.quoterAbi).toBe('metaquoter')
    expect(tradeRouteFor('aero-slipstream', aero.factory)).toBeUndefined()
    expect(TRADE_ROUTES.filter((r) => r.hold === null).map((r) => r.venue)).toEqual([
      'uniswap-v3',
      'aerodrome-slipstream',
      'aerodrome-slipstream',
      'aerodrome-slipstream',
    ])
  })

  it('finds a route by venue and factory in any case, and nothing for a mismatched pair', () => {
    const gaugeCaps = TRADE_ROUTES[2]!
    expect(tradeRouteFor('aerodrome-slipstream', gaugeCaps.factory.toUpperCase())).toBe(gaugeCaps)
    expect(tradeRouteFor('uniswap-v3', gaugeCaps.factory)).toBeUndefined()
    expect(tradeRouteFor('uniswap-v4', BASE_ADDRESSES.uniswapV3.factory)).toBeUndefined()
    expect(
      tradeRouteFor('aerodrome-slipstream', SLIPSTREAM_DEPRECATED_EARLY_DEPLOYMENT.factory),
    ).toBeUndefined()
  })

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(TRADE_ROUTES)).toBe(true)
    expect(TRADE_ROUTES.every((r) => Object.isFrozen(r))).toBe(true)
    expect(Object.isFrozen(TRADE_TOKENS)).toBe(true)
    expect(TRADE_TOKENS.every((t) => Object.isFrozen(t))).toBe(true)
  })
})

describe('trade token allowlist (§2.11)', () => {
  it('is the 13 reference tokens that passed, without Aerodrome AERO', () => {
    expect(TRADE_TOKENS.map((t) => t.symbol)).toEqual([
      'WETH',
      'USDC',
      'cbBTC',
      'cbETH',
      'wstETH',
      'AERO',
      'DAI',
      'EURC',
      'USDT',
      'USDbC',
      'DEGEN',
      'VIRTUAL',
      'BRETT',
    ])
    expect(TRADE_TOKENS.find((t) => t.symbol === 'AERO')).toEqual(TOKENS.AERO)
    expect(isTradeToken(TOKENS.AERO_AERODROME.address)).toBe(false)
    expect(isTradeToken(TOKENS.AERO.address.toUpperCase().replace('0X', '0x'))).toBe(true)
    expect(isTradeToken(ZERO)).toBe(false)
  })

  it('copies the reference entries (decimals as read on chain)', () => {
    for (const t of TRADE_TOKENS) {
      const reference = Object.values(TOKENS).find((r) => r.address === t.address)
      expect(t).toEqual(reference)
    }
  })
})

const signatures = (abi: readonly { type: string }[]): string[] =>
  abi.filter((i): i is AbiFunction => i.type === 'function').map((f) => toFunctionSignature(f))

describe('trade ABIs: the signatures of their sources', () => {
  it('ERC-20, pool and factory reads', () => {
    expect(signatures(tradeErc20Abi)).toEqual([
      'approve(address,uint256)',
      'allowance(address,address)',
      'balanceOf(address)',
      'decimals()',
    ])
    expect(signatures(tradePoolAbi)).toEqual([
      'factory()',
      'token0()',
      'token1()',
      'fee()',
      'tickSpacing()',
    ])
    expect(signatures(uniswapV3GetPoolAbi)).toEqual(['getPool(address,address,uint24)'])
    expect(signatures(clFactoryGetPoolAbi)).toEqual(['getPool(address,address,int24)'])
  })

  it('SwapRouter02 (no deadline in the struct) and QuoterV2', () => {
    expect(signatures(swapRouter02Abi)).toEqual([
      'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
      'multicall(uint256,bytes[])',
      'unwrapWETH9(uint256,address)',
      'refundETH()',
      'factory()',
      'WETH9()',
    ])
    expect(signatures(quoterV2Abi)).toEqual([
      'quoteExactInputSingle((address,address,uint256,uint24,uint160))',
      'factory()',
      'WETH9()',
    ])
  })

  // Three uint256 fields in a row: a wrong order would encode silently swapped values.
  it('name the struct fields in source order', () => {
    const fields = (abi: readonly { type: string; name?: string }[], name: string) => {
      const fn = abi.find((i): i is AbiFunction => i.type === 'function' && i.name === name)
      const params = fn?.inputs[0]
      return params && 'components' in params ? params.components.map((c) => c.name) : []
    }
    expect(fields(swapRouter02Abi, 'exactInputSingle')).toEqual([
      'tokenIn',
      'tokenOut',
      'fee',
      'recipient',
      'amountIn',
      'amountOutMinimum',
      'sqrtPriceLimitX96',
    ])
    expect(fields(slipstreamSwapRouterAbi, 'exactInputSingle')).toEqual([
      'tokenIn',
      'tokenOut',
      'tickSpacing',
      'recipient',
      'deadline',
      'amountIn',
      'amountOutMinimum',
      'sqrtPriceLimitX96',
    ])
    expect(fields(quoterV2Abi, 'quoteExactInputSingle')).toEqual([
      'tokenIn',
      'tokenOut',
      'amountIn',
      'fee',
      'sqrtPriceLimitX96',
    ])
    expect(fields(slipstreamQuoterV2Abi, 'quoteExactInputSingle')).toEqual([
      'tokenIn',
      'tokenOut',
      'amountIn',
      'tickSpacing',
      'sqrtPriceLimitX96',
    ])
  })

  it('encode to the selectors found in the deployed code (§2.10, blocks 53,468,151 and 53,471,577)', () => {
    const selectors = (abi: readonly { type: string }[]) =>
      signatures(abi).map((s) => toFunctionSelector(`function ${s}`))
    expect(selectors(swapRouter02Abi)).toEqual([
      '0x04e45aaf',
      '0x5ae401dc',
      '0x49404b7c',
      '0x12210e8a',
      '0xc45a0155',
      '0x4aa4a4fc',
    ])
    expect(selectors(quoterV2Abi)).toEqual(['0xc6a5026a', '0xc45a0155', '0x4aa4a4fc'])
    expect(selectors(slipstreamSwapRouterAbi)).toEqual([
      '0xa026383e',
      '0xac9650d8',
      '0x49404b7c',
      '0xc45a0155',
      '0x4aa4a4fc',
    ])
    expect(selectors(slipstreamQuoterV2Abi)).toEqual(['0x9e7defe6', '0xc45a0155', '0x4aa4a4fc'])
    expect(selectors(metaquoterAbi)).toEqual(['0x0a674142', '0x3bf0c9fb'])
  })

  it('read the pool with the selectors of v3-core and Slipstream, fee() the live fee', () => {
    const selectors = signatures(tradePoolAbi).map((s) => toFunctionSelector(`function ${s}`))
    // factory(), token0(), token1(), fee() and tickSpacing(): on a Slipstream pool fee() is
    // ICLFactory(factory).getSwapFee(pool), the fee swap() charges at that block.
    expect(selectors).toEqual([
      '0xc45a0155',
      '0x0dfe1681',
      '0xd21220a7',
      '0xddca3f43',
      '0xd0c93a7c',
    ])
  })

  it('type the struct args by field name, so a misspelt field does not compile', () => {
    const account = TOKENS.USDC.address
    const params = {
      tokenIn: TOKENS.WETH.address,
      tokenOut: TOKENS.USDC.address,
      tickSpacing: 100,
      recipient: account,
      deadline: 1_793_725_235n,
      amountIn: 10n ** 15n,
      amountOutMinimum: 2_000_000n,
      sqrtPriceLimitX96: 0n,
    } as const
    const data = encodeFunctionData({
      abi: slipstreamSwapRouterAbi,
      functionName: 'exactInputSingle',
      args: [params],
    })
    const decoded = decodeFunctionData({ abi: slipstreamSwapRouterAbi, data })
    expect(decoded.functionName).toBe('exactInputSingle')
    // viem decodes addresses checksummed; Depthwatch compares them lowercase.
    const [decodedParams] = decoded.args as unknown as [Record<string, unknown>]
    const lowered = Object.entries(decodedParams).map(([k, v]) => [
      k,
      typeof v === 'string' ? v.toLowerCase() : v,
    ])
    expect(Object.fromEntries(lowered)).toEqual(params)
    const { amountOutMinimum, ...rest } = params
    const misspelt = () =>
      encodeFunctionData({
        abi: slipstreamSwapRouterAbi,
        functionName: 'exactInputSingle',
        // @ts-expect-error `amountOutMin` is not a field of ExactInputSingleParams
        args: [{ ...rest, amountOutMin: amountOutMinimum }],
      })
    expect(misspelt).toThrow()
  })

  it('Slipstream SwapRouter (deadline in the struct), QuoterV2 and the Metaquoter', () => {
    expect(signatures(slipstreamSwapRouterAbi)).toEqual([
      'exactInputSingle((address,address,int24,address,uint256,uint256,uint256,uint160))',
      'multicall(bytes[])',
      'unwrapWETH9(uint256,address)',
      'factory()',
      'WETH9()',
    ])
    expect(signatures(slipstreamQuoterV2Abi)).toEqual([
      'quoteExactInputSingle((address,address,uint256,int24,uint160))',
      'factory()',
      'WETH9()',
    ])
    expect(signatures(metaquoterAbi)).toEqual([
      'quoteExactInputSingleV3(address,address,uint256,uint160)',
      'factoryRegistry()',
    ])
  })
})
