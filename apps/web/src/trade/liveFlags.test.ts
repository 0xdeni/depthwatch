/**
 * The trade switch as the panel reads it on the site, the only live read of the kill switch: the
 * file next to the bundle that the build writes, fetched past the browser's cache, and anything but
 * a successful answer of exactly `{ "trade": … }` is off. `switchFor` turns a read that throws
 * into off as well.
 */
import type { TradeFlags } from '@depthwatch/core'
import { describe, expect, it, vi } from 'vitest'
import { STATIC_FLAGS_PATH } from '../../plugins/staticFlags.js'
import { switchFor } from './flow.js'
import { fetchLiveFlags, TRADE_FLAGS_URL } from './liveFlags.js'

const ON: TradeFlags = { enabled: true, venues: ['uniswap-v3'], maxUsd: 1000, maxSlippageBps: 300 }

/** A fetch that answers `body` with `status`, recording what it was asked. */
function answer(body: string, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status }))
}

describe('fetchLiveFlags', () => {
  it('fetches the file the build writes, past the browser’s cache', async () => {
    const fetcher = answer(JSON.stringify({ trade: ON }))
    await fetchLiveFlags(fetcher as unknown as typeof fetch)
    expect(TRADE_FLAGS_URL).toBe('./data/flags.json')
    expect(TRADE_FLAGS_URL).toBe(`./${STATIC_FLAGS_PATH}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('./data/flags.json', { cache: 'no-store' })
  })

  it('reads exactly { trade } of a successful answer', async () => {
    expect(await fetchLiveFlags(answer(JSON.stringify({ trade: ON })) as never)).toEqual(ON)
  })

  it('reads an error answer as off, whatever its body says', async () => {
    for (const status of [404, 500])
      expect(
        await fetchLiveFlags(answer(JSON.stringify({ trade: ON }), status) as never),
      ).toBeNull()
  })

  it('reads any other shape as off', async () => {
    for (const body of [
      { trade: { ...ON, enabled: 'false' } },
      { trade: ON, extra: 1 },
      ON,
      { trade: null },
    ])
      expect(
        await fetchLiveFlags(answer(JSON.stringify(body)) as never),
        JSON.stringify(body),
      ).toBeNull()
  })

  it('rejects a body that is not JSON, such as a page served in its place', async () => {
    await expect(
      fetchLiveFlags(answer('<!doctype html><title>Depthwatch</title>') as never),
    ).rejects.toThrow()
  })
})

describe('switchFor', () => {
  it('is on for the venue when the switch at load and the one read now are on', async () => {
    expect(await switchFor(ON, async () => ON, 'uniswap-v3')).toEqual(ON)
  })

  it('is off when the read throws, or its answer is not JSON', async () => {
    expect(
      await switchFor(ON, () => Promise.reject(new TypeError('network')), 'uniswap-v3'),
    ).toBeNull()
    const page = () => fetchLiveFlags(answer('<!doctype html>') as never)
    expect(await switchFor(ON, page, 'uniswap-v3')).toBeNull()
  })
})
