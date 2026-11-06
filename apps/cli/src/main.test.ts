import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addStockFixture,
  BASE_STOCKS,
  createFakeRpcFetch,
  createSyntheticFixture,
  SYNTHETIC_DEFAULTS,
} from '@depthwatch/chain'
import { fixturePool, openDatabase } from '@depthwatch/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMMANDS, DEFAULTS, MM_SUBCOMMANDS } from './config.js'
import { createLogger } from './log.js'
import {
  EXIT_ERROR,
  EXIT_OK,
  EXIT_USAGE,
  loadDotEnv,
  type MainOptions,
  main,
  usage,
  version,
} from './main.js'
import { SCHEDULE_SETTINGS } from './start/settings.js'

interface Run {
  code: number
  stdout: string[]
  stderr: string[]
  logs: string[]
}

/** A short demo history keeps `demo` / `export --demo` runs fast here. */
const DEMO_POINTS = 3

async function run(
  argv: string[],
  env: Record<string, string> = {},
  signal: AbortSignal = new AbortController().signal,
  extra: Pick<MainOptions, 'demoHistoryPoints'> = { demoHistoryPoints: DEMO_POINTS },
): Promise<Run> {
  const stdout: string[] = []
  const stderr: string[] = []
  const logs: string[] = []
  const log = createLogger({ write: (line) => logs.push(line), now: () => new Date(0) })
  const code = await main(argv, {
    env,
    log,
    signal,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    ...extra,
  })
  return { code, stdout, stderr, logs }
}

describe('main', () => {
  it('prints usage and version with exit 0', async () => {
    const help = await run(['--help'])
    expect(help.code).toBe(EXIT_OK)
    expect(help.stdout[0]).toBe(usage())
    for (const command of COMMANDS) expect(usage()).toContain(`  ${command}`)
    const v = await run(['-v'])
    expect(v.code).toBe(EXIT_OK)
    expect(v.stdout).toEqual([version()])
    expect(version()).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('exits 2 on usage errors with a one-line message', async () => {
    const none = await run([])
    expect(none.code).toBe(EXIT_USAGE)
    expect(none.stderr[0]).toMatch(/^error: missing command/)
    const unknown = await run(['explode'])
    expect(unknown.code).toBe(EXIT_USAGE)
    expect(unknown.stderr[0]).toBe('error: unknown command "explode"')
    const badFlag = await run(['serve', '--port', 'abc'])
    expect(badFlag.code).toBe(EXIT_USAGE)
    expect(badFlag.stderr[0]).toMatch(/port must be an integer/)
  })

  it('refuses live commands without an RPC url with exit 1, naming the variable', async () => {
    for (const command of ['discover', 'snapshot', 'volume', 'positions', 'run', 'start']) {
      const result = await run([command, '--db', ':memory:'])
      expect(result.code).toBe(EXIT_ERROR)
      expect(result.stderr).toHaveLength(1)
      expect(result.stderr[0]).toMatch(/DEPTHWATCH_RPC_URL/)
    }
  })

  it('runs score against an empty in-memory database and logs structured lines', async () => {
    const result = await run(['score', '--db', ':memory:'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.stderr).toEqual([])
    expect(
      result.logs.some((line) =>
        /^1970-01-01T00:00:00\.000Z INFO {2}database open path=:memory:/.test(line),
      ),
    ).toBe(true)
    expect(result.logs.some((line) => line.includes('[score] start'))).toBe(true)
    expect(result.logs.some((line) => line.includes('WARN  [score] no tracked pools'))).toBe(true)
    expect(result.logs.some((line) => /\[score\] done ms=\d+ pools=0 scored=0/.test(line))).toBe(
      true,
    )
  })

  it('reports runtime failures with exit 1', async () => {
    const result = await run(['score', '--db', '/nonexistent-dir/depthwatch.sqlite'])
    expect(result.code).toBe(EXIT_ERROR)
    expect(result.stderr).toHaveLength(1)
    expect(result.stderr[0]).toMatch(/^error: /)
  })

  it('demo exits 1 on a --db file holding live data and never opens DEPTHWATCH_DB', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-main-demo-'))
    try {
      const file = join(dir, 'live.db')
      const live = openDatabase(file)
      try {
        live.pools.upsertMany([fixturePool()])
        live.syncState.setBigInt('discover:uniswap-v3:lastBlock', 60_000_000n)
      } finally {
        live.close()
      }

      const refused = await run(['demo', '--db', file, '--port', '0'])
      expect(refused.code).toBe(EXIT_ERROR)
      expect(refused.stderr).toHaveLength(1)
      expect(refused.stderr[0]).toMatch(/^error: demo: .*already holds/)

      // README quick start: .env sets DEPTHWATCH_DB; an aborted signal skips serving.
      const controller = new AbortController()
      controller.abort()
      const inMemory = await run(
        ['demo', '--port', '0'],
        { DEPTHWATCH_DB: file },
        controller.signal,
      )
      expect(inMemory.code).toBe(EXIT_OK)
      expect(inMemory.stderr).toEqual([])
      expect(inMemory.logs.some((line) => line.includes('db=:memory:'))).toBe(true)

      const db = openDatabase(file)
      try {
        expect(db.pools.count()).toBe(1)
        expect(db.syncState.getBigInt('discover:uniswap-v3:lastBlock')).toBe(60_000_000n)
        expect(db.syncState.getBigInt('discover:uniswap-v4:lastBlock')).toBeUndefined()
      } finally {
        db.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)

  it('export: usage error without --out, runtime error on a missing database', async () => {
    const noOut = await run(['export', '--demo'])
    expect(noOut.code).toBe(EXIT_USAGE)
    expect(noOut.stderr[0]).toBe('error: export needs --out <file>')
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-main-export-'))
    try {
      const missing = await run([
        'export',
        '--db',
        join(dir, 'absent.db'),
        '--out',
        join(dir, 'b.json'),
      ])
      expect(missing.code).toBe(EXIT_ERROR)
      expect(missing.stderr).toHaveLength(1)
      expect(missing.stderr[0]).toMatch(/^error: export: database .* does not exist/)
      expect(existsSync(join(dir, 'absent.db'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('export --demo writes the bundle and prints one summary line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-main-export-'))
    try {
      const out = join(dir, 'static-data', 'bundle.json')
      const result = await run(['export', '--demo', '--out', out])
      expect(result.code).toBe(EXIT_OK)
      expect(result.stderr).toEqual([])
      expect(result.stdout).toHaveLength(1)
      expect(result.stdout[0]).toMatch(
        /^exported demo bundle to .*bundle\.json: 8 pools, 2 scorecards/,
      )
      const bundle = JSON.parse(readFileSync(out, 'utf8')) as { v: number; source: string }
      expect(bundle).toMatchObject({ v: 1, source: 'demo' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)

  it('documents the defaults in the usage text', () => {
    expect(usage()).toContain(String(DEFAULTS.port))
    expect(usage()).toContain(DEFAULTS.dbPath)
    expect(usage()).toContain(`DEPTHWATCH_KEEP_DAYS (default ${DEFAULTS.keepDays})`)
    expect(usage()).toContain('Exit codes: 0 ok, 1 error, 2 usage')
  })

  it('prune runs against an empty database and reports what it deleted', async () => {
    const result = await run(['prune', '--db', ':memory:', '--keep-days', '14'])
    expect(result.code).toBe(EXIT_OK)
    expect(result.stderr).toEqual([])
    expect(
      result.logs.some((line) =>
        /\[prune\] done ms=\d+ keepDays=14 snapshots=0 batches=1 volume=0 /.test(line),
      ),
    ).toBe(true)
  })
})

/**
 * The synthetic world with sound answers for the ten stocks at its head: a live `snapshot` reads
 * them beside the state (docs/design/stocks.md §4), and over HTTP a read the fixture lacks is an
 * internal error that the reader retries.
 */
function syntheticWorldWithStocks() {
  const fixture = createSyntheticFixture()
  for (const { address } of BASE_STOCKS.tokens)
    addStockFixture(fixture, {
      stock: address,
      feed: BASE_STOCKS.feeds[address] ?? null,
      block: SYNTHETIC_DEFAULTS.latestBlock,
      answer: 200n * 10n ** 8n,
      updatedAt: SYNTHETIC_DEFAULTS.latestTimestamp - 600,
    })
  return fixture
}

/** A JSON-RPC endpoint that refuses everything, as a revoked key does. */
const unauthorized = () => new Response('Unauthorized', { status: 401 })

describe('exit codes of a pass that failed', () => {
  const env = { DEPTHWATCH_RPC_URL: 'http://rpc.example' }
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('run --once exits 1 with one line naming the failed steps', async () => {
    const fake = createFakeRpcFetch(createSyntheticFixture(), {
      respond: unauthorized,
      getLogs: unauthorized,
    })
    vi.stubGlobal('fetch', fake.fetch)
    const result = await run(['run', '--once', '--db', ':memory:'], env)
    expect(result.code).toBe(EXIT_ERROR)
    expect(result.stderr).toHaveLength(1)
    expect(result.stderr[0]).toMatch(
      /^error: run --once: 3 steps failed: discover \(.*401.*\); snapshot \(.*401.*\); volume \(.*401.*\)$/,
    )
    expect(result.logs.some((line) => line.includes('[score] done'))).toBe(true)
    expect(result.logs.some((line) => line.includes('[prune] done'))).toBe(true)
  })

  it('snapshot exits 1 when every tracked pool failed and nothing was stored, 0 once one is', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-main-snapshot-'))
    try {
      const file = join(dir, 'live.db')
      const fake = createFakeRpcFetch(syntheticWorldWithStocks())
      // The overview phase works; from the moment the tracked pools are chosen, every `eth_call`
      // (the state reads) is refused, so each pool fails and no snapshot can be built.
      let refuse = false
      const fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { method?: string } | { method?: string }[]
        const methods = (Array.isArray(body) ? body : [body]).map((b) => b.method)
        if (refuse && methods.includes('eth_call')) return unauthorized()
        return fake.fetch(input, init)
      }
      vi.stubGlobal('fetch', fetch)
      // Wide log chunks: the default 2,000-block chunks over the fixture's whole chain would spend
      // most of the test's time budget on discovery alone.
      const discover = await run(['discover', '--db', file, '--log-chunk', '1000000'], env)
      expect(discover.code).toBe(EXIT_OK)

      const stderr: string[] = []
      const logs: string[] = []
      const log = createLogger({
        write: (line) => {
          logs.push(line)
          if (line.includes('selected tracked pools')) refuse = true
        },
        now: () => new Date(0),
      })
      const code = await main(['snapshot', '--db', file], {
        env,
        log,
        signal: new AbortController().signal,
        stdout: () => {},
        stderr: (line) => stderr.push(line),
      })
      expect(code).toBe(EXIT_ERROR)
      expect(stderr).toHaveLength(1)
      expect(stderr[0]).toMatch(
        /^error: snapshot: every item failed \(\d+\), nothing stored; .*401/,
      )
      expect(logs.some((line) => /\[snapshot\] done .*snapshots=0 /.test(line))).toBe(true)
      const db = openDatabase(file)
      try {
        expect(db.snapshots.count()).toBe(0)
      } finally {
        db.close()
      }

      refuse = false
      const ok = await run(['snapshot', '--db', file], env)
      expect(ok.code).toBe(EXIT_OK)
      expect(ok.stderr).toEqual([])
      // The ten stocks are read at the snapshot's block beside the state reads (refused in the
      // failed pass, whose `unread` readings the second pass at the same block keeps).
      expect(
        logs.some((line) => line.includes('WARN  [snapshot] stock reads failed stocks=10')),
      ).toBe(true)
      expect(ok.logs.some((line) => /read stocks stocks=10 .*statuses=live:10$/.test(line))).toBe(
        true,
      )
      const stored = openDatabase(file)
      try {
        expect(stored.stocks.count()).toBe(BASE_STOCKS.tokens.length)
        expect(stored.stockReadings.count()).toBe(BASE_STOCKS.tokens.length)
      } finally {
        stored.close()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('loadDotEnv', () => {
  const KEY_NEW = 'DEPTHWATCH_TEST_DOTENV_NEW'
  const KEY_SET = 'DEPTHWATCH_TEST_DOTENV_SET'
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-dotenv-'))
  })

  afterEach(() => {
    delete process.env[KEY_NEW]
    delete process.env[KEY_SET]
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads the file without overriding variables already in the environment', () => {
    const path = join(dir, '.env')
    writeFileSync(path, `${KEY_NEW}=from-file\n${KEY_SET}=from-file\n`)
    process.env[KEY_SET] = 'from-env'
    expect(loadDotEnv(path)).toBe(true)
    expect(process.env[KEY_NEW]).toBe('from-file')
    expect(process.env[KEY_SET]).toBe('from-env')
  })

  it('tolerates a missing file and nothing else', () => {
    expect(loadDotEnv(join(dir, 'absent.env'))).toBe(false)
    // A directory is not ENOENT: that error must surface.
    expect(() => loadDotEnv(dir)).toThrow()
  })
})

describe('DESIGN.md "CLI (apps/cli)"', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const design = readFileSync(join(here, '..', '..', '..', 'DESIGN.md'), 'utf8')
  const start = design.indexOf('\n## CLI (apps/cli)\n')
  const cli = design.slice(start, design.indexOf('\n## ', start + 1))
  const config = readFileSync(join(here, 'config.ts'), 'utf8')
  const variables = [
    ...[...config.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1] ?? ''),
    ...Object.values(SCHEDULE_SETTINGS).map((s) => s.env),
  ]

  it('finds the section and the variables config.ts reads', () => {
    expect(start).toBeGreaterThan(0)
    expect(variables).toEqual(expect.arrayContaining(['DEPTHWATCH_HOST', 'DEPTHWATCH_ADMIN_TOKEN']))
  })

  it.each(COMMANDS)('describes `%s` in a bullet of its own', (command) => {
    expect(cli).toMatch(new RegExp(`\\n- \`${command}[ \`]`))
  })

  it.each(MM_SUBCOMMANDS)('describes `mm %s`', (sub) => {
    expect(cli).toMatch(new RegExp(`\`mm ${sub}[ \`]`))
  })

  it.each([...new Set(variables)])('names %s', (name) => {
    expect(cli).toContain(`\`${name}\``)
  })
})
