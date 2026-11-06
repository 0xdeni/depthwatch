/**
 * Versioned schema. `MIGRATIONS[i]` brings the database to version `i + 1`; each entry is a batch
 * of SQL statements applied in one transaction and recorded in `schema_version`.
 *
 * Never edit an entry that has shipped: append a new one (schema.test.ts pins a sha256 of each).
 *
 * Storage conventions (DESIGN.md "Storage"): bigints are TEXT decimal strings, JSON columns hold
 * the core types with bigints as strings, addresses are lowercase, timestamps are unix seconds.
 * A few denormalised columns (snapshots.depth2_usd / spread10k_bps / owner_top1_share,
 * scores.health_total / gap_score) exist so that the dashboard's sorts run in SQL. Reads of
 * `spread10k_bps` and `spreads_json` go through core's price impact cap (summary.ts): a row
 * stored before the cap holds the uncapped spread.
 *
 * Version 2 adds the market-maker scorecard tables (`mandates`, `mm_samples`, `mm_alerts`).
 * Version 3 stores one snapshot per pool and block and one sample per mandate and block.
 * Version 4 adds `timestamp` indexes on `mm_samples` and `mm_alerts`, so retention deletes
 * (`pruneBefore`) seek instead of scanning the tables.
 * Version 5 adds `snapshots.price_deviation_bps` (`PoolSnapshot.priceDeviationBps`, docs/METRICS.md
 * "Stale quotes"), NULL in the rows stored before it; reads and sorts use it as stored.
 * Version 6 clears `snapshots.owner_top1_share` where the stored owners do not describe the pool
 * (summary.ts, `ownerTop1Share`), so stored rows and new ones mean the same.
 * Version 7 adds `snapshots.fee_pips`: the LP fee each snapshot's depth and spread used
 * (`PoolSnapshot.feePips`), NULL in the rows stored before it. It also marks the first build that
 * knows the Aero DEX ids, so an older build refuses the file before any step meets them.
 * Version 8 adds tokenized stocks (docs/design/stocks.md §5): `snapshots.reference_json`
 * (`PoolSnapshot.reference`, NULL in the rows stored before it), the stock list (`stocks`) and one
 * reading per stock and snapshot block (`stock_readings`).
 *
 * Several processes may open one file at once: a database at the current version is read without
 * a write lock; otherwise `BEGIN IMMEDIATE` comes first and `schema_version` is created and read
 * inside that transaction, so the first process applies the pending migrations and every other
 * one, waiting on its lock, then reads the version it recorded and applies nothing.
 */
import type { DatabaseSync } from 'node:sqlite'
import { rollback } from './context.js'
import { toCount } from './sql.js'

export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE tokens (
    address TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL
  );

  CREATE TABLE pools (
    id TEXT PRIMARY KEY,
    dex TEXT NOT NULL,
    kind TEXT NOT NULL,
    address TEXT,
    pool_id TEXT,
    token0 TEXT NOT NULL,
    token1 TEXT NOT NULL,
    fee_pips INTEGER NOT NULL,
    tick_spacing INTEGER,
    stable INTEGER NOT NULL DEFAULT 0,
    hooks TEXT,
    created_at_block TEXT NOT NULL,
    tracked INTEGER NOT NULL DEFAULT 0,
    first_seen_at INTEGER NOT NULL
  );
  CREATE INDEX pools_dex ON pools(dex);
  CREATE INDEX pools_token0 ON pools(token0);
  CREATE INDEX pools_token1 ON pools(token1);
  CREATE INDEX pools_tracked ON pools(tracked);

  CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pool_id TEXT NOT NULL,
    block_number TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    price REAL NOT NULL,
    token0_usd REAL,
    token1_usd REAL,
    tvl_usd REAL,
    active_liquidity TEXT NOT NULL,
    depth_json TEXT NOT NULL,
    depth_usd_json TEXT NOT NULL,
    spreads_json TEXT NOT NULL,
    concentration_json TEXT,
    depth2_usd REAL,
    spread10k_bps REAL,
    owner_top1_share REAL
  );
  CREATE INDEX snapshots_pool_timestamp ON snapshots(pool_id, timestamp);
  CREATE INDEX snapshots_timestamp ON snapshots(timestamp);

  CREATE TABLE volume_hourly (
    pool_id TEXT NOT NULL,
    hour_start INTEGER NOT NULL,
    volume_token0 TEXT NOT NULL,
    volume_token1 TEXT NOT NULL,
    volume_usd REAL,
    swap_count INTEGER NOT NULL,
    PRIMARY KEY (pool_id, hour_start)
  );
  CREATE INDEX volume_hourly_hour_start ON volume_hourly(hour_start);

  CREATE TABLE positions (
    pool_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    tick_lower INTEGER NOT NULL,
    tick_upper INTEGER NOT NULL,
    liquidity TEXT NOT NULL,
    updated_block TEXT NOT NULL,
    PRIMARY KEY (pool_id, token_id)
  );

  CREATE TABLE prices (
    token TEXT PRIMARY KEY,
    usd REAL NOT NULL,
    via_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE scores (
    pool_id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    health_json TEXT NOT NULL,
    gap_json TEXT NOT NULL,
    persistence_24h_json TEXT NOT NULL,
    persistence_7d_json TEXT NOT NULL,
    volume_24h_usd REAL,
    depth2_usd REAL,
    health_total REAL NOT NULL,
    gap_score REAL
  );
  CREATE INDEX scores_depth2_usd ON scores(depth2_usd);
  CREATE INDEX scores_volume_24h_usd ON scores(volume_24h_usd);
  CREATE INDEX scores_health_total ON scores(health_total);
  CREATE INDEX scores_gap_score ON scores(gap_score);

  CREATE TABLE sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Version 2: market-maker scorecards (docs/design/scorecards.md §4). `addresses_json` is a JSON
  // array of lowercase addresses, `kpis_json` a MandateKpis, `attribution_json` an MmAttribution
  // (no bigints), `breaches_json` a BreachKind[] and `payload_json` the posted alert body.
  // `within_kpi` is NULL when the sample was not evaluable (a required USD price was missing).
  `
  CREATE TABLE mandates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    market_maker TEXT NOT NULL,
    addresses_json TEXT NOT NULL,
    kpis_json TEXT NOT NULL,
    alert_webhook_url TEXT,
    alert_after_samples INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    notes TEXT
  );
  CREATE INDEX mandates_pool_id ON mandates(pool_id);

  CREATE TABLE mm_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandate_id TEXT NOT NULL,
    pool_id TEXT NOT NULL,
    block_number TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    attribution_json TEXT NOT NULL,
    within_kpi INTEGER,
    breaches_json TEXT NOT NULL
  );
  CREATE INDEX mm_samples_mandate_timestamp ON mm_samples(mandate_id, timestamp);

  CREATE TABLE mm_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mandate_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    kind TEXT NOT NULL,
    streak_samples INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    delivered INTEGER NOT NULL,
    response_status INTEGER,
    error TEXT
  );
  CREATE INDEX mm_alerts_mandate_timestamp ON mm_alerts(mandate_id, timestamp);
  `,
  // Version 3: one snapshot per pool and block, one sample per mandate and block, so a second
  // process writing the same block (a one-shot `snapshot` or `mm sample` beside a running
  // pipeline) adds nothing (the repositories insert with OR IGNORE). Copies stored before are
  // deleted first, keeping the first row stored: the one alerts and streaks were computed from.
  `
  DELETE FROM snapshots WHERE id NOT IN (
    SELECT MIN(id) FROM snapshots GROUP BY pool_id, block_number
  );
  CREATE UNIQUE INDEX snapshots_pool_block ON snapshots(pool_id, block_number);

  DELETE FROM mm_samples WHERE id NOT IN (
    SELECT MIN(id) FROM mm_samples GROUP BY mandate_id, block_number
  );
  CREATE UNIQUE INDEX mm_samples_mandate_block ON mm_samples(mandate_id, block_number);
  `,
  // Version 4: retention deletes by timestamp across all mandates.
  `
  CREATE INDEX mm_samples_timestamp ON mm_samples(timestamp);
  CREATE INDEX mm_alerts_timestamp ON mm_alerts(timestamp);
  `,
  // Version 5: the stale-quote measure of every new snapshot.
  `
  ALTER TABLE snapshots ADD COLUMN price_deviation_bps REAL;
  `,
  // Version 6: `owner_top1_share` holds the largest owner's share only where the owners describe
  // the pool (core's `poolOwnerTop1Share`: owners in the band covering at least 0.9, which is
  // OWNER_COVERAGE_MIN, of its in-band liquidity), as every insert since stores it.
  `
  UPDATE snapshots SET owner_top1_share = NULL
    WHERE owner_top1_share IS NOT NULL AND NOT (
      COALESCE(json_extract(concentration_json, '$.owners.count'), 0) > 0
      AND COALESCE(json_extract(concentration_json, '$.owners.coverage'), 0) >= 0.9
    );
  `,
  // Version 7: the LP fee each snapshot's depth and spread used (`PoolSnapshot.feePips`); NULL for
  // rows stored before. Slipstream fees change from block to block, so the pool's fee alone does
  // not say which one a stored snapshot was computed with.
  `
  ALTER TABLE snapshots ADD COLUMN fee_pips INTEGER;
  `,
  // Version 8: tokenized stocks. `reference_json` is a PoolReference (no bigint), NULL for a pool
  // without a stock and in rows stored before. `stocks` is the stock list as the last snapshot
  // pass wrote it (the feed columns NULL for a stock without a feed). `stock_readings` holds one
  // reading per stock and block: bigints as decimal TEXT, `paused_features` the feature names
  // comma-separated ('' for none, NULL when unread), `pass_depth_json` a StockPassDepth. The
  // (token, timestamp) index serves a stock's newest reading and its series, since the table is
  // never pruned.
  `
  ALTER TABLE snapshots ADD COLUMN reference_json TEXT;

  CREATE TABLE stocks (
    token TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL,
    ticker TEXT NOT NULL,
    feed TEXT,
    feed_decimals INTEGER,
    heartbeat_seconds INTEGER,
    deviation_threshold_bps INTEGER,
    feed_hours TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE stock_readings (
    token TEXT NOT NULL,
    block_number TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    status TEXT NOT NULL,
    reference_usd REAL,
    feed_age_seconds INTEGER,
    feed_round_id TEXT,
    feed_answer TEXT,
    feed_updated_at INTEGER,
    oracle_multiplier TEXT,
    oracle_paused INTEGER,
    token_multiplier TEXT,
    paused_features TEXT,
    error TEXT,
    pass_depth_json TEXT,
    PRIMARY KEY (token, block_number)
  );
  CREATE INDEX stock_readings_timestamp ON stock_readings(timestamp);
  CREATE INDEX stock_readings_token_timestamp ON stock_readings(token, timestamp);
  `,
]

export const SCHEMA_VERSION = MIGRATIONS.length

export interface MigrationResult {
  /** Version found before migrating (0 for a fresh database). */
  from: number
  /** Version after migrating (always SCHEMA_VERSION). */
  to: number
}

function refuseNewer(version: number): void {
  if (version <= SCHEMA_VERSION) return
  throw new Error(
    `db: database schema version ${version} is newer than this build (${SCHEMA_VERSION}); upgrade depthwatch`,
  )
}

/** The recorded version, or undefined while `schema_version` does not exist (a new file). */
function recordedVersion(db: DatabaseSync): number | undefined {
  const table = db
    .prepare(
      `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`,
    )
    .get()
  return table === undefined ? undefined : currentVersion(db)
}

/**
 * Creates `schema_version` when missing and applies every pending migration in one transaction,
 * reading the version inside it (see the header).
 */
export function applyMigrations(db: DatabaseSync, now: () => number): MigrationResult {
  const recorded = recordedVersion(db)
  if (recorded !== undefined) {
    refuseNewer(recorded)
    if (recorded === SCHEMA_VERSION) return { from: recorded, to: recorded }
  }

  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
    )
    const from = currentVersion(db)
    refuseNewer(from)
    const record = db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
    for (let version = from + 1; version <= SCHEMA_VERSION; version++) {
      const sql = MIGRATIONS[version - 1]
      if (sql === undefined) throw new Error(`db: migration ${version} is missing`)
      db.exec(sql)
      record.run(version, now())
    }
    db.exec('COMMIT')
    return { from, to: SCHEMA_VERSION }
  } catch (error) {
    // Everything here runs after BEGIN: roll back (`rollback` does not need
    // `DatabaseSync#isTransaction`, which Node only has from 22.16).
    rollback(db)
    throw error
  }
}

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_version').get()
  const version = row?.version
  if (typeof version === 'number') return version
  if (typeof version === 'bigint') return toCount(version)
  return 0
}
