/**
 * Test helper: a `StaticBundle` read through any `ApiClient` (the mock client in tests), section
 * by section the way `depthwatch export` reads the API, so static-client tests run against a
 * small, realistic bundle without a server or a generated file.
 */
import { isNotFound } from '../api/errors.js'
import type { ApiClient, PoolSummary, StaticBundle } from '../api/types.js'

const PAGE = 200

export async function bundleFromClient(
  client: ApiClient,
  opts: { generatedAt: number; source: StaticBundle['source'] },
): Promise<StaticBundle> {
  const pools: PoolSummary[] = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.pools({ limit: PAGE, offset })
    pools.push(...page.items)
    if (page.items.length < PAGE) break
  }
  const poolDetails: StaticBundle['poolDetails'] = {}
  const history: StaticBundle['history'] = {}
  for (const { pool } of pools) {
    poolDetails[pool.id] = await client.pool(pool.id)
    history[pool.id] = {
      '24h': await client.history(pool.id, '24h'),
      '7d': await client.history(pool.id, '7d'),
    }
  }
  const tokens: StaticBundle['tokens'] = {}
  for (const { pool } of pools) {
    for (const token of [pool.token0, pool.token1]) {
      const address = token.address.toLowerCase()
      if (Object.hasOwn(tokens, address)) continue
      try {
        tokens[address] = await client.token(address, { limit: PAGE })
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    }
  }
  const gaps = await client.gaps({ limit: PAGE })
  const { items: scorecards } = await client.scorecards()
  const scorecardDetails: StaticBundle['scorecardDetails'] = {}
  const samples: StaticBundle['samples'] = {}
  const badges: StaticBundle['badges'] = {}
  for (const { mandate } of scorecards) {
    scorecardDetails[mandate.id] = await client.scorecard(mandate.id)
    samples[mandate.id] = {
      '24h': await client.scorecardSamples(mandate.id, { window: '24h' }),
      '7d': await client.scorecardSamples(mandate.id, { window: '7d' }),
      '30d': await client.scorecardSamples(mandate.id, { window: '30d' }),
    }
    badges[mandate.id] = await client.badge(mandate.id)
  }
  const { items: stocks } = await client.stocks()
  const stockDetails: NonNullable<StaticBundle['stockDetails']> = {}
  for (const { stock } of stocks) {
    const address = stock.token.address.toLowerCase()
    stockDetails[address] = await client.stock(address)
  }
  return {
    v: 1,
    generatedAt: opts.generatedAt,
    source: opts.source,
    // `depthwatch export` reads health from an API created with the bundle's source.
    health: { ...(await client.health()), source: opts.source },
    stats: await client.stats(),
    pools,
    poolDetails,
    history,
    gaps: gaps.items,
    gapsMinVolumeUsd: gaps.minVolumeUsd,
    tokens,
    scorecards,
    scorecardDetails,
    samples,
    badges,
    stocks,
    stockDetails,
  }
}
