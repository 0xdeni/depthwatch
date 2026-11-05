/**
 * docs/ARCHITECTURE.md describes this pipeline, and the numbers in its RPC cost model are derived
 * from constants that live in code: Base's block schedule (`BASE_BLOCK_SCHEDULE`, 200 ms blocks
 * since Denim), the chunk size defaults, the volume window, the factory list, the schedule of
 * `start` and the pipeline steps. These checks pin that prose to the code, so a default that moves
 * fails a test instead of silently dating the page.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BASE_ADDRESSES,
  BASE_BLOCK_SCHEDULE,
  BASE_DENIM_BLOCK,
  DEFAULT_LOG_CHUNK_SIZE,
  DEFAULT_SEED_BATCH,
  DEFAULT_SEED_CONCURRENCY,
  DEFAULT_TIMESTAMP_SPAN,
  msPerBlockAt,
  probesFor,
  REFERENCE_TOKENS,
  swapScanOf,
  TIMESTAMP_CACHE_LIMIT,
  UNISWAP_V3_CANDIDATE_FEES,
  UNISWAP_V4_STANDARD_KEYS,
} from '@depthwatch/chain'
import { DEXES, NATIVE_ETH } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { DEFAULTS, loadConfig, parseCliArgs } from '../config.js'
import { ALCHEMY_CU, ALCHEMY_FREE_CU_PER_MONTH } from '../start/meter.js'
import { SCHEDULE_DEFAULTS } from '../start/settings.js'
import { DAY_SECONDS, HOUR_SECONDS, syncKeys } from './context.js'
import { PIPELINE_STEPS } from './run.js'
import { VOLUME_WINDOWS_BY_TIME } from './volume.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const doc = readFileSync(join(HERE, '..', '..', '..', '..', 'docs', 'ARCHITECTURE.md'), 'utf8')

/** One heading's body up to the next heading, with line wraps collapsed to single spaces. */
function section(heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`${heading} not found in ARCHITECTURE.md`)
  const body = doc.slice(start + heading.length + 2)
  const end = body.search(/\n#{1,3} /)
  return (end < 0 ? body : body.slice(0, end)).replace(/\s+/g, ' ')
}

/** The capture groups of `re` in `text` as bigints (digit-group commas stripped). */
function numbers(text: string, re: RegExp): bigint[] {
  const match = text.match(re)
  if (!match) throw new Error(`expected ${re} in:\n${text}`)
  return match.slice(1).map((n) => BigInt(n.replaceAll(',', '')))
}

/** `getLogs` requests for a range of `blocks` blocks: one per started chunk (internal/logs.ts). */
const chunksFor = (blocks: bigint, chunk: bigint): bigint => (blocks + chunk - 1n) / chunk
/** `n` rounded to the nearest multiple of `step`, as the prose rounds request counts. */
const roundTo = (n: bigint, step: bigint): bigint => ((n + step / 2n) / step) * step
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

const CLI_CHUNK = BigInt(DEFAULTS.logChunkSize)
/** Base's cadence since Denim, from the schedule: 200 ms blocks. */
const MS_PER_BLOCK = BigInt(msPerBlockAt(BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK))
/** Before Denim: 2 s blocks. */
const MS_PER_BLOCK_BEFORE = BigInt(msPerBlockAt(BASE_BLOCK_SCHEDULE, BASE_DENIM_BLOCK - 1n))
const BLOCKS_PER_SECOND = 1_000n / MS_PER_BLOCK
const BLOCKS_PER_HOUR = (BigInt(HOUR_SECONDS) * 1_000n) / MS_PER_BLOCK
const BLOCKS_PER_DAY = 24n * BLOCKS_PER_HOUR
/**
 * Blocks `volumeStep` reads for the default `--hours` (volume.ts): from the first block of the hour
 * that held the time 24 h before the head to the head, both included, so the 24 whole hours and up
 * to one more (the head at the end of its hour). The fewest is one more than 24 hours (the head
 * block itself), which the prose rounds away.
 */
const VOLUME_WINDOW_FEWEST = BigInt(DEFAULTS.hours) * BLOCKS_PER_HOUR
const VOLUME_WINDOW_MOST = (BigInt(DEFAULTS.hours) + 1n) * BLOCKS_PER_HOUR
/**
 * Most blocks a later `run` pass reads per event source (volume.ts `planVolumeScan`): the hour that
 * held the previous head and the blocks of one interval.
 */
const VOLUME_PASS_MAX = BLOCKS_PER_HOUR + BigInt(DEFAULTS.intervalSeconds) * BLOCKS_PER_SECOND
/** Uniswap v3 and both Slipstreams share one scan, both v2 AMMs another: three for six DEXes. */
const SOURCES = BigInt(new Set(DEXES.map(swapScanOf)).size)
/** One discovery log filter per factory, except Aero v2: one over its volatile and stable ones. */
const DISCOVERY_FILTERS = BigInt(
  [
    [BASE_ADDRESSES.uniswapV3.factory],
    [BASE_ADDRESSES.uniswapV4.poolManager],
    [BASE_ADDRESSES.aerodromeV2.poolFactory],
    ...BASE_ADDRESSES.aerodromeSlipstream.map((d) => [d.factory]),
    [BASE_ADDRESSES.aeroV2.volatileFactory, BASE_ADDRESSES.aeroV2.stableFactory],
    ...BASE_ADDRESSES.aeroSlipstream.map((d) => [d.factory]),
  ].length,
)

describe('ARCHITECTURE.md: RPC cost model uses Base cadence and the CLI chunk default', () => {
  const discovery = section('### Discovery: chunked `getLogs`')
  const volume = section('### Volume: chunked `getLogs` on many addresses')
  const cycle = section('### Per cycle')

  it("states Base's cadence since Denim and before it, as the schedule has them", () => {
    const intro = section('## RPC cost model')
    const [ms, hour, day, denim] = numbers(
      intro,
      /five blocks a second, (\d+) ms apart, ([\d,]+) an hour, ([\d,]+) per day, from block ([\d,]+) on/,
    )
    expect([ms, hour, day, denim]).toEqual([
      MS_PER_BLOCK,
      BLOCKS_PER_HOUR,
      BLOCKS_PER_DAY,
      BASE_DENIM_BLOCK,
    ])
    expect(BLOCKS_PER_SECOND).toBe(5n)
    const [seconds, before] = numbers(intro, /one every (\d+) seconds, ([\d,]+) per day/)
    expect(seconds).toBe(MS_PER_BLOCK_BEFORE / 1_000n)
    expect(before).toBe((BigInt(DAY_SECONDS) * 1_000n) / MS_PER_BLOCK_BEFORE)
  })

  it('names the CLI default and 10,000 only as the library default', () => {
    // main.ts always passes config.logChunkSize to createChainReader, so the CLI default rules.
    expect(loadConfig({}).logChunkSize).toBe(DEFAULTS.logChunkSize)
    expect(CLI_CHUNK).not.toBe(DEFAULT_LOG_CHUNK_SIZE)
    const [cli] = numbers(discovery, /The `depthwatch` CLI defaults to ([\d,]+) blocks per chunk/)
    expect(cli).toBe(CLI_CHUNK)
    const [lib] = numbers(discovery, /([\d,]+) is only the library default of `createChainReader`/)
    expect(lib).toBe(DEFAULT_LOG_CHUNK_SIZE)
    expect(discovery).not.toMatch(/\(default 10,000\)/)
  })

  it('sizes a day of incremental discovery at both chunk sizes, and the backfill growth', () => {
    const [chunks, at, libChunks, libAt] = numbers(
      discovery,
      /a day \(([\d,]+) blocks\) in about (\d+) chunks per factory at ([\d,]+) blocks, or about (\d+) at ([\d,]+)/,
    ).slice(1)
    expect(at).toBe(CLI_CHUNK)
    expect(chunks).toBe(chunksFor(BLOCKS_PER_DAY, CLI_CHUNK))
    expect(libAt).toBe(DEFAULT_LOG_CHUNK_SIZE)
    expect(libChunks).toBe(chunksFor(BLOCKS_PER_DAY, DEFAULT_LOG_CHUNK_SIZE))
    expect(numbers(discovery, /a day \(([\d,]+) blocks\)/)[0]).toBe(BLOCKS_PER_DAY)
    const [more, size] = numbers(discovery, /about (\d+) more ([\d,]+)-block requests per factory/)
    expect(more).toBe(chunksFor(BLOCKS_PER_DAY, CLI_CHUNK))
    expect(size).toBe(CLI_CHUNK)
  })

  it('sizes the default 24 h volume window at both chunk sizes', () => {
    expect(DEFAULTS.hours).toBe(24)
    const [hour, fewest, most, chunksFewest, chunksMost, at, libFewest, libMost, libAt] = numbers(
      volume,
      /an hour is ([\d,]+) blocks, so a 24 h window is ([\d,]+) to ([\d,]+) blocks: about (\d+) to (\d+) chunks at the CLI default of ([\d,]+) blocks, or (\d+) to (\d+) at ([\d,]+)/,
    )
    expect(hour).toBe(BLOCKS_PER_HOUR)
    expect([fewest, most]).toEqual([VOLUME_WINDOW_FEWEST, VOLUME_WINDOW_MOST])
    expect(at).toBe(CLI_CHUNK)
    expect(chunksFewest).toBe(chunksFor(VOLUME_WINDOW_FEWEST, CLI_CHUNK))
    expect(chunksMost).toBe(chunksFor(VOLUME_WINDOW_MOST, CLI_CHUNK))
    expect(libAt).toBe(DEFAULT_LOG_CHUNK_SIZE)
    expect(libFewest).toBe(chunksFor(VOLUME_WINDOW_FEWEST, DEFAULT_LOG_CHUNK_SIZE))
    expect(libMost).toBe(chunksFor(VOLUME_WINDOW_MOST, DEFAULT_LOG_CHUNK_SIZE))
    const [before] = numbers(volume, /holds ([\d,]+) blocks for each of its hours of 2 s blocks/)
    expect(before).toBe((BigInt(HOUR_SECONDS) * 1_000n) / MS_PER_BLOCK_BEFORE)
  })

  it('times swaps from the schedule, with the anchor span and the header cache of the reader', () => {
    expect(volume).toContain('`BASE_BLOCK_SCHEDULE`')
    expect(volume).toContain('two to four `eth_getBlockByNumber` a scan')
    const [span] = numbers(volume, /the multiples of ([\d,]+) blocks around the swaps/)
    expect(span).toBe(DEFAULT_TIMESTAMP_SPAN)
    const [cache] = numbers(volume, /keeps up to ([\d,]+) headers \(`TIMESTAMP_CACHE_LIMIT`/)
    expect(cache).toBe(BigInt(TIMESTAMP_CACHE_LIMIT))
  })

  it('starts a later pass exactly at the hour of lastBlock, with no margin', () => {
    expect(volume).toContain('start exactly at the first block of the hour that held `lastBlock`')
    expect(volume).not.toMatch(/margin|VOLUME_JITTER_BLOCKS|VOLUME_MARGIN_BLOCKS/)
    expect(syncKeys.volumeWindows()).toBe('volume:windows')
    expect(volume).toContain(`\`volume:windows\` = \`${VOLUME_WINDOWS_BY_TIME}\``)
  })

  it('counts per-cycle getLogs from the discovery filters, the cadence and the CLI chunk', () => {
    const [discoveryLogs] = numbers(cycle, /(\d+) `getLogs` for discovery/)
    expect(discoveryLogs).toBe(DISCOVERY_FILTERS)
    const [fresh] = numbers(cycle, /([\d,]+) new blocks fit in one chunk at the CLI default/)
    expect(fresh).toBe(BigInt(DEFAULTS.intervalSeconds) * BLOCKS_PER_SECOND)
    expect(fresh).toBeLessThanOrEqual(CLI_CHUNK)
    const [fewest, most] = numbers(
      cycle,
      /(\d+) to (\d+) `getLogs` per event source with tracked pools for volume/,
    )
    expect(fewest).toBe(1n)
    expect(most).toBe(chunksFor(VOLUME_PASS_MAX, CLI_CHUNK))
    expect(numbers(cycle, /at most about ([\d,]+) blocks/)[0]).toBe(VOLUME_PASS_MAX)
    const [first, at] = numbers(cycle, /up to (\d+) `getLogs` per source at ([\d,]+) blocks/)
    expect(first).toBe(chunksFor(VOLUME_WINDOW_MOST, CLI_CHUNK))
    expect(at).toBe(CLI_CHUNK)
  })

  it('sizes volume on a 10-block plan from the window, the hour and the day', () => {
    const free = section('### Rate limits, range limits and free plans')
    const [fewest, most, requestsFewest, requestsMost] = numbers(
      free,
      /`volume` for 24 h is ([\d,]+) to ([\d,]+) blocks since Denim: ([\d,]+) to ([\d,]+) `eth_getLogs` per event source/,
    )
    expect([fewest, most]).toEqual([VOLUME_WINDOW_FEWEST, VOLUME_WINDOW_MOST])
    // The scan is inclusive of both ends; the fewest is the 24 whole hours (the head block adds
    // one request), the most ⌈450 000 / 10⌉.
    const perSourceFewest = VOLUME_WINDOW_FEWEST / 10n
    const perSourceMost = chunksFor(VOLUME_WINDOW_MOST, 10n)
    expect([requestsFewest, requestsMost]).toEqual([perSourceFewest, perSourceMost])
    expect(SOURCES).toBe(3n)
    expect(DEXES).toHaveLength(6)
    const [all, allMost] = numbers(
      free,
      /about ([\d,]+) to ([\d,]+) requests with all six DEXes \(three sources\)/,
    )
    expect(all).toBe(roundTo(SOURCES * perSourceFewest, 1_000n))
    expect(allMost).toBe(roundTo(SOURCES * perSourceMost, 1_000n))
    const cu = BigInt(ALCHEMY_CU.eth_getLogs ?? 0)
    expect(cu).toBe(75n)
    const [units] = numbers(free, /about (\d+) M units\) on a first pass/)
    expect(units).toBe(roundTo(SOURCES * perSourceMost * cu, 1_000_000n) / 1_000_000n)

    const [fiveMinutes, hourAfter, sixHours] = numbers(
      free,
      /up to about ([\d,]+) requests per source for a pass 5 minutes after the last, up to ([\d,]+) an hour after, up to ([\d,]+) six hours after/,
    )
    expect(fiveMinutes).toBe(chunksFor(VOLUME_PASS_MAX, 10n))
    expect(hourAfter).toBe(chunksFor(2n * BLOCKS_PER_HOUR, 10n))
    expect(sixHours).toBe(chunksFor(7n * BLOCKS_PER_HOUR, 10n))

    const [daily, dailyAll] = numbers(
      free,
      /at least ([\d,]+) requests per source a day, about ([\d,]+) a day with three/,
    )
    const perSourceDaily = BLOCKS_PER_DAY / 10n
    expect(daily).toBe(perSourceDaily)
    expect(dailyAll).toBe(roundTo(SOURCES * perSourceDaily, 1_000n))
    const dailyUnits = Number(SOURCES * perSourceDaily * cu)
    const month = free.match(
      /about ([\d.]+) M units a day, so a 30 M-unit month lasts about (\w+) days/,
    )
    expect(month?.[1]).toBe((dailyUnits / 1e6).toFixed(1))
    expect(month?.[2]).toBe(WORDS[Math.floor(ALCHEMY_FREE_CU_PER_MONTH / dailyUnits)])
    // A pass every interval reads the previous head's hour so far (half an hour on average) and
    // the interval: (30 min + 5 min) / 5 min times the blocks of a day.
    const loop = (HOUR_SECONDS / 2 + DEFAULTS.intervalSeconds) / DEFAULTS.intervalSeconds
    expect(free).toContain(`pays the reread hour on every pass, about ${WORDS[loop]} times that`)

    const [short, shortMost] = numbers(
      free,
      /`--hours 1` or `2`: ([\d,]+) to ([\d,]+) requests per source a pass/,
    )
    expect(short).toBe(BLOCKS_PER_HOUR / 10n)
    expect(shortMost).toBe((3n * BLOCKS_PER_HOUR) / 10n)
  })
})

describe('ARCHITECTURE.md: running as a service at the default schedule', () => {
  const passBlocks = BigInt(SCHEDULE_DEFAULTS.snapshotIntervalSeconds) * BLOCKS_PER_SECOND
  const volumeBlocks = BigInt(SCHEDULE_DEFAULTS.volumeIntervalSeconds) * BLOCKS_PER_SECOND
  const perPass = chunksFor(passBlocks, CLI_CHUNK)

  it('counts the discovery requests of a pass at the head', () => {
    const pass = section('### The pass')
    const [every, chunks, minutes, blocks, ms] = numbers(
      pass,
      /one request per filter for every ([\d,]+) blocks since the last pass: (\d+) per filter at the default (\d+) minutes \(([\d,]+) blocks of (\d+) ms\)/,
    )
    expect(every).toBe(CLI_CHUNK)
    expect(chunks).toBe(perPass)
    expect(minutes).toBe(BigInt(SCHEDULE_DEFAULTS.snapshotIntervalSeconds / 60))
    expect(blocks).toBe(passBlocks)
    expect(ms).toBe(MS_PER_BLOCK)
  })

  it('prices volume on Alchemy alone and counts the logs endpoint an hour', () => {
    const budget = section('### Budget at the defaults')
    const [fewest, most] = numbers(
      budget,
      /would read ([\d,]+) to ([\d,]+) blocks per event source an hourly pass/,
    )
    // The new hour, plus none to a whole hour of the previous head's.
    const readFewest = volumeBlocks
    const readMost = volumeBlocks + BLOCKS_PER_HOUR
    expect([fewest, most]).toEqual([readFewest, readMost])
    const cu = BigInt(ALCHEMY_CU.eth_getLogs ?? 0)
    const monthly = (blocks: bigint) =>
      roundTo(((SOURCES * blocks) / 10n) * 24n * 30n * cu, 10_000_000n) / 1_000_000n
    const [low, high] = numbers(budget, /about (\d+) M to (\d+) M units a month for three sources/)
    expect([low, high]).toEqual([monthly(readFewest), monthly(readMost)])

    const passesPerHour = BigInt(HOUR_SECONDS / SCHEDULE_DEFAULTS.snapshotIntervalSeconds)
    expect(passesPerHour).toBe(2n)
    expect(DISCOVERY_FILTERS).toBe(8n)
    const [total, totalMost, chunks, volumeFewest, volumeMost] = numbers(
      budget,
      /about (\d+) to (\d+) `eth_getLogs` an hour once discovery is current \(eight discovery filters, (\d+) chunks each, twice an hour; (\d+) to (\d+) per event source for hourly volume/,
    )
    expect(chunks).toBe(perPass)
    // An hourly pass reads the new hour and from one block to a whole hour of the previous head's.
    const logsFewest = chunksFor(volumeBlocks + 1n, CLI_CHUNK)
    const logsMost = chunksFor(volumeBlocks + BLOCKS_PER_HOUR, CLI_CHUNK)
    expect([volumeFewest, volumeMost]).toEqual([logsFewest, logsMost])
    const discoveryAnHour = DISCOVERY_FILTERS * perPass * passesPerHour
    expect(total).toBe(discoveryAnHour + SOURCES * logsFewest)
    expect(totalMost).toBe(roundTo(discoveryAnHour + SOURCES * logsMost, 5n))
  })
})

describe('ARCHITECTURE.md: positions can run inside `run`', () => {
  it('documents --with-positions as the per-pass opt-in instead of excluding the step', () => {
    expect(PIPELINE_STEPS).toContain('positions')
    expect(parseCliArgs(['run', '--with-positions']).flags.withPositions).toBe(true)
    const positions = section('### Positions')
    expect(positions).toContain('`run --with-positions`')
    expect(positions).toContain('`depthwatch positions`')
    expect(positions).not.toMatch(/rather than inside `run`/)
  })
})

describe('ARCHITECTURE.md: seeded discovery counts', () => {
  const seed = section('### Seeded discovery: factory views and archive state')
  const pairs = (n: number) => BigInt((n * (n - 1)) / 2)

  it('derives the candidate counts from the reference tokens and the seeded tiers', () => {
    const erc20 = REFERENCE_TOKENS.filter((t) => t.address !== NATIVE_ETH).length
    const [tokens, erc20s, erc20Pairs, currencyPairs, v3, v2, aeroV2, v4] = numbers(
      seed,
      /With the (\d+) reference tokens \((\d+) ERC-20s and native ETH\) that is (\d+) ERC-20 pairs and (\d+) currency pairs: ([\d,]+) v3, ([\d,]+) Aerodrome v2, ([\d,]+) Aero v2, ([\d,]+) v4/,
    )
    expect(tokens).toBe(BigInt(REFERENCE_TOKENS.length))
    expect(erc20s).toBe(BigInt(erc20))
    expect(erc20Pairs).toBe(pairs(erc20))
    expect(currencyPairs).toBe(pairs(REFERENCE_TOKENS.length))
    expect(v3).toBe(pairs(erc20) * BigInt(UNISWAP_V3_CANDIDATE_FEES.length))
    expect(v2).toBe(pairs(erc20) * 2n)
    // Two factories, one 2-argument getPool each.
    expect(aeroV2).toBe(pairs(erc20) * 2n)
    expect(v4).toBe(pairs(REFERENCE_TOKENS.length) * BigInt(UNISWAP_V4_STANDARD_KEYS.length))
    const tiers = numbers(
      seed,
      /enabled on Base: (\d+), (\d+), (\d+), (\d+), (\d+), (\d+), (\d+)\)/,
    )
    expect(tiers).toEqual(UNISWAP_V3_CANDIDATE_FEES.map(BigInt))
  })

  it('sizes the creation-block search from the v3 start block and the concurrency', () => {
    const [probes] = numbers(seed, /(\d+) for a Uniswap v3 pool at a head near 53 M/)
    expect(probes).toBe(BigInt(probesFor(BASE_ADDRESSES.uniswapV3.startBlock, 53_000_000n)))
    expect(seed).toContain(`\`DEFAULT_SEED_CONCURRENCY\` (${DEFAULT_SEED_CONCURRENCY})`)
    expect(seed).toContain(`\`DEFAULT_SEED_BATCH\` (${DEFAULT_SEED_BATCH})`)
  })
})
