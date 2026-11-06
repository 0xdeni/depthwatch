/**
 * The README's first steps and measured figures match what the CLI does. Its Quick start opens
 * with the seed, which reads factory views, rather than a factory-log scan, whose cost it states
 * from the factories' start blocks at a dated head and Base's 200 ms blocks since Denim; its status
 * points at a dated record of what has run on Base; and its free-RPC volume cost quotes the same
 * first-pass figure as docs/ARCHITECTURE.md, three event sources for six DEXes.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE_ADDRESSES,
  BASE_BLOCK_SCHEDULE,
  BASE_DENIM_BLOCK,
  msPerBlockAt,
  swapScanOf,
} from '@depthwatch/chain'
import { DEXES, type Dex } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { DEFAULTS } from './config.js'
import { defaultStartBlock } from './pipeline/discover.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const architecture = readFileSync(join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')

/** The body of `heading` up to the next heading of any level. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`${heading} not found`)
  const body = doc.slice(start + heading.length + 2)
  const end = body.search(/\n#{1,6} /)
  return end < 0 ? body : body.slice(0, end)
}

/** The same text with line wraps collapsed to single spaces. */
const flat = (text: string) => text.replace(/\s+/g, ' ')
/** `n` rounded to the nearest multiple of `step`, with digit-group commas. */
const about = (n: bigint, step: bigint) => (((n + step / 2n) / step) * step).toLocaleString('en-US')
const chunksFor = (blocks: bigint, chunk: bigint): bigint => (blocks + chunk - 1n) / chunk

const MEASURED = '### Measured on Base, 2026-10-25'
const CLI_CHUNK = BigInt(DEFAULTS.logChunkSize)
const BLOCKS_PER_HOUR = 3_600_000n / BigInt(msPerBlockAt(BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK))
/** The head the Quick start dates its first-discover figure at: 53.6 M, 5 November 2026. */
const HEAD = 53_600_000n
/** Log filters a DEX's discovery scans: one per factory, one over Aero v2's two. */
const FILTERS: Readonly<Record<Dex, number>> = {
  'uniswap-v3': 1,
  'uniswap-v4': 1,
  'aerodrome-v2': 1,
  'aerodrome-slipstream': BASE_ADDRESSES.aerodromeSlipstream.length,
  'aero-v2': 1,
  'aero-slipstream': BASE_ADDRESSES.aeroSlipstream.length,
}
/** Requests of a first `discover` at `HEAD`: each filter from its DEX's start block. */
const FIRST_DISCOVER = DEXES.reduce(
  (sum, dex) =>
    sum +
    BigInt(FILTERS[dex]) * chunksFor(HEAD - defaultStartBlock(BASE_ADDRESSES, dex) + 1n, CLI_CHUNK),
  0n,
)
const FILTER_COUNT = BigInt(Object.values(FILTERS).reduce((a, b) => a + b, 0))

describe('README: Quick start', () => {
  const quickStart = section(readme, '## Quick start')

  it('runs the seed first, not a factory-log scan', () => {
    const commands = [...quickStart.matchAll(/^pnpm depthwatch (\S+(?: --\S+)*)/gm)].map(
      (m) => m[1],
    )
    expect(commands[0]).toBe('discover --seed')
    expect(commands.slice(1, 5)).toEqual(['snapshot', 'volume', 'score', 'serve'])
  })

  it('says what a plain discover costs at a dated head, and how fast that grows', () => {
    expect(FILTER_COUNT).toBe(8n)
    const figure = about(FIRST_DISCOVER, 1_000n)
    expect(flat(quickStart)).toContain(
      `about ${figure} \`eth_getLogs\` at the default 2,000-block chunks at a head of 53.6 M (5 November 2026)`,
    )
    // At the public endpoint's 5 requests a second.
    const hours = Math.round(Number(FIRST_DISCOVER) / 5 / 3_600)
    expect(flat(quickStart)).toContain(`about ${hours} hours at the public endpoint's rate`)
    const daily = FILTER_COUNT * chunksFor(24n * BLOCKS_PER_HOUR, CLI_CHUNK)
    expect(flat(quickStart)).toContain(`grows by about ${about(daily, 100n)} requests a day`)
    expect(flat(architecture)).toContain(`about ${figure} requests at a head of 53.6 M`)
  })
})

describe('README: what has run on Base', () => {
  it('has the dated record, and the status paragraph links to it', () => {
    expect(readme).toContain(`\n${MEASURED}\n`)
    const status = flat(readme.slice(readme.indexOf('**Status:'), readme.indexOf('\n## ')))
    expect(status).toContain('(#measured-on-base-2026-10-25)')
    expect(status).toMatch(/not yet validated against Base mainnet at scale/)
  })

  it('records the seed and volume counters and what was not covered', () => {
    const measured = flat(section(readme, MEASURED))
    for (const figure of ['580 pools', '13,399', '1,968', '492 pools', '267,572', '18,131'])
      expect(measured).toContain(figure)
    expect(measured).toMatch(/no 7-day run and no swap cross-check/)
  })

  it('says the records ran on 2 s blocks, before Denim', () => {
    expect(flat(section(readme, MEASURED))).toContain("ran on Base's 2 s blocks, before Denim")
  })
})

describe('README and docs/ARCHITECTURE.md: volume cost on a 10-block plan', () => {
  const freeRpc = flat(section(readme, '### Running on a free RPC'))

  it('counts per event source, three for six DEXes, not per DEX', () => {
    expect(freeRpc).toMatch(
      /per 10 blocks per event source \(three for six DEXes: Uniswap v3 and both Slipstreams share one, Aerodrome v2 and Aero v2 another\)/,
    )
    expect(new Set(DEXES.map(swapScanOf)).size).toBe(3)
    expect(freeRpc).toContain('with all six DEXes tracked')
    expect(freeRpc).not.toMatch(/per DEX/)
  })

  it('quotes the same first-pass request figure as the architecture notes', () => {
    // 24 h of 200 ms blocks: 24 whole hours to 25 (the head at the end of its hour), at 10 blocks
    // a request, for three event sources.
    const fewest = (3n * 24n * BLOCKS_PER_HOUR) / 10n
    const most = (3n * 25n * BLOCKS_PER_HOUR) / 10n
    const figure = `about ${about(fewest, 1_000n)} to ${about(most, 1_000n)} requests`
    expect(figure).toBe('about 130,000 to 135,000 requests')
    expect(freeRpc).toContain(figure)
    expect(flat(architecture)).toContain(figure)
  })

  it('suggests 1,000-block chunks on Tenderly, as the Refresh site workflow uses', () => {
    expect(freeRpc).toContain('`DEPTHWATCH_LOG_CHUNK=1000`')
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'refresh-site.yml'), 'utf8')
    expect(workflow).toMatch(/gateway\.tenderly\.co\/public\/base pass \d+s 1000\b/)
    expect(freeRpc).toContain('The Refresh site workflow uses 1,000')
  })
})
