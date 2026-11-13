/**
 * CLI arguments and environment → `Config`. Flags win over environment variables, which win over
 * the defaults below; nothing here touches the network or the database. The variables and their
 * flags are the README "Environment" table (endpoints: rpc.ts); DEPTHWATCH_ADMIN_TOKEN is
 * environment only, so it never appears in a process list.
 */
import { parseArgs } from 'node:util'
import type { Address, Dex } from '@depthwatch/core'
import { type MmArgs, parseMmArgs } from './configMm.js'
import {
  ConfigError,
  type Env,
  parseAdminToken,
  parseBlock,
  parseDexes,
  parseDuration,
  parseInteger,
  parseLogLevel,
  parsePoolIds,
  parsePublicUrl,
  parseRpcUrl,
  parseSeedTokens,
  pick,
} from './configValues.js'
import type { LogLevel } from './log.js'
import {
  loadScheduleSettings,
  type ScheduleFlags,
  type ScheduleSettings,
} from './start/settings.js'

export {
  isMmSubcommand,
  MM_ID_SUBCOMMANDS,
  MM_LIVE_SUBCOMMANDS,
  MM_SUBCOMMANDS,
  type MmArgs,
  type MmSubcommand,
  parseMmArgs,
} from './configMm.js'
export { ConfigError, type Env } from './configValues.js'

export const COMMANDS = [
  'discover',
  'snapshot',
  'volume',
  'positions',
  'score',
  'prune',
  'run',
  'start',
  'serve',
  'demo',
  'export',
  'mm',
] as const
export type Command = (typeof COMMANDS)[number]

/** Commands that prune (`run` and `start` once a day), the only ones `--keep-days` applies to. */
export const PRUNING_COMMANDS: readonly Command[] = ['prune', 'run', 'start']

/** Commands that read the chain and therefore need DEPTHWATCH_RPC_URL. */
export const LIVE_COMMANDS: readonly Command[] = [
  'discover',
  'snapshot',
  'volume',
  'positions',
  'run',
  'start',
]

export const DEFAULTS = Object.freeze({
  dbPath: 'depthwatch.db',
  port: 8787,
  hostname: '0.0.0.0',
  topPools: 200,
  logChunkSize: 2_000,
  intervalSeconds: 300,
  keepDays: 30,
  hours: 24,
  bandPct: 5,
  concurrency: 4,
  logLevel: 'info' as LogLevel,
})

export interface CliFlags extends ScheduleFlags {
  dex?: string[]
  fromBlock?: string
  file?: string
  publicUrl?: string
  top?: string
  pool?: string[]
  hours?: string
  interval?: string
  keepDays?: string
  once?: boolean
  withPositions?: boolean
  seed?: boolean
  seedToken?: string[]
  port?: string
  host?: string
  db?: string
  rpcUrl?: string
  logsRpcUrl?: string
  logChunk?: string
  logLevel?: string
  out?: string
  demo?: boolean
  note?: string
  updates?: string
  bundle?: string
}

export interface CliArgs {
  command: Command | undefined
  /** Set for the `mm` command once a subcommand was given (`mm` alone leaves it undefined). */
  mm: MmArgs | undefined
  help: boolean
  version: boolean
  flags: CliFlags
}

export interface Config {
  rpcUrl: string | undefined
  /** `eth_getLogs` endpoint: DEPTHWATCH_LOGS_RPC_URL / --logs-rpc-url, else `rpcUrl`. */
  logsRpcUrl: string | undefined
  dbPath: string
  /** Where dbPath came from; `demo` only honours 'flag' and is in-memory otherwise. */
  dbPathSource: 'flag' | 'env' | 'default'
  port: number
  hostname: string
  topPools: number
  logChunkSize: number
  intervalSeconds: number
  /** `prune`: days of snapshots and hourly volume kept (snapshots at least 8; pipeline/prune.ts). */
  keepDays: number
  runOnce: boolean
  withPositions: boolean
  /** `discover --seed` / `run --seed`: discovery from factory views, no logs (pipeline/seed.ts). */
  seed: boolean
  /** ERC-20s seeded besides the reference tokens (`--seed-token`, DEPTHWATCH_SEED_TOKENS). */
  seedTokens: Address[]
  hours: number
  dexes: Dex[]
  fromBlock: bigint | undefined
  poolIds: string[]
  bandPct: number
  concurrency: number
  logLevel: LogLevel
  /** `mm register --file`: the registration JSON. */
  mandateFile: string | undefined
  /** Public base URL of this deployment (no trailing slash); undefined derives it from host/port. */
  publicUrl: string | undefined
  /**
   * Bearer token the API requires for mandate registration (at least 32 characters); undefined
   * keeps those routes disabled.
   */
  adminToken: string | undefined
  /** `export --out`: where the static bundle is written. */
  outFile: string | undefined
  /** `export --demo`: bundle the demo pipeline's in-memory database instead of the configured one. */
  exportDemo: boolean
  /** `export --note`: the bundle's `note` (trimmed), shown with a live static snapshot. */
  exportNote: string | undefined
  /** `export --updates`: the bundle's `updates`, the publisher's schedule. */
  exportUpdates: 'several-times-a-day' | undefined
  /** `export --bundle`: an exported bundle to write again with only its `features` replaced. */
  exportBundle: string | undefined
  /** DEPTHWATCH_TRADE as given (environment only); `export` alone parses it (tradeSwitch.ts). */
  tradeSwitch: string | undefined
  /** `start`: the scheduler's cadences and budgets (start/settings.ts). */
  schedule: ScheduleSettings
}

const PARSE_OPTIONS = {
  dex: { type: 'string', multiple: true },
  'from-block': { type: 'string' },
  file: { type: 'string' },
  'public-url': { type: 'string' },
  top: { type: 'string' },
  pool: { type: 'string', multiple: true },
  hours: { type: 'string' },
  interval: { type: 'string' },
  'keep-days': { type: 'string' },
  once: { type: 'boolean' },
  'with-positions': { type: 'boolean' },
  seed: { type: 'boolean' },
  'seed-token': { type: 'string', multiple: true },
  port: { type: 'string' },
  host: { type: 'string' },
  db: { type: 'string' },
  'rpc-url': { type: 'string' },
  'logs-rpc-url': { type: 'string' },
  'log-chunk': { type: 'string' },
  'log-level': { type: 'string' },
  out: { type: 'string' },
  demo: { type: 'boolean' },
  note: { type: 'string' },
  updates: { type: 'string' },
  bundle: { type: 'string' },
  'snapshot-interval': { type: 'string' },
  'volume-interval': { type: 'string' },
  'positions-interval': { type: 'string' },
  'positions-budget': { type: 'string' },
  'discover-budget': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const

/** The flags of `start` alone (start/settings.ts). */
const SCHEDULE_FLAGS = [
  'snapshot-interval',
  'volume-interval',
  'positions-interval',
  'positions-budget',
  'discover-budget',
] as const

/** `run`'s loop flags and `discover`'s restart block: `start` schedules and resumes by itself. */
const NOT_FOR_START = ['interval', 'once', 'with-positions', 'from-block'] as const

export function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value)
}

/** Parses `argv` (without the node/script entries). Throws ConfigError on unknown options. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  let parsed: ReturnType<
    typeof parseArgs<{ options: typeof PARSE_OPTIONS; allowPositionals: true }>
  >
  try {
    parsed = parseArgs({
      args: [...argv],
      options: PARSE_OPTIONS,
      allowPositionals: true,
      strict: true,
    })
  } catch (error) {
    throw new ConfigError(error instanceof Error ? error.message : String(error))
  }
  const { values, positionals } = parsed
  const [first, ...rest] = positionals
  let command: Command | undefined
  let mm: MmArgs | undefined
  if (first !== undefined) {
    if (!isCommand(first)) throw new ConfigError(`unknown command "${first}"`)
    command = first
  }
  if (command === 'mm') mm = parseMmArgs(rest, values.file)
  else if (rest.length > 0) throw new ConfigError(`unexpected argument "${rest[0]}"`)
  if (values.out !== undefined && values.out.trim() === '')
    throw new ConfigError('--out needs a file path')
  if (values.demo === true && command !== undefined && command !== 'export')
    throw new ConfigError('--demo only applies to export (use the demo command instead)')
  if (values.note !== undefined && command !== undefined && command !== 'export')
    throw new ConfigError('--note only applies to export')
  if (values.note !== undefined && values.note.trim() === '')
    throw new ConfigError('--note needs text')
  if (values.updates !== undefined && command !== undefined && command !== 'export')
    throw new ConfigError('--updates only applies to export')
  if (values.updates !== undefined && values.updates !== 'several-times-a-day')
    throw new ConfigError('--updates takes several-times-a-day')
  if (values.bundle !== undefined && command !== undefined && command !== 'export')
    throw new ConfigError('--bundle only applies to export')
  if (values.bundle?.trim() === '') throw new ConfigError('--bundle needs a file path')
  const bundleData =
    values.demo === true || values.note !== undefined || values.updates !== undefined
  if (values.bundle !== undefined && bundleData)
    throw new ConfigError(
      '--bundle keeps the data and note of the bundle it reads: no --demo, --note, --updates',
    )
  if (values.seed === true && command !== undefined && command !== 'discover' && command !== 'run')
    throw new ConfigError('--seed only applies to discover and run')
  if (values.seed === true && values['from-block'] !== undefined)
    throw new ConfigError('--from-block only applies to the log scan, not to --seed')
  const seeds = command === 'start' || (values.seed === true && command !== undefined)
  if (values['seed-token'] !== undefined && command !== undefined && !seeds)
    throw new ConfigError('--seed-token only applies to discover --seed, run --seed and start')
  const keepDays = values['keep-days']
  if (keepDays !== undefined && command !== undefined && !PRUNING_COMMANDS.includes(command))
    throw new ConfigError('--keep-days only applies to prune, run and start')
  const scheduleFlag = SCHEDULE_FLAGS.find((flag) => values[flag] !== undefined)
  if (scheduleFlag !== undefined && command !== undefined && command !== 'start')
    throw new ConfigError(`--${scheduleFlag} only applies to start`)
  const loopFlag = NOT_FOR_START.find((flag) => values[flag] !== undefined)
  if (loopFlag !== undefined && command === 'start')
    throw new ConfigError(
      `--${loopFlag} does not apply to start, whose schedule takes --snapshot-interval and friends`,
    )
  return {
    command,
    mm,
    help: values.help === true,
    version: values.version === true,
    flags: {
      dex: values.dex,
      fromBlock: values['from-block'],
      file: values.file,
      publicUrl: values['public-url'],
      top: values.top,
      pool: values.pool,
      hours: values.hours,
      interval: values.interval,
      keepDays: values['keep-days'],
      once: values.once,
      withPositions: values['with-positions'],
      seed: values.seed,
      seedToken: values['seed-token'],
      port: values.port,
      host: values.host,
      db: values.db,
      rpcUrl: values['rpc-url'],
      logsRpcUrl: values['logs-rpc-url'],
      logChunk: values['log-chunk'],
      logLevel: values['log-level'],
      out: values.out,
      demo: values.demo,
      note: values.note,
      updates: values.updates,
      bundle: values.bundle,
      snapshotInterval: values['snapshot-interval'],
      volumeInterval: values['volume-interval'],
      positionsInterval: values['positions-interval'],
      positionsBudget: values['positions-budget'],
      discoverBudget: values['discover-budget'],
    },
  }
}

/**
 * Flags, then environment, then defaults. The port is `--port`, else `DEPTHWATCH_PORT`, else the
 * `PORT` a hosting platform sets, else 8787.
 */
export function loadConfig(env: Env, flags: CliFlags = {}): Config {
  const port = pick(flags.port, env.DEPTHWATCH_PORT) ?? pick(undefined, env.PORT)
  const top = pick(flags.top, env.DEPTHWATCH_TOP_POOLS)
  const chunk = pick(flags.logChunk, env.DEPTHWATCH_LOG_CHUNK)
  const rpcUrl = parseRpcUrl('DEPTHWATCH_RPC_URL', pick(flags.rpcUrl, env.DEPTHWATCH_RPC_URL))
  const logsRpcUrl = parseRpcUrl(
    'DEPTHWATCH_LOGS_RPC_URL',
    pick(flags.logsRpcUrl, env.DEPTHWATCH_LOGS_RPC_URL),
  )
  const envDb = pick(undefined, env.DEPTHWATCH_DB)
  const keepDays = pick(flags.keepDays, env.DEPTHWATCH_KEEP_DAYS)
  return {
    rpcUrl,
    logsRpcUrl: logsRpcUrl ?? rpcUrl,
    dbPath: flags.db ?? envDb ?? DEFAULTS.dbPath,
    dbPathSource: flags.db !== undefined ? 'flag' : envDb !== undefined ? 'env' : 'default',
    port: port === undefined ? DEFAULTS.port : parseInteger('port', port, { min: 0, max: 65_535 }),
    hostname: pick(flags.host, env.DEPTHWATCH_HOST) ?? DEFAULTS.hostname,
    topPools: top === undefined ? DEFAULTS.topPools : parseInteger('top', top, { min: 0 }),
    logChunkSize:
      chunk === undefined
        ? DEFAULTS.logChunkSize
        : parseInteger('log chunk size', chunk, { min: 1, max: 10_000_000 }),
    intervalSeconds:
      flags.interval === undefined
        ? DEFAULTS.intervalSeconds
        : parseDuration('interval', flags.interval, { min: 1, max: 86_400 * 7 }),
    keepDays:
      keepDays === undefined
        ? DEFAULTS.keepDays
        : parseInteger('keep days', keepDays, { min: 2, max: 3650 }),
    runOnce: flags.once === true,
    withPositions: flags.withPositions === true,
    seed: flags.seed === true,
    seedTokens: parseSeedTokens(flags.seedToken ?? pick(undefined, env.DEPTHWATCH_SEED_TOKENS)),
    hours:
      flags.hours === undefined
        ? DEFAULTS.hours
        : parseInteger('hours', flags.hours, { min: 1, max: 24 * 30 }),
    dexes: parseDexes(flags.dex),
    fromBlock:
      flags.fromBlock === undefined ? undefined : parseBlock('from-block', flags.fromBlock),
    poolIds: parsePoolIds(flags.pool),
    bandPct: DEFAULTS.bandPct,
    concurrency: DEFAULTS.concurrency,
    logLevel: parseLogLevel(pick(flags.logLevel, env.DEPTHWATCH_LOG_LEVEL), DEFAULTS.logLevel),
    mandateFile: flags.file,
    publicUrl: parsePublicUrl(pick(flags.publicUrl, env.DEPTHWATCH_PUBLIC_URL)),
    adminToken: parseAdminToken(pick(undefined, env.DEPTHWATCH_ADMIN_TOKEN)),
    outFile: flags.out,
    exportDemo: flags.demo === true,
    exportNote: flags.note?.trim(),
    exportUpdates: flags.updates === 'several-times-a-day' ? flags.updates : undefined,
    exportBundle: flags.bundle,
    tradeSwitch: pick(undefined, env.DEPTHWATCH_TRADE),
    schedule: loadScheduleSettings(env, flags),
  }
}

/**
 * The public base URL of this deployment: `DEPTHWATCH_PUBLIC_URL` when set, otherwise
 * `http://<host>:<port>` of `serve` (a wildcard interface reads as localhost, like the server's
 * own announcement).
 */
export function publicBaseUrl(config: Config): string {
  if (config.publicUrl !== undefined) return config.publicUrl
  const host =
    config.hostname === '0.0.0.0' || config.hostname === '::' ? 'localhost' : config.hostname
  return `http://${host}:${config.port}`
}

/** The dashboard page of a scorecard (`/mm/<id>`), also the `scorecardUrl` of webhook alerts. */
export function scorecardUrl(config: Config, mandateId: string): string {
  return `${publicBaseUrl(config)}/mm/${encodeURIComponent(mandateId)}`
}
