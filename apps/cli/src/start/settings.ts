/**
 * The schedule of `depthwatch start` (start/scheduler.ts): one variable and one flag per setting,
 * flags winning over the environment, which wins over the defaults below. Durations take units
 * (`90s`, `30m`, `6h`, `1d`); a plain number is seconds, like `run --interval`.
 *
 * The defaults fit Alchemy's free tier (about 30 M compute units a month) for the main endpoint
 * with `eth_getLogs` on a second endpoint (`DEPTHWATCH_LOGS_RPC_URL`, Base's public RPC from the
 * server's own IP), about 200 tracked pools and about 580 known ones: docs/ARCHITECTURE.md
 * "Running as a service" has the arithmetic. Since Denim (200 ms blocks, 432 000 a day) every log
 * scan reads ten times as many blocks an hour as before, all of them on that second endpoint.
 */
import { type Env, parseDuration, pick } from '../configValues.js'

export interface ScheduleFlags {
  snapshotInterval?: string
  volumeInterval?: string
  positionsInterval?: string
  positionsBudget?: string
  discoverBudget?: string
}

export interface ScheduleSettings {
  /** Seconds between passes; each pass snapshots and scores (DEPTHWATCH_SNAPSHOT_INTERVAL). */
  snapshotIntervalSeconds: number
  /** Seconds between volume passes, rounded up to a pass (DEPTHWATCH_VOLUME_INTERVAL). */
  volumeIntervalSeconds: number
  /** Seconds between positions passes; 0 = never (DEPTHWATCH_POSITIONS_INTERVAL). */
  positionsIntervalSeconds: number
  /** Seconds after which a positions pass starts no further pool (DEPTHWATCH_POSITIONS_BUDGET). */
  positionsBudgetSeconds: number
  /** Seconds of log discovery per pass at most; 0 = no log discovery (DEPTHWATCH_DISCOVER_BUDGET). */
  discoverBudgetSeconds: number
  /** Seconds a stop signal waits for the current step before abandoning it (DEPTHWATCH_SHUTDOWN_GRACE). */
  shutdownGraceSeconds: number
}

export const SCHEDULE_DEFAULTS: Readonly<ScheduleSettings> = Object.freeze({
  snapshotIntervalSeconds: 30 * 60,
  volumeIntervalSeconds: 60 * 60,
  positionsIntervalSeconds: 6 * 60 * 60,
  positionsBudgetSeconds: 10 * 60,
  discoverBudgetSeconds: 15 * 60,
  shutdownGraceSeconds: 8,
})

const DAY = 86_400

/** Each setting: its variable, its flag (none for the grace period) and its bounds in seconds. */
export const SCHEDULE_SETTINGS = Object.freeze({
  snapshotIntervalSeconds: {
    env: 'DEPTHWATCH_SNAPSHOT_INTERVAL',
    flag: '--snapshot-interval',
    bounds: { min: 60, max: DAY },
  },
  volumeIntervalSeconds: {
    env: 'DEPTHWATCH_VOLUME_INTERVAL',
    flag: '--volume-interval',
    bounds: { min: 60, max: DAY },
  },
  positionsIntervalSeconds: {
    env: 'DEPTHWATCH_POSITIONS_INTERVAL',
    flag: '--positions-interval',
    bounds: { min: 5 * 60, max: 7 * DAY, off: true },
  },
  positionsBudgetSeconds: {
    env: 'DEPTHWATCH_POSITIONS_BUDGET',
    flag: '--positions-budget',
    bounds: { min: 30, max: DAY },
  },
  discoverBudgetSeconds: {
    env: 'DEPTHWATCH_DISCOVER_BUDGET',
    flag: '--discover-budget',
    bounds: { min: 30, max: DAY, off: true },
  },
  shutdownGraceSeconds: {
    env: 'DEPTHWATCH_SHUTDOWN_GRACE',
    flag: undefined,
    bounds: { min: 0, max: 600 },
  },
} as const)

const FLAG_OF: Readonly<Record<keyof ScheduleSettings, keyof ScheduleFlags | undefined>> = {
  snapshotIntervalSeconds: 'snapshotInterval',
  volumeIntervalSeconds: 'volumeInterval',
  positionsIntervalSeconds: 'positionsInterval',
  positionsBudgetSeconds: 'positionsBudget',
  discoverBudgetSeconds: 'discoverBudget',
  shutdownGraceSeconds: undefined,
}

export function loadScheduleSettings(env: Env, flags: ScheduleFlags = {}): ScheduleSettings {
  const out = { ...SCHEDULE_DEFAULTS }
  for (const key of Object.keys(SCHEDULE_SETTINGS) as Array<keyof ScheduleSettings>) {
    const setting = SCHEDULE_SETTINGS[key]
    const flagKey = FLAG_OF[key]
    const flag = flagKey === undefined ? undefined : flags[flagKey]
    const raw = pick(flag, env[setting.env])
    if (raw === undefined) continue
    const name = flag !== undefined && setting.flag !== undefined ? setting.flag : setting.env
    out[key] = parseDuration(name, raw, setting.bounds)
  }
  return out
}
