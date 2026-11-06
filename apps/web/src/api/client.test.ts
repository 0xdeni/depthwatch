import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  ApiUnavailableError,
  buildQuery,
  createHttpClient,
  dataModeOf,
  poolPath,
  probeApi,
  resolveClient,
  stockPath,
  tokenPath,
} from './client.js'
import type { ApiClient, GapsResponse, StatsResponse, TokenDetail } from './types.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** A client that records every URL it fetches and answers each with `body`. */
function recording(body: unknown = {}): { client: ApiClient; calls: string[] } {
  const calls: string[] = []
  const client = createHttpClient({
    fetchFn: async (input) => {
      calls.push(input)
      return jsonResponse(body)
    },
  })
  return { client, calls }
}

describe('buildQuery', () => {
  it('omits undefined and empty values but keeps zero', () => {
    expect(buildQuery({ sort: 'health', dir: undefined, dex: '', limit: 50 })).toBe(
      '?sort=health&limit=50',
    )
    expect(buildQuery({ minVolume: 0, offset: 0 })).toBe('?minVolume=0&offset=0')
    expect(buildQuery({ active: false })).toBe('?active=false')
    expect(buildQuery({})).toBe('')
    expect(buildQuery(undefined)).toBe('')
  })
})

describe('paths', () => {
  it('percent-encodes the colon of pool ids and lowercases token addresses', () => {
    expect(poolPath('uniswap-v3:0xabc')).toBe('/pools/uniswap-v3%3A0xabc')
    expect(poolPath(`uniswap-v4:0x${'7a'.repeat(32)}`)).toBe(
      `/pools/uniswap-v4%3A0x${'7a'.repeat(32)}`,
    )
    expect(tokenPath(' 0xABCdef ')).toBe('/tokens/0xabcdef')
    expect(stockPath(' 0xB2ABCdef ')).toBe('/stocks/0xb2abcdef')
  })
})

describe('createHttpClient', () => {
  it('builds every URL the API expects', async () => {
    const { client, calls } = recording({ items: [], total: 0, byDex: [], points: [] })
    await client.health()
    await client.stats()
    await client.pools({ sort: 'depth', dir: 'asc', dex: 'uniswap-v3', q: 'weth', limit: 10 })
    await client.pools()
    await client.pool('uniswap-v3:0xabc')
    await client.history('uniswap-v4:0x12', '7d')
    await client.history('uniswap-v4:0x12')
    await client.gaps({ limit: 5, offset: 2, minVolume: 0 })
    await client.gaps()
    await client.token('0xABC', { sort: 'health', dir: 'asc', limit: 20, offset: 40 })
    await client.token('0xabc')
    expect(calls).toEqual([
      '/api/health',
      '/api/stats',
      '/api/pools?sort=depth&dir=asc&dex=uniswap-v3&q=weth&limit=10',
      '/api/pools',
      '/api/pools/uniswap-v3%3A0xabc',
      '/api/pools/uniswap-v4%3A0x12/history?window=7d',
      '/api/pools/uniswap-v4%3A0x12/history?window=24h',
      '/api/gaps?limit=5&offset=2&minVolume=0',
      '/api/gaps',
      '/api/tokens/0xabc?sort=health&dir=asc&limit=20&offset=40',
      '/api/tokens/0xabc',
    ])
  })

  it('builds the stock URLs: the list, and one stock by its lowercased address', async () => {
    const { client, calls } = recording({ items: [] })
    await client.stocks()
    await client.stock('0xB26E766461630000000000000000000000000000')
    expect(calls).toEqual(['/api/stocks', '/api/stocks/0xb26e766461630000000000000000000000000000'])
    const missing = createHttpClient({
      fetchFn: async () => jsonResponse({ error: 'stock not found' }, 404),
    })
    await expect(missing.stock(`0x${'b2'.repeat(20)}`)).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'stock not found',
    })
  })

  it('sends the rating filter of the pools list as true or false', async () => {
    const { client, calls } = recording({ items: [], total: 0 })
    await client.pools({ rated: true, limit: 50 })
    await client.pools({ rated: false, limit: 1, offset: 0 })
    await client.pools({ q: 'toshi' })
    expect(calls).toEqual([
      '/api/pools?rated=true&limit=50',
      '/api/pools?rated=false&limit=1&offset=0',
      '/api/pools?q=toshi',
    ])
  })

  it('builds the scorecard URLs and reads the badge as text', async () => {
    const { client, calls } = recording({ items: [], points: [] })
    await client.scorecards()
    await client.scorecards({ pool: 'aerodrome-v2:0xabc', active: false })
    await client.scorecard('demo-aero-usdc-aero')
    await client.scorecardSamples('demo-aero-usdc-aero')
    await client.scorecardSamples('demo-aero-usdc-aero', { window: '30d', limit: 5 })
    expect(calls).toEqual([
      '/api/mm',
      '/api/mm?pool=aerodrome-v2%3A0xabc&active=false',
      '/api/mm/demo-aero-usdc-aero',
      '/api/mm/demo-aero-usdc-aero/samples',
      '/api/mm/demo-aero-usdc-aero/samples?window=30d&limit=5',
    ])

    const seen: Array<{ url: string; accept: string | undefined }> = []
    const svgClient = createHttpClient({
      fetchFn: async (input, init) => {
        const headers = init?.headers as Record<string, string> | undefined
        seen.push({ url: input, accept: headers?.accept })
        return new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } })
      },
    })
    expect(await svgClient.badge('demo-aero-usdc-aero')).toBe('<svg/>')
    expect(seen).toEqual([
      { url: '/api/mm/demo-aero-usdc-aero/badge.svg', accept: 'image/svg+xml' },
    ])

    const missing = createHttpClient({
      fetchFn: async () => jsonResponse({ error: 'mandate not found' }, 404),
    })
    await expect(missing.badge('nope')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'mandate not found',
    })
  })

  it('revalidates every request instead of reusing a copy the browser cached', async () => {
    const modes: Array<RequestCache | undefined> = []
    const client = createHttpClient({
      fetchFn: async (_input, init) => {
        modes.push(init?.cache)
        return jsonResponse({ items: [], total: 0 })
      },
    })
    await client.health()
    await client.pools()
    await client.badge('demo-aero-usdc-aero')
    expect(modes).toEqual(['no-cache', 'no-cache', 'no-cache'])
  })

  it('strips a trailing slash from the base URL', async () => {
    const calls: string[] = []
    const client = createHttpClient({
      baseUrl: 'http://localhost:8787/api/',
      fetchFn: async (input) => {
        calls.push(input)
        return jsonResponse({ ok: true })
      },
    })
    await client.health()
    expect(calls).toEqual(['http://localhost:8787/api/health'])
  })

  it('passes response bodies through untouched', async () => {
    const stats: StatsResponse = {
      byDex: [
        {
          dex: 'uniswap-v3',
          pools: 3,
          tracked: 2,
          scored: 2,
          rated: 1,
          depth2Usd: 10,
          depthKnownPools: 2,
          volume24hUsd: 20,
          medianHealth: 55,
        },
      ],
      totals: {
        pools: 3,
        tracked: 2,
        scored: 2,
        rated: 1,
        depth2Usd: 10,
        depthKnownPools: 2,
        volume24hUsd: 20,
        medianHealth: 55,
      },
    }
    expect(await recording(stats).client.stats()).toEqual(stats)

    const gaps: GapsResponse = { items: [], total: 0, meaningful: 0, minVolumeUsd: 10_000 }
    expect(await recording(gaps).client.gaps()).toEqual(gaps)

    const token: TokenDetail = {
      token: { address: '0xabc', symbol: 'T', name: 'Tok', decimals: 18 },
      usd: 2,
      via: ['uniswap-v3:0x1'],
      priceUpdatedAt: 1_700_000_000,
      pools: [],
      total: 0,
      poolCount: 1,
      depth2UsdTotal: null,
      depthKnownPools: 0,
    }
    expect(await recording(token).client.token('0xabc')).toEqual(token)
  })

  it('maps non-2xx responses to ApiError with the server message and issues', async () => {
    const client = createHttpClient({
      fetchFn: async () => jsonResponse({ error: 'pool not found' }, 404),
    })
    await expect(client.pool('nope')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'pool not found',
      issues: [],
    })

    const invalid = createHttpClient({
      fetchFn: async () =>
        jsonResponse(
          {
            error: 'invalid query: limit: Too big',
            issues: [{ path: 'limit', message: 'Too big' }],
          },
          400,
        ),
    })
    const err = await invalid.pools({ limit: 500 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(400)
    expect((err as ApiError).issues).toEqual([{ path: 'limit', message: 'Too big' }])

    const plain = createHttpClient({
      fetchFn: async () => new Response('boom', { status: 500, statusText: 'Server Error' }),
    })
    const plainErr = await plain.health().catch((e: unknown) => e)
    expect(plainErr).toBeInstanceOf(ApiError)
    expect((plainErr as ApiError).status).toBe(500)
    expect((plainErr as ApiError).message).toBe('500 Server Error')
  })
})

describe('resolveClient', () => {
  const fakeMock = {} as ApiClient

  it('uses the mock when forced', async () => {
    const result = await resolveClient({ forceMock: true, loadMock: async () => fakeMock })
    expect(result).toEqual({
      client: fakeMock,
      mock: true,
      reason: 'env',
      demo: false,
      dataNow: null,
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  const unreachable = async (): Promise<Response> => {
    throw new TypeError('Failed to fetch')
  }

  it('falls back to the mock when /api/health is unreachable and the fallback is allowed', async () => {
    const result = await resolveClient({
      forceMock: false,
      allowMockFallback: true,
      fetchFn: unreachable,
      loadMock: async () => fakeMock,
    })
    expect(result.mock).toBe(true)
    expect(result.reason).toBe('unreachable')
  })

  it('refuses the mock when /api/health is unreachable and the fallback is not allowed', async () => {
    let loaded = false
    const attempt = resolveClient({
      forceMock: false,
      allowMockFallback: false,
      fetchFn: unreachable,
      loadMock: async () => {
        loaded = true
        return fakeMock
      },
    })
    await expect(attempt).rejects.toBeInstanceOf(ApiUnavailableError)
    await expect(attempt).rejects.toThrow('The data service is not answering.')
    expect(loaded).toBe(false)
    // A health answer that is not 2xx is the same: the service is not answering.
    await expect(
      resolveClient({
        forceMock: false,
        allowMockFallback: false,
        fetchFn: async () => jsonResponse({ ok: false }, 503),
        loadMock: async () => fakeMock,
      }),
    ).rejects.toBeInstanceOf(ApiUnavailableError)
  })

  it('production defaults refuse the fallback; the dev server and VITE_MOCK=1 allow the mock', async () => {
    const options = { fetchFn: unreachable, loadMock: async () => fakeMock }
    // A production build: import.meta.env.DEV is false and VITE_MOCK is not set.
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_MOCK', '')
    await expect(resolveClient(options)).rejects.toBeInstanceOf(ApiUnavailableError)
    // `VITE_MOCK=1` is the explicit opt-in, in any build.
    vi.stubEnv('VITE_MOCK', '1')
    expect((await resolveClient(options)).reason).toBe('env')
    // The Vite dev server falls back when the API is down.
    vi.stubEnv('VITE_MOCK', '')
    vi.stubEnv('DEV', true)
    expect((await resolveClient(options)).reason).toBe('unreachable')
  })

  it('the default mock loader is not part of a production build', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_MOCK', '')
    await expect(resolveClient({ forceMock: true })).rejects.toBeInstanceOf(ApiUnavailableError)
    vi.stubEnv('DEV', true)
    const result = await resolveClient({ forceMock: true })
    expect([result.mock, result.reason]).toEqual([true, 'env'])
  })

  it('uses the live client when the API answers', async () => {
    const result = await resolveClient({
      forceMock: false,
      fetchFn: async () => jsonResponse({ ok: true }),
      loadMock: async () => fakeMock,
    })
    expect(result.mock).toBe(false)
    expect(result.client).not.toBe(fakeMock)
  })

  it('reads the data source from the health probe: the demo server runs on its own clock', async () => {
    const demo = await resolveClient({
      forceMock: false,
      fetchFn: async () =>
        jsonResponse({ ok: true, source: 'demo', latestSnapshotAt: 1_792_713_600 }),
      loadMock: async () => fakeMock,
    })
    expect([demo.mock, demo.demo, demo.dataNow]).toEqual([false, true, 1_792_713_600])
    const live = await resolveClient({
      forceMock: false,
      fetchFn: async () => jsonResponse({ ok: true, source: 'live', latestSnapshotAt: 1 }),
      loadMock: async () => fakeMock,
    })
    expect([live.demo, live.dataNow]).toEqual([false, null])
    // An older server without `source`, or a non-JSON 200, is live data.
    const old = await resolveClient({
      forceMock: false,
      fetchFn: async () => new Response('ok', { status: 200 }),
      loadMock: async () => fakeMock,
    })
    expect([old.mock, old.demo, old.dataNow]).toEqual([false, false, null])
  })

  it('dataModeOf is live unless health says demo', () => {
    expect(dataModeOf(null)).toEqual({ demo: false, dataNow: null })
    expect(dataModeOf({ source: 'live', latestSnapshotAt: 5 })).toEqual({
      demo: false,
      dataNow: null,
    })
    expect(dataModeOf({ source: 'demo', latestSnapshotAt: null })).toEqual({
      demo: true,
      dataNow: null,
    })
  })

  it('probeApi never throws and treats a 503 health as unreachable', async () => {
    await expect(
      probeApi(async () => {
        throw new Error('nope')
      }),
    ).resolves.toBe(false)
    await expect(probeApi(async () => jsonResponse({ ok: false }, 503))).resolves.toBe(false)
  })
})
