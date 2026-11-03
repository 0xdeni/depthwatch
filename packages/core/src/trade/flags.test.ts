import { describe, expect, it } from 'vitest'
import type { TradeFlags } from '../types.js'
import {
  combineTradeFlags,
  parseFlagsFile,
  parseTradeFlags,
  tradeOff,
  tradeOnFor,
} from './flags.js'
import { TRADE_LAUNCH_MAX_USD, TRADE_MAX_SLIPPAGE_BPS } from './limits.js'

const ON: TradeFlags = {
  enabled: true,
  venues: ['uniswap-v3', 'aerodrome-slipstream'],
  maxUsd: 1000,
  maxSlippageBps: 300,
}

describe('tradeOff', () => {
  it('is off, with no venue and the launch limits', () => {
    expect(tradeOff()).toEqual({
      enabled: false,
      venues: [],
      maxUsd: TRADE_LAUNCH_MAX_USD,
      maxSlippageBps: TRADE_MAX_SLIPPAGE_BPS,
    })
    expect(TRADE_LAUNCH_MAX_USD).toBe(1000)
    expect(TRADE_MAX_SLIPPAGE_BPS).toBe(300)
  })

  it('is a fresh object each time', () => {
    const a = tradeOff()
    a.venues.push('uniswap-v3')
    expect(tradeOff().venues).toEqual([])
  })
})

describe('parseTradeFlags', () => {
  it('reads a block as the export writes it, as a copy', () => {
    const parsed = parseTradeFlags(JSON.parse(JSON.stringify(ON)))
    expect(parsed).toEqual(ON)
    expect(parseTradeFlags(tradeOff())).toEqual(tradeOff())
    const source = { ...ON, venues: [...ON.venues] }
    const copy = parseTradeFlags(source)
    copy?.venues.push('aero-slipstream')
    expect(source.venues).toEqual(ON.venues)
  })

  it('keeps a block that is off whatever its venues', () => {
    expect(parseTradeFlags({ ...ON, enabled: false })).toMatchObject({ enabled: false })
  })

  const malformed: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['a string', 'on'],
    ['an array', [ON]],
    ['a missing key', { enabled: true, venues: ['uniswap-v3'], maxUsd: 1000 }],
    ['an extra key', { ...ON, maxGas: 1 }],
    ['enabled as a string', { ...ON, enabled: 'true' }],
    ['enabled as 1', { ...ON, enabled: 1 }],
    ['venues as a string', { ...ON, venues: 'uniswap-v3' }],
    ['an unknown venue', { ...ON, venues: ['uniswap-v3', 'sushiswap'] }],
    ['a venue in capitals', { ...ON, venues: ['Uniswap-V3'] }],
    ['a repeated venue', { ...ON, venues: ['uniswap-v3', 'uniswap-v3'] }],
    ['maxUsd as a string', { ...ON, maxUsd: '1000' }],
    ['maxUsd 0', { ...ON, maxUsd: 0 }],
    ['maxUsd negative', { ...ON, maxUsd: -1 }],
    ['maxUsd NaN', { ...ON, maxUsd: Number.NaN }],
    ['maxUsd Infinity', { ...ON, maxUsd: Number.POSITIVE_INFINITY }],
    ['maxSlippageBps fractional', { ...ON, maxSlippageBps: 50.5 }],
    ['maxSlippageBps 0', { ...ON, maxSlippageBps: 0 }],
    ['maxSlippageBps as a string', { ...ON, maxSlippageBps: '300' }],
    ['a class instance', Object.assign(new (class Flags {})(), ON)],
  ]
  it.each(malformed)('fails closed on %s', (_why, value) => {
    expect(parseTradeFlags(value)).toBeNull()
  })

  it('leaves a ceiling above 300 bps to validateSlippageBps, which holds it to 300', () => {
    expect(parseTradeFlags({ ...ON, maxSlippageBps: 500 })).toMatchObject({ maxSlippageBps: 500 })
  })
})

describe('parseFlagsFile', () => {
  it('reads exactly { trade }', () => {
    expect(parseFlagsFile({ trade: ON })).toEqual(ON)
    expect(
      parseFlagsFile(
        JSON.parse('{"trade":{"enabled":false,"venues":[],"maxUsd":1000,"maxSlippageBps":300}}'),
      ),
    ).toEqual(tradeOff())
  })

  it.each([
    ['nothing', undefined],
    ['an empty object', {}],
    ['a bare block', ON],
    ['an extra key', { trade: ON, lp: ON }],
    ['a malformed block', { trade: { ...ON, enabled: 'yes' } }],
  ])('fails closed on %s', (_why, value) => {
    expect(parseFlagsFile(value)).toBeNull()
  })
})

describe('combineTradeFlags', () => {
  it('is on only where both are on, with the lower limits', () => {
    const live: TradeFlags = {
      enabled: true,
      venues: ['aerodrome-slipstream'],
      maxUsd: 500,
      maxSlippageBps: 400,
    }
    expect(combineTradeFlags(ON, live)).toEqual({
      enabled: true,
      venues: ['aerodrome-slipstream'],
      maxUsd: 500,
      maxSlippageBps: 300,
    })
  })

  it('is off when either read is off, missing or malformed', () => {
    const off = { ...ON, enabled: false }
    expect(combineTradeFlags(ON, off)).toEqual(tradeOff())
    expect(combineTradeFlags(off, ON)).toEqual(tradeOff())
    expect(combineTradeFlags(ON, null)).toEqual(tradeOff())
    expect(combineTradeFlags(null, ON)).toEqual(tradeOff())
    expect(combineTradeFlags(ON, parseFlagsFile('not json'))).toEqual(tradeOff())
  })

  it('is off when the two share no venue', () => {
    expect(combineTradeFlags(ON, { ...ON, venues: ['aero-slipstream'] })).toEqual(tradeOff())
  })
})

describe('tradeOnFor', () => {
  it('needs the switch on and the venue listed', () => {
    expect(tradeOnFor(ON, 'uniswap-v3')).toBe(true)
    expect(tradeOnFor(ON, 'aero-slipstream')).toBe(false)
    expect(tradeOnFor({ ...ON, enabled: false }, 'uniswap-v3')).toBe(false)
    expect(tradeOnFor(tradeOff(), 'uniswap-v3')).toBe(false)
  })

  it('a switch-off read before signing blocks a venue that was on at load', () => {
    const atLoad = parseTradeFlags(ON)
    const beforeSigning = parseFlagsFile({ trade: tradeOff() })
    expect(tradeOnFor(combineTradeFlags(atLoad, beforeSigning), 'uniswap-v3')).toBe(false)
  })
})
