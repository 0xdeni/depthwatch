#!/usr/bin/env tsx
/**
 * `depthwatch <command>`: the Depthwatch pipeline and server for Base mainnet.
 *
 * Exit codes: 0 ok, 1 runtime error (one line on stderr; this includes a live command started
 * without an RPC endpoint, a pass that stored nothing because every item failed, a `run --once`
 * with a failed step and a `run` loop stalled for three passes), 2 usage error (one line + hint),
 * 3 `export` refused DEPTHWATCH_TRADE and wrote everything with the trade switch off.
 * Logs go to stderr; stdout carries only program output: the `--help`/`--version` text, the
 * server URL line of `serve`/`demo`, the summary line of `export`, and the scorecard URL, listing
 * and JSON of `mm register`, `mm list` and `mm show`.
 * When started as a program, `./.env` (see `.env.example`) is read first; variables already set
 * in the environment win over the file.
 */
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '@depthwatch/db'
import {
  COMMANDS,
  type Command,
  type Config,
  ConfigError,
  DEFAULTS,
  type Env,
  LIVE_COMMANDS,
  loadConfig,
  MM_LIVE_SUBCOMMANDS,
  MM_SUBCOMMANDS,
  type MmArgs,
  parseCliArgs,
} from './config.js'
import { demoCommand } from './demo.js'
import { exportCommand } from './export.js'
import { createLogger, errorMessage, type Logger, resultFields } from './log.js'
import { mmCommand } from './mm.js'
import {
  assertSomethingStored,
  createPipelineContext,
  type PipelineContext,
} from './pipeline/context.js'
import { discoverStep } from './pipeline/discover.js'
import { positionsStep } from './pipeline/positions.js'
import { pruneStep } from './pipeline/prune.js'
import { type IterationResult, runLoop } from './pipeline/run.js'
import { scoreStep } from './pipeline/score.js'
import { seedStep } from './pipeline/seed.js'
import { snapshotStep } from './pipeline/snapshot.js'
import { volumeStep } from './pipeline/volume.js'
import { createCliChainReader, describeError } from './rpc.js'
import { serveUntilAborted } from './serve.js'
import { formatSeconds } from './start/scheduler.js'
import { SCHEDULE_DEFAULTS } from './start/settings.js'
import { startCommand } from './start/start.js'
import { TradeSwitchRefusedError } from './tradeSwitch.js'

export const EXIT_OK = 0
export const EXIT_ERROR = 1
export const EXIT_USAGE = 2
/** `export` refused DEPTHWATCH_TRADE, after writing the bundle and flags.json with trading off. */
export const EXIT_TRADE_REFUSED = 3

const require = createRequire(import.meta.url)

export function version(): string {
  const pkg = require('../package.json') as { version?: string }
  return pkg.version ?? '0.0.0'
}

export function usage(): string {
  const d = Object.fromEntries(
    Object.entries(SCHEDULE_DEFAULTS).map(([key, seconds]) => [key, formatSeconds(seconds)]),
  ) as Record<keyof typeof SCHEDULE_DEFAULTS, string>
  return `depthwatch ${version()} — liquidity observatory for Base mainnet

Usage: depthwatch <command> [options]

Commands
  discover    scan factory logs for new pools        [--dex <dex,...>] [--from-block N]
                --seed                   no logs: ask each DEX for the reference-token pools
                                         and date them by archive-state binary search
                --seed-token <address>   also seed this token's pairs (repeatable; with --seed,
                                         run --seed and start; DEPTHWATCH_SEED_TOKENS)
  snapshot    prices, TVL ranking, depth/spread/concentration for the top pools
                                                     [--top N] [--pool <id> ...]
  volume      hourly swap volume of tracked pools    [--hours 24]
  positions   LP positions of tracked and mandated concentrated pools
  score       persistence, health score and gaps for tracked pools
  prune       delete snapshots and volume older than --keep-days, samples older than 35 days,
              alerts older than 90                  [--keep-days 30]
  run         loop: discover → [positions] → snapshot → volume → score → [prune once a day]
                                                     [--interval 300|5m] [--once] [--with-positions]
                                                     [--seed] [--keep-days 30]
  start       the server: serve + the pipeline on a schedule, in one process (docs/DEPLOY.md)
                --snapshot-interval <d>  a pass: snapshot + score (DEPTHWATCH_SNAPSHOT_INTERVAL, ${d.snapshotIntervalSeconds})
                --volume-interval <d>    volume (DEPTHWATCH_VOLUME_INTERVAL, ${d.volumeIntervalSeconds})
                --positions-interval <d> LP positions, or off (DEPTHWATCH_POSITIONS_INTERVAL, ${d.positionsIntervalSeconds})
                --positions-budget <d>   time per positions run (DEPTHWATCH_POSITIONS_BUDGET, ${d.positionsBudgetSeconds})
                --discover-budget <d>    log discovery per pass, or off (DEPTHWATCH_DISCOVER_BUDGET, ${d.discoverBudgetSeconds})
                                         durations: 90s, 30m, 6h (a plain number is seconds)
  serve       REST API + dashboard (apps/web/dist when built)   [--port N] [--host H]
  demo        offline: synthetic Base world, 7 days of history → in-memory DB → serve
                                                     [--port N] [--db <new file>]
  export      static dashboard bundle (JSON) of the database, read through the API, and
              flags.json next to it        --out <file> [--demo] [--note <text>] [--bundle <file>]
                --demo                   bundle the offline demo instead (runs it in memory)
                --note <text>            the bundle's note, shown by a live static snapshot
                --bundle <file>          write that exported bundle again, only the trade
                                         switch changed (no database read)
  mm          market-maker scorecards (docs/SCORECARDS.md):
                register --file <json>   validate and store a mandate, print its scorecard URL
                list                     every mandate with its status
                show <id>                the scorecard summary as JSON
                deactivate <id>          stop sampling (the scorecard stays served as inactive)
                sample                   sample every active mandate now (live command)

Options
  --db <path>         SQLite file (DEPTHWATCH_DB, default ${DEFAULTS.dbPath}; demo ignores the variable)
  --rpc-url <url>     Base JSON-RPC endpoint (DEPTHWATCH_RPC_URL; required by live commands)
  --logs-rpc-url <url>
                      endpoint for eth_getLogs only (DEPTHWATCH_LOGS_RPC_URL, default: the
                      --rpc-url endpoint), e.g. https://mainnet.base.org next to a keyed provider
  --public-url <url>  public base URL of this deployment for scorecard links
                      (DEPTHWATCH_PUBLIC_URL, default http://<host>:<port>)
  --log-chunk <n>     blocks per eth_getLogs (DEPTHWATCH_LOG_CHUNK, default ${DEFAULTS.logChunkSize}); on a plan
                      that caps log ranges, its limit (e.g. 10) for short scans only, such as
                      volume --hours 1 (24 h of volume at 10 is 43,200+ requests per source)
  --log-level <lvl>   debug|info|warn|error|silent (DEPTHWATCH_LOG_LEVEL, default ${DEFAULTS.logLevel})
  --port <n>          DEPTHWATCH_PORT, else PORT (default ${DEFAULTS.port}); --host (DEPTHWATCH_HOST, default ${DEFAULTS.hostname})
  --top <n>           DEPTHWATCH_TOP_POOLS (default ${DEFAULTS.topPools})
  --keep-days <n>     DEPTHWATCH_KEEP_DAYS (default ${DEFAULTS.keepDays}): days of snapshots and volume that
                      prune, run and start keep (snapshots at least 8)
  -h, --help          this text;  -v, --version

Environment only: DEPTHWATCH_ADMIN_TOKEN, the bearer token (at least 32 characters) serve, start
and demo require for POST /api/mm and DELETE /api/mm/:id (unset: those routes answer 403
"registration disabled"); DEPTHWATCH_SHUTDOWN_GRACE, how long start waits for the step in flight
on SIGTERM (${d.shutdownGraceSeconds}); DEPTHWATCH_TRADE, the trade switch export writes into the bundle and
flags.json: off (the default) or a comma-separated list of trade venues (docs/DEPLOY.md).

Exit codes: 0 ok, 1 error, 2 usage, 3 export wrote the trade switch off because DEPTHWATCH_TRADE
was refused. A pass that stored nothing because every item failed
(snapshot, positions, mm sample) and a run --once with a failed step exit 1; the run loop goes
on past a failed step and exits 1 after three passes in a row whose every chain step failed.`
}

export interface MainOptions {
  env?: Env
  log?: Logger
  signal?: AbortSignal
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  /** History points of `demo` and `export --demo` (default seven days); tests run a short one. */
  demoHistoryPoints?: number
}

function isLiveCommand(command: Command, mm: MmArgs | undefined): boolean {
  if (command === 'mm') return mm !== undefined && MM_LIVE_SUBCOMMANDS.includes(mm.subcommand)
  return LIVE_COMMANDS.includes(command)
}

/**
 * First SIGINT/SIGTERM aborts the signal (`run` finishes its step, `start` stops the step in
 * flight, servers close); a second one exits immediately.
 */
export function installSignalHandlers(log: Logger): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const onSignal = (name: NodeJS.Signals) => {
    if (controller.signal.aborted) {
      log.warn('second signal, exiting now', { signal: name })
      process.exit(130)
    }
    log.info('signal received, shutting down', { signal: name })
    controller.abort()
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  return {
    signal: controller.signal,
    dispose: () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
    },
  }
}

function createContext(
  command: Command,
  mm: MmArgs | undefined,
  config: Config,
  log: Logger,
): PipelineContext {
  const name = command === 'mm' && mm !== undefined ? `mm ${mm.subcommand}` : command
  const chain = createCliChainReader(
    config,
    { command: name, live: isLiveCommand(command, mm) },
    log,
  )
  const db = openDatabase(config.dbPath)
  log.info('database open', { path: config.dbPath, schemaVersion: db.migration.to })
  return createPipelineContext({ db, chain, config, log })
}

interface RunContext {
  log: Logger
  signal: AbortSignal
  stdout: (line: string) => void
  demoHistoryPoints: number | undefined
}

/** `run --once` is one pass whose outcome is its exit code: a failed step is an error, not a log line. */
function assertPassSucceeded(failed: IterationResult['failed']): void {
  if (failed.length === 0) return
  const steps = failed.map((f) => `${f.step} (${f.error})`).join('; ')
  throw new Error(
    `run --once: ${failed.length} step${failed.length === 1 ? '' : 's'} failed: ${steps}`,
  )
}

async function runCommand(
  command: Command,
  mm: MmArgs | undefined,
  config: Config,
  run: RunContext,
): Promise<void> {
  const { log, signal, stdout } = run
  if (command === 'demo') {
    await demoCommand({ config, log, signal, stdout, historyPoints: run.demoHistoryPoints })
    return
  }
  if (command === 'export') {
    await exportCommand({ config, log, stdout, historyPoints: run.demoHistoryPoints })
    return
  }
  if (command === 'start') {
    await startCommand({ config, log, signal, stdout })
    return
  }
  const ctx = createContext(command, mm, config, log)
  try {
    switch (command) {
      case 'discover':
        if (config.seed)
          await log.timed(command, (step) => seedStep({ ...ctx, log: step }), resultFields)
        else
          await log.timed(
            command,
            (step) => discoverStep({ ...ctx, log: step }),
            (r) => ({ found: r.found }),
          )
        return
      case 'snapshot': {
        const result = await log.timed(
          command,
          (step) => snapshotStep({ ...ctx, log: step }),
          resultFields,
        )
        assertSomethingStored(command, result.failed, result.snapshots)
        return
      }
      case 'volume':
        await log.timed(command, (step) => volumeStep({ ...ctx, log: step }), resultFields)
        return
      case 'positions': {
        const result = await log.timed(
          command,
          (step) => positionsStep({ ...ctx, log: step }),
          (r) => ({ positions: r.positions }),
        )
        assertSomethingStored(command, result.failed, result.pools.filter((p) => !p.skipped).length)
        return
      }
      case 'score':
        await log.timed(command, (step) => scoreStep({ ...ctx, log: step }), resultFields)
        return
      case 'prune':
        await log.timed(command, (step) => pruneStep({ ...ctx, log: step }), resultFields)
        return
      case 'run': {
        const loop = await runLoop(ctx, { signal })
        if (config.runOnce) assertPassSucceeded(loop.lastFailed)
        return
      }
      case 'serve':
        await serveUntilAborted({
          db: ctx.db,
          port: config.port,
          hostname: config.hostname,
          adminToken: config.adminToken,
          log,
          signal,
          stdout,
        })
        return
      case 'mm':
        if (mm === undefined) throw new ConfigError('missing mm subcommand')
        await mmCommand({ ctx, args: mm, config, log, stdout })
        return
    }
  } finally {
    ctx.db.close()
  }
}

export async function main(argv: readonly string[], opts: MainOptions = {}): Promise<number> {
  const env = opts.env ?? process.env
  const stdout = opts.stdout ?? ((line: string) => process.stdout.write(`${line}\n`))
  const stderr = opts.stderr ?? ((line: string) => process.stderr.write(`${line}\n`))

  let args: ReturnType<typeof parseCliArgs>
  let config: Config
  try {
    args = parseCliArgs(argv)
    if (args.help) {
      stdout(usage())
      return EXIT_OK
    }
    if (args.version) {
      stdout(version())
      return EXIT_OK
    }
    if (args.command === undefined) {
      throw new ConfigError(`missing command (one of ${COMMANDS.join(', ')})`)
    }
    if (args.command === 'mm' && args.mm === undefined) {
      throw new ConfigError(`missing mm subcommand (one of ${MM_SUBCOMMANDS.join(', ')})`)
    }
    if (args.command === 'export' && args.flags.out === undefined) {
      throw new ConfigError('export needs --out <file>')
    }
    config = loadConfig(env, args.flags)
  } catch (error) {
    stderr(`error: ${errorMessage(error)}`)
    stderr('run "depthwatch --help" for usage')
    return EXIT_USAGE
  }

  const log = opts.log ?? createLogger({ level: config.logLevel })
  const handlers = opts.signal === undefined ? installSignalHandlers(log) : undefined
  const signal = opts.signal ?? handlers?.signal ?? new AbortController().signal
  try {
    await runCommand(args.command, args.mm, config, {
      log,
      signal,
      stdout,
      demoHistoryPoints: opts.demoHistoryPoints,
    })
    return EXIT_OK
  } catch (error) {
    stderr(`error: ${describeError(error)}`)
    if (error instanceof TradeSwitchRefusedError) return EXIT_TRADE_REFUSED
    return error instanceof ConfigError ? EXIT_USAGE : EXIT_ERROR
  } finally {
    handlers?.dispose()
  }
}

/**
 * Loads a dotenv file into `process.env` when it exists (`cp .env.example .env` from the README).
 * Variables already present in the environment are kept; only a missing file is tolerated.
 */
export function loadDotEnv(path = '.env'): boolean {
  try {
    process.loadEnvFile(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function isEntryPoint(): boolean {
  const script = process.argv[1]
  if (script === undefined) return false
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  loadDotEnv()
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
      // Everything main opened is closed by now. A request `start` abandoned on shutdown must not
      // hold the process past the host's stop timeout, so exit soon even if one is still pending.
      setTimeout(() => process.exit(code), 1_000).unref()
    },
    (error: unknown) => {
      process.stderr.write(`error: ${errorMessage(error)}\n`)
      process.exitCode = EXIT_ERROR
    },
  )
}
