/**
 * Static client errors and loading: the API's 400 bodies (zod messages, `issues`, parameter
 * order), its 404 bodies for unknown ids, answers that are copies, the bundle loader, and what a
 * live bundle tells the page about its snapshot.
 */
import { describe, expect, it } from 'vitest'
import { bundleFromClient } from '../testing/staticBundle.js'
import { ApiError } from './errors.js'
import { createMockClient } from './mock.js'
import { assertStaticBundle, createStaticClient, loadStaticBundle, snapshotOf } from './static.js'
import type { PoolSort, SampleWindow, SortDir } from './types.js'

const NOW = 1_760_000_000
const BUNDLE = await bundleFromClient(createMockClient({ now: NOW }), {
  generatedAt: NOW,
  source: 'live',
})
const client = createStaticClient(BUNDLE)
const POOL = BUNDLE.pools[0]?.pool.id ?? ''
const MANDATE = BUNDLE.scorecards[0]?.mandate.id ?? ''
const UNKNOWN_TOKEN = `0x${'ab'.repeat(20)}`

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected an ApiError')
}

/** The API's 400 for one or more failed parameters (strings as zod 4 words them). */
function invalid(...issues: Array<[path: string, message: string]>) {
  return {
    status: 400,
    message: `invalid query: ${issues.map(([path, message]) => `${path}: ${message}`).join('; ')}`,
    issues: issues.map(([path, message]) => ({ path, message })),
  }
}

function shape(error: ApiError) {
  return { status: error.status, message: error.message, issues: error.issues }
}

const SORT_OPTIONS =
  'Invalid option: expected one of "health"|"depth"|"volume"|"gap"|"tvl"|"spread"|"top"'

describe('static client: 400 bodies', () => {
  it('rejects bad pools parameters with the API messages, in schema order', async () => {
    const cases: Array<[Parameters<typeof client.pools>[0], ReturnType<typeof invalid>]> = [
      [{ sort: 'bogus' as PoolSort }, invalid(['sort', SORT_OPTIONS])],
      [{ dir: 'up' as SortDir }, invalid(['dir', 'Invalid option: expected one of "asc"|"desc"'])],
      [
        { dex: 'sushi' as never },
        invalid([
          'dex',
          'Invalid option: expected one of "uniswap-v3"|"uniswap-v4"|"aerodrome-v2"|"aerodrome-slipstream"|"aero-v2"|"aero-slipstream"',
        ]),
      ],
      [{ q: 'x'.repeat(201) }, invalid(['q', 'Too big: expected string to have <=200 characters'])],
      [{ minVolume: -1 }, invalid(['minVolume', 'Too small: expected number to be >=0'])],
      [
        { minVolume: Number.NaN },
        invalid(['minVolume', 'Invalid input: expected number, received NaN']),
      ],
      [
        { minVolume: Number.POSITIVE_INFINITY },
        invalid(['minVolume', 'Invalid input: expected number, received Infinity']),
      ],
      [{ limit: 0 }, invalid(['limit', 'Too small: expected number to be >=1'])],
      [{ limit: 201 }, invalid(['limit', 'Too big: expected number to be <=200'])],
      [{ limit: 1.5 }, invalid(['limit', 'Invalid input: expected int, received number'])],
      [{ offset: -1 }, invalid(['offset', 'Too small: expected number to be >=0'])],
      [
        { limit: 1e20 },
        invalid(
          ['limit', 'Too big: expected int to be <=9007199254740991'],
          ['limit', 'Too big: expected number to be <=200'],
        ),
      ],
      [
        { sort: 'x' as PoolSort, limit: 0 },
        invalid(['sort', SORT_OPTIONS], ['limit', 'Too small: expected number to be >=1']),
      ],
    ]
    for (const [query, expected] of cases)
      expect(shape(await failure(client.pools(query))), JSON.stringify(query)).toEqual(expected)
    // Blank values are absent, as on the wire: `q` of spaces matches everything.
    expect((await client.pools({ q: '   ', limit: 200 })).total).toBe(BUNDLE.pools.length)
  })

  it('validates the query before looking the id up, like the routes', async () => {
    expect(shape(await failure(client.history('nope', '1h' as never)))).toEqual(
      invalid(['window', 'Invalid option: expected one of "24h"|"7d"']),
    )
    expect(shape(await failure(client.scorecardSamples('nope', { limit: 10_001 })))).toEqual(
      invalid(['limit', 'Too big: expected number to be <=10000']),
    )
    expect(
      shape(await failure(client.scorecardSamples(MANDATE, { window: '1y' as SampleWindow }))),
    ).toEqual(invalid(['window', 'Invalid option: expected one of "24h"|"7d"|"30d"']))
    expect(shape(await failure(client.gaps({ limit: 500 })))).toEqual(
      invalid(['limit', 'Too big: expected number to be <=200']),
    )
    expect(shape(await failure(client.scorecards({ pool: 'p'.repeat(201) })))).toEqual(
      invalid(['pool', 'Too big: expected string to have <=200 characters']),
    )
  })

  it('checks a token address first, then its query, then whether it exists', async () => {
    const bad = await failure(client.token('0x123', { sort: 'name' as PoolSort }))
    expect(shape(bad)).toEqual({
      status: 400,
      message: 'invalid token address: expected 0x + 40 hex chars',
      issues: [],
    })
    expect(shape(await failure(client.token(UNKNOWN_TOKEN, { sort: 'name' as PoolSort })))).toEqual(
      invalid(['sort', SORT_OPTIONS]),
    )
    const missing = await failure(client.token(UNKNOWN_TOKEN))
    expect([missing.status, missing.message]).toEqual([404, 'token not found'])
  })
})

describe('static client: 404 bodies', () => {
  it('answers unknown pools, histories and mandates like the API', async () => {
    for (const id of ['nope', '__proto__', 'constructor', 'toString']) {
      for (const call of [client.pool(id), client.history(id, '7d')]) {
        const error = await failure(call)
        expect([error.status, error.message], id).toEqual([404, 'pool not found'])
      }
      for (const call of [client.scorecard(id), client.scorecardSamples(id), client.badge(id)]) {
        const error = await failure(call)
        expect([error.status, error.message], id).toEqual([404, 'mandate not found'])
      }
    }
  })

  it('answers known ids from the bundle', async () => {
    expect(await client.pool(POOL)).toEqual(BUNDLE.poolDetails[POOL])
    expect(await client.history(POOL)).toEqual(BUNDLE.history[POOL]?.['24h'])
    expect(await client.history(POOL, '7d')).toEqual(BUNDLE.history[POOL]?.['7d'])
    expect(await client.health()).toEqual(BUNDLE.health)
    expect(await client.stats()).toEqual(BUNDLE.stats)
  })
})

describe('static client: answers are copies', () => {
  it('never lets a caller change the bundle', async () => {
    const first = await client.pools()
    const top = first.items[0]
    if (!top) throw new Error('no pools')
    top.health.total = -1
    first.items.reverse()
    const again = await client.pools()
    expect(again.items[0]?.health.total).not.toBe(-1)
    expect(again.items[0]?.pool.id).toBe(top.pool.id)
    const health = await client.health()
    health.poolCount = -1
    expect((await client.health()).poolCount).toBe(BUNDLE.health.poolCount)
  })
})

describe('loadStaticBundle', () => {
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('fetches ./data/bundle.json and returns the checked bundle', async () => {
    const urls: string[] = []
    const bundle = await loadStaticBundle(undefined, async (url) => {
      urls.push(url)
      return respond(BUNDLE)
    })
    expect(urls).toEqual(['./data/bundle.json'])
    expect(bundle.pools).toHaveLength(BUNDLE.pools.length)
  })

  it('fails with the status when the file is missing', async () => {
    await expect(
      loadStaticBundle('./data/bundle.json', async () => respond({ error: 'x' }, 404)),
    ).rejects.toThrow(/could not load \.\/data\/bundle\.json: 404/)
  })

  it('rejects anything that is not a v1 bundle', () => {
    expect(() => assertStaticBundle(null)).toThrow(/not a JSON object/)
    expect(() => assertStaticBundle({ ...BUNDLE, v: 2 })).toThrow(/unsupported version 2/)
    expect(() => assertStaticBundle({ ...BUNDLE, source: 'test' })).toThrow(/source/)
    expect(() => assertStaticBundle({ ...BUNDLE, pools: {} })).toThrow(/pools is not an array/)
    expect(() => assertStaticBundle({ ...BUNDLE, badges: [] })).toThrow(/badges is not an object/)
    expect(() => assertStaticBundle({ ...BUNDLE, note: 42 })).toThrow(/note is not a string/)
    expect(assertStaticBundle(structuredClone(BUNDLE)).source).toBe('live')
    // `note` is optional: bundles exported without --note (every demo export) have none.
    expect(Object.hasOwn(BUNDLE, 'note')).toBe(false)
    expect(assertStaticBundle({ ...BUNDLE, note: 'Top pools.' }).note).toBe('Top pools.')
  })
})

describe('snapshotOf: a live bundle is a dated snapshot', () => {
  it('dates it by its newest snapshot, with the block, the export time and the trimmed note', () => {
    expect(snapshotOf({ ...BUNDLE, generatedAt: NOW + 600, note: '  Top pools.\n' })).toEqual({
      at: BUNDLE.health.latestSnapshotAt,
      exportedAt: NOW + 600,
      block: BUNDLE.health.latestBlock,
      note: 'Top pools.',
    })
    expect(snapshotOf(BUNDLE)?.note).toBeNull()
    expect(snapshotOf({ ...BUNDLE, note: ' \n ' })?.note).toBeNull()
  })

  it('falls back to the export time before any snapshot', () => {
    const health = { ...BUNDLE.health, latestSnapshotAt: null, latestBlock: null }
    expect(snapshotOf({ ...BUNDLE, health })).toEqual({
      at: NOW,
      exportedAt: NOW,
      block: null,
      note: null,
    })
  })

  it('leaves a demo bundle alone, note or not', () => {
    expect(snapshotOf({ ...BUNDLE, source: 'demo' })).toBeUndefined()
    expect(snapshotOf({ ...BUNDLE, source: 'demo', note: 'x' })).toBeUndefined()
  })
})
