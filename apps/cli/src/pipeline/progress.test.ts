import { describe, expect, it } from 'vitest'
import { createLogger } from '../log.js'
import {
  chunkProgress,
  createProgressReporter,
  formatDuration,
  PROGRESS_INTERVAL_MS,
} from './progress.js'

function reporter(total: number) {
  const lines: string[] = []
  let now = 1_000_000
  const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
  const progress = createProgressReporter({ log, message: 'scan', total, clock: () => now })
  const advance = (ms: number) => {
    now += ms
  }
  return { lines, progress, advance }
}

describe('createProgressReporter', () => {
  it('logs at most once per 30 s with done/total, %, elapsed, ETA and extra fields', () => {
    const { lines, progress, advance } = reporter(4_531)
    progress.update(10)
    advance(PROGRESS_INTERVAL_MS - 1)
    progress.update(200)
    expect(lines).toEqual([]) // nothing before the first 30 s
    advance(1)
    progress.update(453, { rateLimited: 2 })
    expect(lines).toEqual([
      '1970-01-01T00:00:00.000Z INFO  scan done=453/4531 pct=10.0% elapsed=30s eta=4m30s rateLimited=2',
    ])
    advance(10_000)
    progress.update(600)
    expect(lines).toHaveLength(1)
    advance(20_000)
    progress.update(4_531)
    expect(lines[1]).toContain('done=4531/4531 pct=100.0% elapsed=1m00s eta=0s')
  })

  it('names the done/total field after the unit', () => {
    const lines: string[] = []
    let now = 0
    const log = createLogger({ write: (line) => lines.push(line), now: () => new Date(0) })
    const progress = createProgressReporter({
      log,
      message: 'scan',
      unit: 'blocks',
      total: 45_301,
      intervalMs: 0,
      clock: () => now,
    })
    now = 10_000
    progress.update(9_060, { chunks: 9 })
    expect(lines).toEqual([
      '1970-01-01T00:00:00.000Z INFO  scan blocks=9060/45301 pct=20.0% elapsed=10s eta=40s chunks=9',
    ])
  })

  it('shows at most 99.9 % until the last unit is done', () => {
    const { lines, progress, advance } = reporter(446_006)
    advance(PROGRESS_INTERVAL_MS)
    progress.update(446_000)
    advance(PROGRESS_INTERVAL_MS)
    progress.update(446_006)
    expect(lines[0]).toContain('done=446000/446006 pct=99.9% ')
    expect(lines[1]).toContain('done=446006/446006 pct=100.0% ')
  })
})

describe('formatDuration', () => {
  it('reads seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(59_400)).toBe('59s')
    expect(formatDuration(95_000)).toBe('1m35s')
    expect(formatDuration(37 * 60_000)).toBe('37m00s')
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2h05m')
    expect(formatDuration(null)).toBeNull()
  })
})

describe('chunkProgress', () => {
  it('estimates the total from --log-chunk until a chunk is served', () => {
    expect(chunkProgress(0, 0, 45_301, 10)).toBe('0/4531')
    expect(chunkProgress(0, 0, 0, 10)).toBe('0/0')
  })

  it('follows the span the provider actually serves', () => {
    // --log-chunk 2 000 on an endpoint capped at 1 000 blocks: 46 chunks for 45 301 blocks.
    expect(chunkProgress(1, 1_000, 44_301, 2_000)).toBe('1/46')
    expect(chunkProgress(46, 45_301, 0, 2_000)).toBe('46/46')
    // Three parallel scans at 10 blocks: the done count and the total both span all of them.
    expect(chunkProgress(559, 5_590, 19_704 - 5_590, 10)).toBe('559/1971')
  })
})
