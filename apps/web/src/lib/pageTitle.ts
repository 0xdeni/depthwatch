/**
 * Browser-tab titles that tell one page from another in tabs, history and bookmarks. Home's is the
 * `<title>` of index.html ("Depthwatch – liquidity depth of Base pools"), which a link preview also
 * reads; every other page sets its own, ending in "– Depthwatch".
 */
import { hasDynamicFee } from '@depthwatch/core'
import type { PoolMetaDto } from '../api/types.js'
import { dexLabel, feeText, pairLabel, shortAddress } from './format.js'

/** "<name> – Depthwatch". */
export function pageTitle(name: string): string {
  return `${name} – Depthwatch`
}

/**
 * A pool's title, unique among pools: "WETH / USDC, Uniswap v3 0.05 % – Depthwatch", the parts
 * joined by commas, never by middle dots (principles.md CP6). A DEX whose fee moves every block
 * (both Slipstreams) is named by its tick spacing instead, which stays put. Where the DEX allows
 * several pools with the same pair and those words (Slipstream has several factories, a Uniswap v4
 * pool is also told apart by its hook), the pool's short address follows.
 */
export function poolPageTitle(pool: PoolMetaDto): string {
  const dynamic = hasDynamicFee(pool)
  const terms =
    dynamic && pool.tickSpacing !== null
      ? `tick spacing ${pool.tickSpacing}`
      : `${feeText(pool)}${pool.stable ? ', stable pair' : ''}`
  const several = dynamic || pool.dex === 'uniswap-v4'
  const where = several ? `, ${shortAddress(pool.address ?? pool.poolId)}` : ''
  return pageTitle(`${pairLabel(pool.token0, pool.token1)}, ${dexLabel(pool.dex)} ${terms}${where}`)
}
