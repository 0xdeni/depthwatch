/**
 * Tab titles (`lib/pageTitle.ts`): a pool's names its pair, its DEX and its fee, or a Slipstream
 * pool's tick spacing, with the short address where the DEX can hold several pools with the same
 * words; every pool of the live-shaped fixture (60 pools cut from a Base mainnet export, some
 * sharing pair, DEX and fee) gets a title of its own, and none uses a middle dot.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assertStaticBundle } from '../api/static.js'
import type { PoolMetaDto } from '../api/types.js'
import { NB } from './format.js'
import { pageTitle, poolPageTitle } from './pageTitle.js'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '..', 'testing', 'liveShape.json')
const LIVE = assertStaticBundle(JSON.parse(readFileSync(FIXTURE, 'utf8')))

const token = (symbol: string, address: string) => ({
  address,
  symbol,
  name: symbol,
  decimals: 18,
  label: symbol,
})
const WETH = token('WETH', '0x4200000000000000000000000000000000000006')
const USDC = token('USDC', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
const pool = (meta: Partial<PoolMetaDto>): PoolMetaDto =>
  ({
    id: 'uniswap-v3:0xd0b53d9277642d899df5c87a3966a349a798f224',
    dex: 'uniswap-v3',
    kind: 'concentrated',
    address: '0xd0b53d9277642d899df5c87a3966a349a798f224',
    poolId: null,
    token0: WETH,
    token1: USDC,
    feePips: 500,
    tickSpacing: 10,
    stable: false,
    hooks: null,
    createdAtBlock: '1',
    ...meta,
  }) as PoolMetaDto

describe('page titles', () => {
  it('end every page’s name with the site’s', () => {
    expect(pageTitle('Pools')).toBe('Pools – Depthwatch')
  })

  it('name a pool by pair, DEX and fee, or by tick spacing where the fee moves', () => {
    expect(poolPageTitle(pool({}))).toBe(`WETH / USDC, Uniswap v3 0.05${NB}% – Depthwatch`)
    expect(
      poolPageTitle(
        pool({
          dex: 'aero-slipstream',
          address: '0x4e392fbfe4d0557c82d2f97f02ec39daa31516dd',
          feePips: 252,
          tickSpacing: 100,
        }),
      ),
    ).toBe('WETH / USDC, Aero Slipstream tick spacing 100, 0x4e39…16dd – Depthwatch')
    expect(
      poolPageTitle(pool({ dex: 'aerodrome-v2', feePips: 500, tickSpacing: null, stable: true })),
    ).toBe(`WETH / USDC, Aerodrome v2 0.05${NB}%, stable pair – Depthwatch`)
    expect(
      poolPageTitle(
        pool({ dex: 'uniswap-v4', address: null, poolId: `0x96d4${'0'.repeat(56)}53a3` }),
      ),
    ).toBe(`WETH / USDC, Uniswap v4 0.05${NB}%, 0x96d4…53a3 – Depthwatch`)
  })

  it('give every pool of a live-shaped export a title of its own, with no middle dot', () => {
    const titles = LIVE.pools.map((p) => poolPageTitle(p.pool))
    expect(titles.length).toBeGreaterThan(50)
    expect(new Set(titles).size).toBe(titles.length)
    for (const title of titles) {
      expect(title).toMatch(/ – Depthwatch$/)
      expect(title).not.toContain('·')
    }
  })
})
