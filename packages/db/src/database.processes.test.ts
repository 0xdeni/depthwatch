/**
 * Several processes opening one file at the same instant, the way `serve`, `start` and a one-shot
 * command can: each child loads `openDatabase` through tsx, reports `ready`, then opens every path
 * it is sent on stdin the moment the line arrives. The paths go to every child in one loop, so the
 * opens race on a brand-new file (the switch to WAL and migration 1 onwards) and on a version-1
 * file (the upgrade). Every open must succeed and exactly one child must apply the migrations.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openDatabase } from './database.js'
import { currentVersion, SCHEMA_VERSION } from './schema.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const PROCESSES = 4
const ROUNDS = 4

/** The child: opens each path read from stdin and prints `{ ok, from }` or `{ ok: false, error }`. */
const CHILD = `
const { openDatabase } = await import(process.env.DEPTHWATCH_TEST_DATABASE_MODULE)
const { createInterface } = await import('node:readline')
process.stdout.write('ready\\n')
for await (const path of createInterface({ input: process.stdin })) {
  let line
  try {
    const db = openDatabase(path)
    line = { ok: true, from: db.migration.from, to: db.migration.to }
    db.close()
  } catch (error) {
    line = { ok: false, error: String(error?.message ?? error) }
  }
  process.stdout.write(JSON.stringify(line) + '\\n')
}
`

interface OpenResult {
  ok: boolean
  from?: number
  to?: number
  error?: string
}

interface Child {
  process: ChildProcess
  next: () => Promise<string>
}

function spawnChild(): Child {
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', CHILD], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '',
      DEPTHWATCH_TEST_DATABASE_MODULE: pathToFileURL(join(HERE, 'database.ts')).href,
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  const stdout = child.stdout
  if (stdout === null) throw new Error('child without stdout')
  const lines = createInterface({ input: stdout })[Symbol.asyncIterator]()
  const next = async () => {
    const line = await lines.next()
    if (line.done) throw new Error('child exited')
    return String(line.value)
  }
  return { process: child, next }
}

/** Sends `path` to every child in one loop and collects each child's answer. */
async function openEverywhere(children: readonly Child[], path: string): Promise<OpenResult[]> {
  for (const child of children) child.process.stdin?.write(`${path}\n`)
  return Promise.all(children.map(async (child) => JSON.parse(await child.next()) as OpenResult))
}

/** A database the way a version-1 build left it: layer 1 tables only. */
function versionOneFile(path: string): void {
  const db = openDatabase(path)
  db.raw.exec('DROP TABLE mm_alerts; DROP TABLE mm_samples; DROP TABLE mandates')
  db.raw.exec('DROP INDEX snapshots_pool_block')
  db.raw.exec('ALTER TABLE snapshots DROP COLUMN price_deviation_bps')
  db.raw.exec('ALTER TABLE snapshots DROP COLUMN fee_pips')
  db.raw.exec('DROP TABLE stock_readings; DROP TABLE stocks')
  db.raw.exec('ALTER TABLE snapshots DROP COLUMN reference_json')
  db.raw.prepare('DELETE FROM schema_version WHERE version > 1').run()
  expect(currentVersion(db.raw)).toBe(1)
  db.close()
}

describe('openDatabase from several processes at once', () => {
  const children: Child[] = []
  let dir = ''

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-db-processes-'))
    for (let i = 0; i < PROCESSES; i++) children.push(spawnChild())
    for (const child of children) expect(await child.next()).toBe('ready')
  }, 60_000)

  afterAll(() => {
    for (const child of children) {
      child.process.stdin?.end()
      child.process.kill()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  function expectOneMigrator(results: readonly OpenResult[], from: number): void {
    expect(results.filter((result) => !result.ok)).toEqual([])
    expect(results.every((result) => result.to === SCHEMA_VERSION)).toBe(true)
    expect(results.filter((result) => result.from === from)).toHaveLength(1)
    expect(results.filter((result) => result.from === SCHEMA_VERSION)).toHaveLength(PROCESSES - 1)
  }

  function expectMigratedOnce(path: string): void {
    const db = openDatabase(path)
    expect(db.migration).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
    expect(db.raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM schema_version').get()).toEqual({
      n: SCHEMA_VERSION,
    })
    db.close()
  }

  it('creates a new file once and opens it in every process', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const path = join(dir, `fresh-${round}.sqlite`)
      expectOneMigrator(await openEverywhere(children, path), 0)
      expectMigratedOnce(path)
    }
  }, 60_000)

  it('upgrades a version-1 file once and opens it in every process', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const path = join(dir, `v1-${round}.sqlite`)
      versionOneFile(path)
      expectOneMigrator(await openEverywhere(children, path), 1)
      expectMigratedOnce(path)
    }
  }, 60_000)
})
