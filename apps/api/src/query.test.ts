import { DEXES } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import {
  gapsQuerySchema,
  historyQuerySchema,
  MAX_SAMPLES_LIMIT,
  parseAddress,
  parseQuery,
  poolsQuerySchema,
  SAMPLE_WINDOWS,
  samplesQuerySchema,
  scorecardsQuerySchema,
  tokenQuerySchema,
} from './query.js'

describe('poolsQuerySchema', () => {
  it('applies the DESIGN defaults', () => {
    const parsed = parseQuery(poolsQuerySchema, {})
    expect(parsed).toEqual({
      ok: true,
      data: {
        sort: 'health',
        dir: 'desc',
        dex: undefined,
        q: undefined,
        minVolume: undefined,
        limit: 50,
        offset: 0,
      },
    })
  })

  it('treats empty and blank values as absent', () => {
    const parsed = parseQuery(poolsQuerySchema, {
      sort: '',
      dir: ' ',
      dex: '',
      q: '   ',
      minVolume: '',
      limit: '',
      offset: '',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.data.sort).toBe('health')
    expect(parsed.data.dir).toBe('desc')
    expect(parsed.data.dex).toBeUndefined()
    expect(parsed.data.q).toBeUndefined()
    expect(parsed.data.limit).toBe(50)
  })

  it('parses every parameter', () => {
    const parsed = parseQuery(poolsQuerySchema, {
      sort: 'tvl',
      dir: 'asc',
      dex: 'aerodrome-v2',
      q: ' weth ',
      minVolume: '2500.5',
      limit: '200',
      offset: '10',
    })
    expect(parsed).toEqual({
      ok: true,
      data: {
        sort: 'tvl',
        dir: 'asc',
        dex: 'aerodrome-v2',
        q: 'weth',
        minVolume: 2500.5,
        limit: 200,
        offset: 10,
      },
    })
  })

  it('keeps a pair search as written and drops a query of separators alone', () => {
    const q = (value: string) => {
      const parsed = parseQuery(poolsQuerySchema, { q: value })
      if (!parsed.ok) throw new Error(parsed.error.error)
      return parsed.data.q
    }
    expect(q(' WETH/USDC ')).toBe('WETH/USDC')
    expect(q('usdc weth')).toBe('usdc weth')
    for (const blank of ['/', ' - ', ': /', '\t']) expect(q(blank), blank).toBeUndefined()
  })

  it('accepts every DEXES id, the Aero ones included, and only those', () => {
    for (const dex of DEXES) {
      const parsed = parseQuery(poolsQuerySchema, { dex })
      expect(parsed.ok && parsed.data.dex, dex).toBe(dex)
    }
    expect(parseQuery(poolsQuerySchema, { dex: 'aero' }).ok).toBe(false)
    expect(parseQuery(poolsQuerySchema, { dex: 'Aero-V2' }).ok).toBe(false)
  })

  it.each([
    [{ sort: 'nope' }, 'sort'],
    [{ dir: 'up' }, 'dir'],
    [{ dex: 'sushi' }, 'dex'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '201' }, 'limit'],
    [{ limit: '1.5' }, 'limit'],
    [{ limit: 'abc' }, 'limit'],
    [{ offset: '-1' }, 'offset'],
    [{ minVolume: '-5' }, 'minVolume'],
    [{ minVolume: 'Infinity' }, 'minVolume'],
    [{ q: 'x'.repeat(101) }, 'q'],
  ])('rejects %j', (raw, path) => {
    const parsed = parseQuery(poolsQuerySchema, raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.error.error).toMatch(/^invalid query: /)
    expect(parsed.error.error).toContain(`${path}: `)
    expect(parsed.error.issues?.map((issue) => issue.path)).toContain(path)
  })

  it('reports every failing parameter in one message', () => {
    const parsed = parseQuery(poolsQuerySchema, { sort: 'x', limit: '999' })
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.error.issues).toHaveLength(2)
    expect(parsed.error.error).toContain('sort: ')
    expect(parsed.error.error).toContain('limit: ')
  })
})

describe('other schemas', () => {
  it('history defaults to 24h and accepts 7d only', () => {
    expect(parseQuery(historyQuerySchema, {})).toEqual({ ok: true, data: { window: '24h' } })
    expect(parseQuery(historyQuerySchema, { window: '7d' })).toEqual({
      ok: true,
      data: { window: '7d' },
    })
    expect(parseQuery(historyQuerySchema, { window: '30d' }).ok).toBe(false)
  })

  it('gaps takes paging and a volume floor', () => {
    expect(parseQuery(gapsQuerySchema, { limit: '5', minVolume: '0' })).toEqual({
      ok: true,
      data: { limit: 5, offset: 0, minVolume: 0 },
    })
  })

  it('token lists default to deepest first', () => {
    expect(parseQuery(tokenQuerySchema, {})).toEqual({
      ok: true,
      data: { sort: 'depth', dir: 'desc', limit: 50, offset: 0 },
    })
  })
})

describe('parseAddress', () => {
  it('lowercases well-formed addresses', () => {
    expect(parseAddress('0x4200000000000000000000000000000000000006')).toBe(
      '0x4200000000000000000000000000000000000006',
    )
    expect(parseAddress('  0xABCDEFabcdef0123456789ABCDEFabcdef012345 ')).toBe(
      '0xabcdefabcdef0123456789abcdefabcdef012345',
    )
  })

  it('rejects malformed input', () => {
    expect(parseAddress('0x123')).toBeUndefined()
    expect(parseAddress('4200000000000000000000000000000000000006')).toBeUndefined()
    expect(parseAddress('0xZZ00000000000000000000000000000000000006')).toBeUndefined()
    expect(parseAddress('')).toBeUndefined()
  })
})

describe('scorecard schemas', () => {
  it('scorecards: pool and active are optional, blanks are absent, active is a boolean', () => {
    expect(parseQuery(scorecardsQuerySchema, {})).toEqual({
      ok: true,
      data: { pool: undefined, active: undefined },
    })
    expect(parseQuery(scorecardsQuerySchema, { pool: ' ', active: '' })).toEqual({
      ok: true,
      data: { pool: undefined, active: undefined },
    })
    expect(parseQuery(scorecardsQuerySchema, { pool: ' uniswap-v3:0x1 ', active: 'true' })).toEqual(
      { ok: true, data: { pool: 'uniswap-v3:0x1', active: true } },
    )
    expect(parseQuery(scorecardsQuerySchema, { active: ' False ' })).toEqual({
      ok: true,
      data: { pool: undefined, active: false },
    })
  })

  it.each([
    [{ active: 'yes' }, 'active'],
    [{ active: '1' }, 'active'],
    [{ pool: 'x'.repeat(201) }, 'pool'],
  ])('scorecards rejects %j', (raw, path) => {
    const parsed = parseQuery(scorecardsQuerySchema, raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.error.issues?.map((issue) => issue.path)).toContain(path)
  })

  it('samples: window defaults to 7d, limit to the 10 000 cap', () => {
    expect(SAMPLE_WINDOWS).toEqual(['24h', '7d', '30d'])
    expect(MAX_SAMPLES_LIMIT).toBe(10_000)
    expect(parseQuery(samplesQuerySchema, {})).toEqual({
      ok: true,
      data: { window: '7d', limit: 10_000 },
    })
    expect(parseQuery(samplesQuerySchema, { window: '', limit: '' })).toEqual({
      ok: true,
      data: { window: '7d', limit: 10_000 },
    })
    for (const window of SAMPLE_WINDOWS) {
      expect(parseQuery(samplesQuerySchema, { window, limit: '1' })).toEqual({
        ok: true,
        data: { window, limit: 1 },
      })
    }
  })

  it.each([
    [{ window: '1h' }, 'window'],
    [{ window: '90d' }, 'window'],
    [{ limit: '0' }, 'limit'],
    [{ limit: '10001' }, 'limit'],
    [{ limit: '2.5' }, 'limit'],
    [{ limit: 'many' }, 'limit'],
  ])('samples rejects %j', (raw, path) => {
    const parsed = parseQuery(samplesQuerySchema, raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.error.error).toContain(`${path}: `)
  })
})
