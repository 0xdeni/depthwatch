/**
 * The trade switch (docs/DEPLOY.md, "Trade switch"): DEPTHWATCH_TRADE is parsed strictly, an
 * invalid value fails closed and loudly (`export` writes the switch off, then exits 3), and every
 * export writes the same block into the bundle's `features.trade` and into `flags.json` next to
 * it. `export --bundle` writes an exported bundle again with only `features` changed.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEED_NOW, type StaticBundle, seedDatabase } from '@depthwatch/api'
import { TRADE_ROUTES } from '@depthwatch/chain'
import {
  parseFlagsFile,
  parseTradeFlags,
  TRADE_LAUNCH_MAX_USD,
  TRADE_MAX_SLIPPAGE_BPS,
  tradeOff,
} from '@depthwatch/core'
import { openDatabase } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type CliFlags, ConfigError, loadConfig, parseCliArgs } from './config.js'
import { ExportError, exportCommand } from './export.js'
import { silentLogger } from './log.js'
import { EXIT_TRADE_REFUSED, main } from './main.js'
import {
  describeTrade,
  exportedTradeSwitch,
  parseTradeSwitch,
  switchableVenues,
  TRADE_SWITCH_VENUES,
  TradeSwitchRefusedError,
  venueHold,
} from './tradeSwitch.js'

const ON_UNISWAP = {
  enabled: true,
  venues: ['uniswap-v3'],
  maxUsd: TRADE_LAUNCH_MAX_USD,
  maxSlippageBps: TRADE_MAX_SLIPPAGE_BPS,
}

describe('parseTradeSwitch', () => {
  it('is off when unset, empty or off', () => {
    for (const raw of [undefined, '', '   ', 'off', 'OFF', ' Off '])
      expect(parseTradeSwitch(raw)).toEqual(tradeOff())
    expect(tradeOff()).toEqual({ enabled: false, venues: [], maxUsd: 1000, maxSlippageBps: 300 })
  })

  it('turns on the listed venues with the launch limits, in route order', () => {
    expect(parseTradeSwitch('uniswap-v3')).toEqual(ON_UNISWAP)
    expect(parseTradeSwitch(' Aerodrome-Slipstream , uniswap-v3,uniswap-v3,')).toEqual({
      ...ON_UNISWAP,
      venues: ['uniswap-v3', 'aerodrome-slipstream'],
    })
  })

  it('knows the venues of the trade routes, and which of them are held', () => {
    expect(TRADE_SWITCH_VENUES).toEqual(['uniswap-v3', 'aerodrome-slipstream', 'aero-slipstream'])
    expect(switchableVenues()).toEqual(['uniswap-v3', 'aerodrome-slipstream'])
    const aero = TRADE_ROUTES.find((route) => route.venue === 'aero-slipstream')
    expect(venueHold('aero-slipstream')).toBe(aero?.hold)
    expect(venueHold('uniswap-v3')).toBeNull()
  })

  it.each([
    ['a typo', 'uniswap-v33', 'unknown trade venue "uniswap-v33"'],
    ['one unknown among known', 'uniswap-v3,sushiswap', 'unknown trade venue "sushiswap"'],
    ['an indexed DEX with no route', 'uniswap-v4', 'unknown trade venue "uniswap-v4"'],
    ['on', 'on', 'unknown trade venue "on"'],
    ['true', 'true', 'unknown trade venue "true"'],
    ['off inside a list', 'off,uniswap-v3', 'unknown trade venue "off"'],
    ['a misspelt off', 'of', 'unknown trade venue "of"'],
    ['a list with no venue', ' , ,', 'no trade venue in ", ,"'],
  ])('refuses %s with a ConfigError naming it', (_why, raw, message) => {
    expect(() => parseTradeSwitch(raw)).toThrow(ConfigError)
    expect(() => parseTradeSwitch(raw)).toThrow(message)
    expect(() => parseTradeSwitch(raw)).toThrow(
      'expected off, or a comma-separated list of uniswap-v3, aerodrome-slipstream',
    )
  })

  it('refuses a venue whose every route is on hold, saying why', () => {
    expect(() => parseTradeSwitch('uniswap-v3,aero-slipstream')).toThrow(
      /DEPTHWATCH_TRADE: trade venue "aero-slipstream" is on hold in the code \(Aero's contracts page not yet confirmed in a browser/,
    )
  })

  it('gives export the switch off, with the refusal, for a value it refuses', () => {
    expect(exportedTradeSwitch('of')).toEqual({
      trade: tradeOff(),
      refused: expect.stringMatching(/^DEPTHWATCH_TRADE: unknown trade venue "of"/),
    })
    expect(exportedTradeSwitch('uniswap-v3')).toEqual({ trade: ON_UNISWAP, refused: null })
    expect(exportedTradeSwitch(undefined)).toEqual({ trade: tradeOff(), refused: null })
  })

  it('writes a block the dashboard reader accepts', () => {
    for (const raw of [undefined, 'uniswap-v3', 'aerodrome-slipstream,uniswap-v3']) {
      const trade = parseTradeSwitch(raw)
      expect(parseTradeFlags(JSON.parse(JSON.stringify(trade)))).toEqual(trade)
    }
  })

  it('describes itself in one line', () => {
    expect(describeTrade(tradeOff())).toBe('trade off')
    expect(describeTrade(parseTradeSwitch('uniswap-v3'))).toBe(
      'trade on for uniswap-v3 (at most $1000 and 300 bps of slippage a swap)',
    )
  })
})

describe('export with DEPTHWATCH_TRADE', () => {
  let dir = ''
  let db = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-trade-'))
    db = join(dir, 'live.db')
    const seeded = openDatabase(db)
    try {
      seedDatabase(seeded)
    } finally {
      seeded.close()
    }
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const run = (env: Record<string, string>, flags: CliFlags) =>
    exportCommand({
      config: loadConfig({ DEPTHWATCH_DB: db, ...env }, flags),
      log: silentLogger,
      stdout: () => {},
      now: () => SEED_NOW,
    })

  it('writes the same block into the bundle and into flags.json', async () => {
    const out = join(dir, 'site', 'bundle.json')
    const result = await run({ DEPTHWATCH_TRADE: 'uniswap-v3' }, { out })
    const written = JSON.parse(readFileSync(out, 'utf8')) as StaticBundle
    expect(written.features).toEqual({ trade: ON_UNISWAP })
    expect(result.bundle.features).toEqual({ trade: ON_UNISWAP })
    const flags: unknown = JSON.parse(readFileSync(join(dir, 'site', 'flags.json'), 'utf8'))
    expect(flags).toEqual({ trade: ON_UNISWAP })
    expect(parseFlagsFile(flags)).toEqual(parseTradeFlags(written.features?.trade))
  })

  it('writes the switch off for an invalid value, then fails: main exits 3 naming it', async () => {
    const out = join(dir, 'bundle.json')
    const readOut = () => ({
      bundle: (JSON.parse(readFileSync(out, 'utf8')) as StaticBundle).features,
      flags: JSON.parse(readFileSync(join(dir, 'flags.json'), 'utf8')) as unknown,
    })
    await expect(run({ DEPTHWATCH_TRADE: 'uniswap' }, { out })).rejects.toThrow(
      TradeSwitchRefusedError,
    )
    expect(readOut()).toEqual({ bundle: { trade: tradeOff() }, flags: { trade: tradeOff() } })
    const errors: string[] = []
    const lines: string[] = []
    const code = await main(['export', '--out', out], {
      env: { DEPTHWATCH_DB: db, DEPTHWATCH_TRADE: 'aero-slipstream' },
      log: silentLogger,
      stdout: (line) => lines.push(line),
      stderr: (line) => errors.push(line),
      signal: new AbortController().signal,
    })
    expect(code).toBe(EXIT_TRADE_REFUSED)
    expect(code).toBe(3)
    expect(errors).toEqual([
      expect.stringMatching(
        /^error: DEPTHWATCH_TRADE: trade venue "aero-slipstream" is on hold .*; wrote the trade switch off instead$/,
      ),
    ])
    expect(lines[0]).toMatch(/; trade off \(DEPTHWATCH_TRADE refused\)$/)
    expect(readOut()).toEqual({ bundle: { trade: tradeOff() }, flags: { trade: tradeOff() } })
  })

  it('turns a published switch off when a later value is mistyped (a misspelt off)', async () => {
    const first = join(dir, 'site', 'bundle.json')
    await run({ DEPTHWATCH_TRADE: 'uniswap-v3' }, { out: first })
    expect(JSON.parse(readFileSync(join(dir, 'site', 'flags.json'), 'utf8'))).toEqual({
      trade: ON_UNISWAP,
    })
    const code = await main(['export', '--bundle', first, '--out', first], {
      env: { DEPTHWATCH_DB: join(dir, 'missing.db'), DEPTHWATCH_TRADE: 'of' },
      log: silentLogger,
      stdout: () => {},
      stderr: () => {},
      signal: new AbortController().signal,
    })
    expect(code).toBe(3)
    const bundle = JSON.parse(readFileSync(first, 'utf8')) as StaticBundle
    expect(bundle.features).toEqual({ trade: tradeOff() })
    expect(JSON.parse(readFileSync(join(dir, 'site', 'flags.json'), 'utf8'))).toEqual({
      trade: tradeOff(),
    })
  })

  it('refuses an --out that flags.json would overwrite', async () => {
    await expect(run({}, { out: join(dir, 'flags.json') })).rejects.toThrow(
      new ConfigError(
        '--out cannot be named flags.json: export writes that file next to the bundle',
      ),
    )
  })

  it('--bundle writes an exported bundle again with only its features changed', async () => {
    const first = join(dir, 'published.json')
    await exportCommand({
      config: loadConfig({ DEPTHWATCH_DB: db }, { out: first, note: 'Read at block 1.' }),
      log: silentLogger,
      stdout: () => {},
      now: () => SEED_NOW,
    })
    const before = JSON.parse(readFileSync(first, 'utf8')) as StaticBundle
    expect(before.features).toEqual({ trade: tradeOff() })
    const out = join(dir, 'site', 'bundle.json')
    const lines: string[] = []
    const { flags } = parseCliArgs(['export', '--bundle', first, '--out', out])
    // No database is read: DEPTHWATCH_DB points nowhere.
    const result = await exportCommand({
      config: loadConfig(
        { DEPTHWATCH_DB: join(dir, 'missing.db'), DEPTHWATCH_TRADE: 'uniswap-v3' },
        flags,
      ),
      log: silentLogger,
      stdout: (line) => lines.push(line),
    })
    const after = JSON.parse(readFileSync(out, 'utf8')) as StaticBundle
    expect(after).toEqual({ ...before, features: { trade: ON_UNISWAP } })
    expect(after.note).toBe('Read at block 1.')
    expect(JSON.parse(readFileSync(join(dir, 'site', 'flags.json'), 'utf8'))).toEqual({
      trade: ON_UNISWAP,
    })
    expect(existsSync(join(dir, 'missing.db'))).toBe(false)
    expect(lines).toEqual([
      `exported live bundle to ${out} from ${first}, features only: ${before.pools.length} pools, ` +
        `${result.bytes} bytes; trade on for uniswap-v3 (at most $1000 and 300 bps of slippage a swap)`,
    ])
  })

  it('--bundle refuses a file that is not a v1 bundle, writing nothing', async () => {
    const bad = join(dir, 'bad.json')
    const out = join(dir, 'out', 'bundle.json')
    writeFileSync(bad, JSON.stringify({ v: 2, source: 'live', generatedAt: 1, pools: [] }))
    await expect(run({}, { bundle: bad, out })).rejects.toThrow(
      new ExportError(`export: ${bad} is not a v1 Depthwatch static bundle`),
    )
    writeFileSync(bad, '{"v":1,')
    await expect(run({}, { bundle: bad, out })).rejects.toThrow(/cannot read the bundle/)
    expect(existsSync(out)).toBe(false)
  })

  it('takes --bundle on export only, without --demo or --note', () => {
    expect(parseCliArgs(['export', '--bundle', 'a.json', '--out', 'b.json']).flags.bundle).toBe(
      'a.json',
    )
    expect(() => parseCliArgs(['snapshot', '--bundle', 'a.json'])).toThrow(
      new ConfigError('--bundle only applies to export'),
    )
    expect(() => parseCliArgs(['export', '--bundle', ' '])).toThrow(
      new ConfigError('--bundle needs a file path'),
    )
    for (const extra of [['--demo'], ['--note', 'x']])
      expect(() => parseCliArgs(['export', '--bundle', 'a.json', ...extra])).toThrow(
        /--bundle keeps the data and note of the bundle it reads/,
      )
  })

  it('leaves every other command alone, whatever the variable holds', () => {
    expect(loadConfig({ DEPTHWATCH_TRADE: 'nonsense' }).tradeSwitch).toBe('nonsense')
    expect(loadConfig({ DEPTHWATCH_TRADE: '  ' }).tradeSwitch).toBeUndefined()
  })
})

describe('the trade switch in docs/DEPLOY.md and the workflows', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const read = (...path: string[]) => readFileSync(join(ROOT, ...path), 'utf8')
  const deploy = read('docs', 'DEPLOY.md')
  const section = deploy
    .slice(deploy.indexOf('## Trade switch'), deploy.indexOf('## Upgrading'))
    .replace(/\s+/g, ' ')

  it('lists the gates to pass before switching on, ahead of the steps that switch on', () => {
    const gates = section.indexOf('### Before switching on')
    expect(gates).toBeGreaterThan(0)
    expect(gates).toBeLessThan(section.indexOf('set it to the venues'))
    const list = section.slice(gates, section.indexOf('### Changing the switch'))
    for (const gate of ['switch-agnostic', 'fork test', 'live test'])
      expect(list, gate).toContain(gate)
    expect(list).toContain('the only values to use are unset (the default) or `off`')
    expect(list).not.toContain('wording release')
    expect(list).toContain('say only the API is read-only')
    expect(list).toContain('keeps its footer until it reloads')
  })

  it('keeps the promise lines switch-agnostic, as the first gate says', () => {
    const flat = (...path: string[]) => read(...path).replace(/\s+/g, ' ')
    const promises = [
      ['README.md'],
      ['AGENTS.md'],
      ['DESIGN.md'],
      ['docs', 'ROADMAP.md'],
      ['SECURITY.md'],
      ['docs', 'ARCHITECTURE.md'],
    ]
    for (const path of promises) {
      const text = flat(...path)
      const name = path.join('/')
      expect(text, name).not.toMatch(/talks only to `\/api`/i)
      expect(text, name).not.toMatch(/\bno trading(?! capital| on its own account)/i)
      expect(text, name).not.toMatch(/sends no transactions(?! of its own)/i)
      expect(text, name).toContain('optional swap panel')
      expect(text, name).toContain('off unless')
    }
    // The Builder Code costs no fee, but its suffix is calldata the visitor pays gas for.
    for (const path of [['README.md'], ['AGENTS.md'], ['DESIGN.md'], ['docs', 'ROADMAP.md']]) {
      const text = flat(...path)
      const name = path.join('/')
      expect(text, name).toContain('Builder Code (ERC-8021), which lets Base attribute')
      expect(text, name).toContain('only 29 bytes of calldata (a negligible amount of gas)')
      expect(text, name).not.toMatch(/costs the visitor nothing/i)
    }
    expect(flat('docs', 'ROADMAP.md')).not.toContain('No trading, routing or aggregation')
    const security = flat('SECURITY.md')
    for (const subject of [
      '**Calldata:**',
      '**Approvals:**',
      '**The Builder Code suffix:**',
      '**The switch:**',
      '**The security headers:**',
      '`apps/web/public/_headers`',
    ])
      expect(security, subject).toContain(subject)
    // Neither is in scope: an ETH-out swap pays the router before it unwraps to the visitor, and
    // a page already open shows the swap it loaded with until the panel reads the switch again.
    expect(security).toContain('leave the output with anyone but the visitor at the end')
    expect(security).toContain("show the swap while the bundle's `features.trade` is off for the")
    expect(security).toContain('or ask for a signature while it or `data/flags.json` is off')
    // The API's agent documents keep the API read-only and promise nothing of the dashboard.
    const agents = flat('apps', 'api', 'src', 'agentDocs', 'AGENTS.md')
    expect(agents).toContain('This server answers read-only JSON')
    expect(agents).toContain('This API does not execute, route or quote trades')
    expect(flat('apps', 'api', 'src', 'agentDocs', 'llms.txt')).toContain(
      'This API does not execute or route trades',
    )
  })

  it('says a refused value is published off and fails the run, as both workflows do', () => {
    expect(section).toContain('exits with code 3')
    for (const file of ['refresh-site.yml', 'trade-switch.yml']) {
      const workflow = read('.github', 'workflows', file)
      expect(workflow, file).toContain('if [ "$code" = 3 ]; then')
      expect(workflow, file).toContain("if: steps.export.outputs.trade_refused == 'true'")
      // The failing step comes after the publish.
      expect(workflow.indexOf('Fail on a refused trade switch')).toBeGreaterThan(
        workflow.indexOf('wrangler pages deploy'),
      )
    }
  })

  it('says a failed check of the published switch comes after the publish', () => {
    const workflow = read('.github', 'workflows', 'trade-switch.yml')
    expect(workflow.indexOf('name: Check the published switch')).toBeGreaterThan(
      workflow.indexOf('wrangler pages deploy'),
    )
    expect(section).toContain(
      'A failure in Check the published switch comes after the publish, so the new switch may already be served',
    )
    expect(section).not.toContain('any other failure published nothing')
  })
})
