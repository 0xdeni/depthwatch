/**
 * The documents that name the swap panel's routes and its record on Base: the README's router
 * table under "Swap panel" lists exactly the routers of `TRADE_ROUTES`, with their venue,
 * deployment and hold, linked to Basescan, and its token sentence names every token of
 * `TRADE_TOKENS` and the limits of core; docs/DEPLOY.md dates the switch with a value the switch
 * accepts, and its record of the live test links six transactions and gives the merged Builder
 * Code suffix it found, which decodes to codes that include Depthwatch's.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRADE_ROUTES, TRADE_TOKENS } from '@depthwatch/chain'
import { TRADE_LAUNCH_MAX_USD, TRADE_MAX_SLIPPAGE_BPS } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import { parseTradeSwitch } from './tradeSwitch.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), 'utf8')
const flat = (text: string) => text.replace(/\s+/g, ' ')
/** `doc` from `from` up to `to`, both of which must be there. */
const between = (doc: string, from: string, to: string) => {
  const start = doc.indexOf(from)
  const end = doc.indexOf(to, start)
  if (start < 0 || end < 0) throw new Error(`${from} … ${to} not found`)
  return doc.slice(start, end)
}
/** The link reference definitions of `doc`: label → URL. */
const references = (doc: string) =>
  new Map([...doc.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((m) => [m[1] ?? '', m[2] ?? '']))

describe('README: the routers of the swap panel', () => {
  const readme = read('README.md')
  const panel = between(readme, '**Swap panel.**', '\n## ')
  const links = references(readme)

  it('lists exactly the routers of TRADE_ROUTES, each with its hold, linked to Basescan', () => {
    const rows = panel
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => {
        const [venue, deployment, router, held] = line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim())
        const link = /^\[`(0x[0-9a-fA-F]{40})`\]\[([^\]]+)\]$/.exec(router ?? '')
        return {
          venue: venue?.replaceAll('`', ''),
          deployment: deployment?.replaceAll('`', ''),
          router: link?.[1]?.toLowerCase(),
          url: links.get(link?.[2] ?? '')?.toLowerCase(),
          held,
        }
      })
    expect(rows).toEqual(
      TRADE_ROUTES.map((route) => ({
        venue: route.venue,
        deployment: route.deployment,
        router: route.router.toLowerCase(),
        url: `https://basescan.org/address/${route.router.toLowerCase()}`,
        held: route.hold === null ? 'no' : 'yes',
      })),
    )
  })

  it('names every trade token and the limits set in core', () => {
    const text = flat(panel)
    for (const token of TRADE_TOKENS) expect(text, token.symbol).toContain(token.symbol)
    expect(text).toContain('only in a pool whose two tokens are both in `TRADE_TOKENS`')
    expect(text).toContain(
      `caps a swap at $${TRADE_LAUNCH_MAX_USD.toLocaleString('en-US')} and ${TRADE_MAX_SLIPPAGE_BPS / 100} % slippage`,
    )
  })
})

describe('docs/DEPLOY.md: the switch turned on, and the live test', () => {
  const deploy = read('docs', 'DEPLOY.md')
  const record = between(deploy, '### The live test', '### Changing the switch')

  it('dates the switch with a value the switch accepts and the limits of core', () => {
    const text = flat(between(deploy, '## Trade switch', '### Before switching on'))
    const value = /`DEPTHWATCH_TRADE` was set to `([^`]+)`/.exec(text)?.[1] ?? ''
    expect(text).toContain("On 8 November 2026 the production site's switch was turned on")
    expect(parseTradeSwitch(value).venues).toEqual(['uniswap-v3', 'aerodrome-slipstream'])
    expect(text).toContain(
      `"maxUsd":${TRADE_LAUNCH_MAX_USD}\` and \`"maxSlippageBps":${TRADE_MAX_SLIPPAGE_BPS}`,
    )
    const gates = flat(between(deploy, '### Before switching on', '### The live test'))
    expect(gates).toContain('makes its swaps on the production site instead, with the same checks')
    expect(gates).toContain('[The live test](#the-live-test)')
  })

  it('links the six transactions on Basescan, each from its row', () => {
    const links = references(record)
    const hashes = [1, 2, 3, 4, 5, 6].map((n) => {
      const url = links.get(`live-${n}`) ?? ''
      const hash = /^https:\/\/basescan\.org\/tx\/(0x[0-9a-f]{64})$/.exec(url)?.[1]
      expect(hash, `live-${n}`).toBeDefined()
      expect(record).toMatch(new RegExp(`^\\| ${n} .*\\]\\[live-${n}\\] +\\|`, 'm'))
      return hash
    })
    expect(new Set(hashes).size).toBe(6)
  })

  it('gives the merged suffix it found, which decodes to codes that include ours', () => {
    const builder = read('apps', 'web', 'src', 'trade', 'builderCode.ts')
    const code = /BUILDER_CODE = '([^']+)'/.exec(builder)?.[1] ?? ''
    const ours = /BUILDER_SUFFIX: Hex = '0x([0-9a-f]+)'/.exec(builder)?.[1] ?? ''
    const merged = /`0x([0-9a-f]+8021802180218021)`/.exec(record)?.[1] ?? ''
    const marker = '80218021802180218021802180218021'
    expect(merged.endsWith(`00${marker}`)).toBe(true)
    const length = Number.parseInt(merged.slice(-36, -34), 16)
    expect(merged.length).toBe(2 * (length + 2) + marker.length)
    const codes = Buffer.from(merged.slice(0, 2 * length), 'hex')
      .toString('latin1')
      .split(',')
    expect(codes).toContain(code)
    expect(codes.length).toBeGreaterThan(1)
    expect(merged).not.toContain(ours)
    const text = flat(record)
    expect(text).toContain(`\`${codes.join(',')}\``)
    expect(text).toContain('must therefore decode the ERC-8021 suffix')
    expect(text).toContain('Not covered live: an extension wallet')
  })
})
