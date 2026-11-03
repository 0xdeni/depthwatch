// @vitest-environment node
/**
 * The static build ships the trade switch `depthwatch export` wrote next to the bundle as
 * `data/flags.json`, and fails when the file is missing, malformed or disagrees with the bundle's
 * `features.trade`: the dashboard's two reads of one site must always agree. What it ships is what
 * the dashboard's reader (`parseFlagsFile`, core) accepts.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFlagsFile, parseTradeFlags, type TradeFlags, tradeOff } from '@depthwatch/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FLAGS_CACHE_CONTROL, readFlags, STATIC_FLAGS_PATH } from './staticFlags.js'

const ON: TradeFlags = { enabled: true, venues: ['uniswap-v3'], maxUsd: 1000, maxSlippageBps: 300 }

describe('readFlags', () => {
  let dir = ''
  let file = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-flags-'))
    file = join(dir, 'flags.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const bundle = (features?: unknown) =>
    JSON.stringify({ v: 1, source: 'live', ...(features === undefined ? {} : { features }) })

  it('ships the file the export wrote, next to the bundle and uncached', () => {
    expect(STATIC_FLAGS_PATH).toBe('data/flags.json')
    expect(FLAGS_CACHE_CONTROL).toBe('no-store')
    for (const trade of [tradeOff(), ON]) {
      const text = JSON.stringify({ trade })
      writeFileSync(file, text)
      expect(readFlags(file, bundle({ trade }))).toBe(text)
      expect(parseFlagsFile(JSON.parse(text))).toEqual(trade)
    }
  })

  it('compares by content, not by key order', () => {
    const text =
      '{"trade":{"venues":["uniswap-v3"],"maxSlippageBps":300,"maxUsd":1000,"enabled":true}}'
    writeFileSync(file, text)
    expect(readFlags(file, bundle({ trade: ON }))).toBe(text)
    expect(parseTradeFlags(JSON.parse(text).trade)).toEqual(ON)
  })

  it('fails the build when the file is missing', () => {
    expect(() => readFlags(file, bundle({ trade: ON }))).toThrow(
      `static build: ${file} not found. Run \`pnpm build:static\``,
    )
  })

  it.each([
    ['is not JSON', '{"trade":', /is not JSON/],
    ['has another key', JSON.stringify({ trade: ON, lp: ON }), /is not exactly \{ "trade": … \}/],
    ['is a bare block', JSON.stringify(ON), /is not exactly \{ "trade": … \}/],
    ['lacks a field', JSON.stringify({ trade: { ...ON, maxUsd: undefined } }), /without exactly/],
    ['has an extra field', JSON.stringify({ trade: { ...ON, maxGas: 1 } }), /without exactly/],
    ['differs from the bundle', JSON.stringify({ trade: tradeOff() }), /differs from the bundle/],
  ])('fails the build when the file %s', (_why, text, message) => {
    writeFileSync(file, text)
    expect(() => readFlags(file, bundle({ trade: ON }))).toThrow(message)
  })

  it('fails the build for a bundle exported without the switch', () => {
    writeFileSync(file, JSON.stringify({ trade: tradeOff() }))
    expect(() => readFlags(file, bundle())).toThrow(/the bundle has no features.trade/)
  })
})
