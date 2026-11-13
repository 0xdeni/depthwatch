import { computeHealthScore, type HealthScore } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import type { PoolDetail, PoolMetaDto, SpreadPoint } from '../../api/types.js'
import { NB } from '../../lib/format.js'
import {
  costTakeaway,
  gapCallout,
  healthFactSuffix,
  healthTakeaway,
  neutralReason,
  overTimeCaption,
  ownersNote,
  poolAnswer,
  spanWords,
  spreadAt,
  spreadCell,
  tooFewTakeaway,
  tvlFactLabel,
  volumeFactLabel,
  whoTakeaway,
  whoTitle,
} from './poolText.js'

const point = (notionalUsd: number, spreadBps: number | null, feasible = true): SpreadPoint => ({
  notionalUsd,
  spreadBps,
  feasible,
  buyAvgPrice: spreadBps === null ? null : 1,
  sellAvgPrice: spreadBps === null ? null : 1,
})

describe('costTakeaway and the spread cells', () => {
  it('states the largest notional the pool absorbs, in percent and dollars, then bps', () => {
    const spreads = [point(1_000, 10), point(10_000, 13.8), point(100_000, 42)]
    expect(costTakeaway(spreads)).toBe(
      `A $100K round trip costs 0.42${NB}%, about $420 (42.0${NB}bps), fees included.`,
    )
    expect(spreadAt(spreads, 10_000)).toBe(13.8)
    // The Details table lays out the parts: the percent over the dollars and bps.
    expect(spreadCell(point(10_000, 13.8))).toMatchObject({
      percent: `0.14${NB}%`,
      dollars: '$14',
      bps: `13.8${NB}bps`,
    })
    expect(spreadCell(point(1_000, 9))).toMatchObject({ percent: `0.090${NB}%`, dollars: '$0.90' })
  })

  it('says the pool can’t absorb a notional that does not fill', () => {
    const spreads = [point(1_000, 10), point(10_000, null, false), point(100_000, null, false)]
    expect(costTakeaway(spreads)).toBe(
      `The pool can’t absorb $100K; a $1K round trip costs 0.10${NB}%, about $1 (10.0${NB}bps).`,
    )
    expect(spreadAt(spreads, 10_000)).toBeNull()
    expect(spreadCell(point(100_000, null, false))).toBe(`Can’t absorb $100K`)
  })

  it('treats a spread of 10,000 bps or more as one it can’t absorb: the first run stored 1.4e24', () => {
    const spreads = [point(1_000, 1.449e24), point(10_000, 1.449e24), point(100_000, 1.449e24)]
    expect(costTakeaway(spreads)).toBe('The pool can’t absorb a $1K round trip.')
    expect(spreadAt(spreads, 10_000)).toBeNull()
    expect(spreadCell(point(10_000, 1.449e24))).toBe(`Can’t absorb $10K`)
    for (const text of [costTakeaway(spreads), String(spreadCell(point(10_000, 1.449e24)))]) {
      expect(text).not.toMatch(/\d{5,}|e\+/)
    }
  })

  it('has nothing to say before a snapshot', () => {
    expect(costTakeaway([])).toBe('No round trip was measured in the latest snapshot.')
  })
})

describe('healthTakeaway', () => {
  const inputs = {
    spread10kBps: 20,
    ownerTop1Share: 0.3,
    ownerCoverage: 1,
    rangeHhi: 0.3,
    poolKind: 'concentrated',
    persistence: null,
  } as const

  it('names the weakest part of a rated pool', () => {
    const health = computeHealthScore({ ...inputs, depth2UpUsd: 20_000, depth2DownUsd: 20_000 })
    expect(health.rated).toBe(true)
    expect(healthTakeaway(health, null, 'concentrated')).toMatch(/is the weak part/)
  })

  it('states the weakest part’s points to one decimal, as the health bar labels them', () => {
    const health: HealthScore = {
      total: 74.1,
      grade: 'B',
      rated: true,
      unratedReason: null,
      concentrationBasis: 'owners',
      components: { depth: 33.7, spread: 11.8, concentration: 13.6, persistence: 15 },
      notes: [],
    }
    expect(healthTakeaway(health, null, 'concentrated')).toBe(
      'Spread is the weak part: 11.8 of 25 points.',
    )
  })

  it('names one LP as the weak part only when the owners cover the pool', () => {
    const health: HealthScore = {
      total: 70,
      grade: 'B',
      rated: true,
      unratedReason: null,
      // A score stored before the basis was recorded.
      concentrationBasis: null,
      components: { depth: 30, spread: 20, concentration: 2, persistence: 18 },
      notes: [],
    }
    const band = { bandPct: 5, rangeHhi: 0.9, activeRangeShare: 0.4 }
    const lone = { count: 1, top1Share: 1, top3Share: 1, hhi: 1, coverage: 0.0102 }
    expect(healthTakeaway(health, { ...band, owners: lone }, 'concentrated')).toBe(
      `Concentration is the weak part: 40${NB}% sits in one range.`,
    )
    const covering = { ...lone, count: 3, top1Share: 0.9, coverage: 0.95 }
    expect(healthTakeaway(health, { ...band, owners: covering }, 'concentrated')).toBe(
      `Concentration is the weak part: one LP holds 90${NB}%.`,
    )
  })

  it('gives core’s reason when it scored the weakest part neutral', () => {
    const short = computeHealthScore({
      ...inputs,
      depth2UpUsd: 900_000,
      depth2DownUsd: 900_000,
      spread10kBps: 5,
      rangeHhi: 0.01,
      persistence: {
        windowHours: 24,
        samples: 5,
        depthUsdMedian: 1e6,
        depthUsdP10: 9e5,
        depthUsdMin: 8e5,
        stability: null,
        uptime: null,
      },
    })
    expect(healthTakeaway(short, null, 'concentrated')).toBe(
      `Persistence is the weak part: samples cover under 25${NB}% of the window.`,
    )
    expect(neutralReason(['depth unknown: scored 0'], 'depth')).toBeNull()
  })

  it('gives the reason, not a weak part, for a pool with no grade', () => {
    const thin = computeHealthScore({ ...inputs, depth2UpUsd: 800, depth2DownUsd: 900 })
    expect(healthTakeaway(thin, null, 'concentrated')).toBe(
      `Too thin to rate: neither side holds $5K within 2${NB}%.`,
    )
    const oneSided = computeHealthScore({ ...inputs, depth2UpUsd: 900_000, depth2DownUsd: 0 })
    expect(healthTakeaway(oneSided, null, 'concentrated')).toMatch(/^Too thin on one side/)
    const unpriced = computeHealthScore({ ...inputs, depth2UpUsd: null, depth2DownUsd: 1e6 })
    expect(healthTakeaway(unpriced, null, 'concentrated')).toMatch(/^No USD price/)
  })
})

describe('the facts’ comparisons and the callout', () => {
  it('words each label from the stored values, the closing number glued to the word before it', () => {
    expect(healthFactSuffix(61.475)).toBe(`; the median rated pool scores${NB}61`)
    expect(healthFactSuffix(null)).toBe('')
    expect(volumeFactLabel(14.02)).toBe(`traded in 24${NB}h, 14× the depth within${NB}2${NB}%`)
    expect(volumeFactLabel(null)).toBe(`traded in 24${NB}h`)
    expect(tvlFactLabel(810_820, 8_394_440)).toBe(`TVL, of which 10${NB}% sits within${NB}2${NB}%`)
    expect(tvlFactLabel(2_000, 8_394_440)).toBe(
      `TVL, of which under 1${NB}% sits within${NB}2${NB}%`,
    )
    expect(tvlFactLabel(null, 8_394_440)).toBe('TVL')
  })

  it('counts the pool among the gaps when the feed lists it, else gives its own turnover', () => {
    expect(gapCallout(14.02, 48, 3)).toBe(
      'Liquidity gap: one of 48 pools that trade 3× their depth or more a day.',
    )
    expect(gapCallout(14.02, null, 3)).toBe('Liquidity gap: it trades 14× its depth a day.')
  })
})

describe('who provides it', () => {
  const c = { bandPct: 5, rangeHhi: 0.01, activeRangeShare: 0.0117, owners: null }
  it('says the owners are not indexed and reads the active range instead', () => {
    expect(whoTakeaway(c, 'concentrated')).toBe(
      `LP owners are not indexed for this pool. The active range holds 1${NB}% of the liquidity within ±5${NB}%.`,
    )
    expect(whoTakeaway(c, 'constant-product')).toBe('A full-range pool: every LP shares one range.')
    expect(whoTitle(null, true)).toBe('who provides it')
    expect(ownersNote(null)).toBe(
      'Owners are not indexed for this pool, so health uses the range HHI.',
    )
  })

  it('where owners are never read, titles the section by what it shows and drops the owner line', () => {
    expect(whoTitle(null, false)).toBe('how concentrated the liquidity is')
    expect(whoTakeaway(c, 'concentrated', false)).toBe(
      `The active range holds 1${NB}% of the liquidity within ±5${NB}%.`,
    )
    expect(whoTakeaway(c, 'constant-product', false)).toBe(
      'A full-range pool: every LP shares one range.',
    )
    expect(ownersNote(null, false)).toBeNull()
    // A pool that does carry owner data keeps its heading and its owner sentences.
    const some = { count: 4, top1Share: 0.53, top3Share: 1, hhi: 0.3, coverage: 0.95 }
    expect(whoTitle(some, false)).toBe('who provides it')
    expect(whoTakeaway({ ...c, owners: some }, 'concentrated', false)).toBe(
      `One LP holds 53${NB}% of the liquidity near the price.`,
    )
  })

  const owners = (count: number, top1Share: number, coverage: number | null) => ({
    ...c,
    owners: { count, top1Share, top3Share: Math.min(1, top1Share * 2), hhi: 0.3, coverage },
  })

  it('names one LP only when the indexed owners cover the pool', () => {
    expect(whoTakeaway(owners(4, 0.53, 0.95), 'concentrated')).toBe(
      `One LP holds 53${NB}% of the liquidity near the price.`,
    )
  })

  it('says what indexed LPs that cover too little hold, and the largest one’s part of that', () => {
    // One unstaked LP beside a gauge holding 97 % of the band.
    expect(whoTakeaway(owners(1, 1, 0.0102), 'concentrated')).toBe(
      `Indexed LPs hold 1${NB}% of the liquidity near the price; the largest holds 100${NB}% of that.`,
    )
    expect(whoTakeaway(owners(3, 0.42, null), 'concentrated')).toBe(
      `Indexed LPs hold an unknown share of the liquidity near the price; the largest holds 42${NB}% of that.`,
    )
    expect(ownersNote(owners(1, 1, 0.0102).owners)).toBe(
      `Indexed owners cover 1${NB}% of the liquidity in the band, so health uses the range HHI; the LP shares above are of that part.`,
    )
    expect(ownersNote(owners(4, 0.53, 0.95).owners)).toBeNull()
  })

  it('reads the active range when no indexed owner is in the band (only a gauge’s positions)', () => {
    expect(whoTakeaway(owners(0, 0, 0), 'concentrated')).toBe(
      `No indexed LP owner holds liquidity near the price. The active range holds 1${NB}% of the liquidity within ±5${NB}%.`,
    )
  })
})

describe('over time', () => {
  // 10:39 to 11:30 UTC on 25 Oct 2026.
  const times = [1792924753, 1792925085, 1792925421, 1792927483, 1792927835]
  it('states the snapshots and their span when persistence cannot be measured', () => {
    expect(tooFewTakeaway(5, times)).toBe(
      `5 snapshots from 10:39 to 11:30${NB}UTC cover too little of the window to measure persistence.`,
    )
    expect(tooFewTakeaway(1, times.slice(0, 1))).toBe(
      '1 snapshot: too few to measure persistence yet.',
    )
  })

  it('captions the span the axis covers, and says when both windows hold the same snapshots', () => {
    expect(overTimeCaption(times, 5)).toBe(
      'Times in UTC. The axis spans the 51 minutes the snapshots cover; each range is labelled at its right. Both windows hold the same 5 snapshots.',
    )
    expect(overTimeCaption(times, 9)).toBe(
      'Times in UTC. The axis spans the 51 minutes the snapshots cover; each range is labelled at its right.',
    )
    expect(spanWords(3 * 3600)).toBe('3 hours')
    expect(spanWords(3 * 86_400)).toBe('3 days')
  })
})

describe('poolAnswer', () => {
  const pool = { token0: { symbol: 'WETH' }, token1: { symbol: 'USDC' } } as PoolMetaDto
  const level = (up: number | null, down: number | null, reachedUp = true, reachedDown = true) =>
    ({
      pool,
      latest: {
        depthUsd: [{ pct: 2, upUsd: up, downUsd: down, totalUsd: null }],
        depth: [
          {
            pct: 2,
            up: { amountIn: '1', amountOut: '1', reached: reachedUp },
            down: { amountIn: '1', amountOut: '1', reached: reachedDown },
          },
        ],
      },
    }) as unknown as Pick<PoolDetail, 'pool' | 'latest'>

  it('states both sides at 3 significant figures (N1)', () => {
    expect(poolAnswer(level(6_079_641, 5_102_004))).toBe(
      `It takes $6.08M of buying to lift WETH 2${NB}% and $5.10M of selling to push it down.`,
    )
  })

  it('names the token with no USD price instead of a misleading number', () => {
    expect(poolAnswer(level(null, 5_102_004))).toBe(
      `It takes $5.10M of selling to push WETH down 2${NB}%. The buy side is unknown: USDC has no USD price.`,
    )
  })

  it('says that no liquidity sits within 2 % when both sides hold $0, never "It takes $0"', () => {
    expect(poolAnswer(level(0, 0))).toBe(`No liquidity sits within 2${NB}% of the price.`)
    expect(poolAnswer(level(0, 0, false, false))).toBe(
      `No liquidity sits within 2${NB}% of the price.`,
    )
    // One empty side still reads as a number: the other side holds depth.
    expect(poolAnswer(level(0, 5_102_004))).toMatch(/^It takes \$0 of buying/)
  })

  it('says how much empties a side that runs out before 2 %', () => {
    expect(poolAnswer(level(812_000, 5_102_004, false))).toBe(
      `Liquidity runs out before a 2${NB}% move: $812K empties the buy side, and $5.10M of selling pushes WETH down 2${NB}%.`,
    )
  })

  it('waits for the first snapshot', () => {
    expect(poolAnswer({ pool, latest: null })).toBe(
      'No snapshot yet. Depth appears after the first snapshot.',
    )
  })

  it('says a hooked pool is not modelled, not that its tokens have no price', () => {
    const hooked = { ...pool, hooks: '0x00000000000000000000000000000000000000c0' } as PoolMetaDto
    expect(poolAnswer({ pool: hooked, latest: level(null, null).latest })).toBe(
      'This pool has a swap hook Depthwatch does not model: its depth is not computed.',
    )
  })
})
