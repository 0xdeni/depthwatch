/**
 * RPC URLs carry API keys (`https://base-mainnet.g.alchemy.com/v2/<key>`), and viem names the URL
 * in its error messages. Whatever fails, neither stderr nor a log line may show the key: error text
 * keeps only each URL's origin. Driven through `main` over viem's real HTTP transport and a stubbed
 * `fetch` (no network).
 */
import {
  BASE_STOCKS,
  createFakeRpcFetch,
  createFixture,
  type Fixture,
  registerSeedWorld,
  resolveAddresses,
  setClock,
  TOKENS,
} from '@depthwatch/chain'
import type { Address } from '@depthwatch/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from './log.js'
import { EXIT_ERROR, main } from './main.js'

const KEY = 'SECRETKEY0123456789'
const ORIGIN = 'https://base-mainnet.g.alchemy.com'
const KEYED_URL = `${ORIGIN}/v2/${KEY}`

function seedWorld(): Fixture {
  const fixture = createFixture()
  setClock(fixture, { latestBlock: 45_000_000n, latestTimestamp: 1_800_000_000 })
  registerSeedWorld(fixture, {
    addresses: resolveAddresses(),
    // `main`'s reader seeds the ten stocks as cross tokens; none of them has a pool here.
    crossTokens: BASE_STOCKS.tokens,
    pools: [
      {
        dex: 'uniswap-v3',
        tokens: [TOKENS.WETH.address, TOKENS.USDC.address],
        fee: 500,
        address: `0x${'3001'.padStart(40, '0')}` as Address,
        createdAtBlock: 2_000_123n,
      },
    ],
  })
  return fixture
}

/** `main` with every request answered by `fetch`; returns the exit code, stderr and log lines. */
async function run(argv: string[], fetch: typeof globalThis.fetch) {
  vi.stubGlobal('fetch', fetch)
  const stderr: string[] = []
  const lines: string[] = []
  const code = await main(argv, {
    env: { DEPTHWATCH_RPC_URL: KEYED_URL },
    log: createLogger({ level: 'debug', write: (line) => lines.push(line) }),
    stdout: () => {},
    stderr: (line) => stderr.push(line),
  })
  return { code, stderr, lines }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RPC URLs never reach stderr or the log', () => {
  it('a seed probe rate limited until its retries run out', async () => {
    const fake = createFakeRpcFetch(seedWorld())
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method?: string }
      if (body.method === 'eth_getCode')
        return new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '0' } })
      return fake.fetch(input, init)
    }
    const { code, stderr, lines } = await run(
      ['discover', '--seed', '--db', ':memory:', '--dex', 'uniswap-v3'],
      fetch as typeof globalThis.fetch,
    )
    expect(code).toBe(EXIT_ERROR)
    expect(stderr.join('\n')).toMatch(/still rate limited after 8 retries/)
    expect(stderr.join('\n')).toContain(`URL: ${ORIGIN} `)
    expect(lines.filter((l) => l.includes('rpc backoff'))).toHaveLength(8)
    for (const line of [...stderr, ...lines]) expect(line).not.toContain(KEY)
  })

  it('an eth_getLogs refused with HTTP 401', async () => {
    const fake = createFakeRpcFetch(seedWorld(), {
      getLogs: () => new Response('Unauthorized', { status: 401 }),
    })
    const { code, stderr, lines } = await run(
      ['discover', '--db', ':memory:', '--dex', 'uniswap-v3', '--from-block', '1'],
      fake.fetch as typeof globalThis.fetch,
    )
    expect(code).toBe(EXIT_ERROR)
    expect(stderr.join('\n')).toMatch(/discover failed for 1\/1 dexes: uniswap-v3 .*Status: 401/)
    expect(lines.some((l) => l.includes('discovery failed') && l.includes(ORIGIN))).toBe(true)
    for (const line of [...stderr, ...lines]) expect(line).not.toContain(KEY)
  })
})
