/**
 * Shipped migrations are immutable: a database that recorded version N ran exactly the SQL of
 * MIGRATIONS[0..N-1], so an edit to a shipped entry would leave older files and new ones with
 * different schemas while both report the same version. Each entry's sha256 is pinned here; a
 * schema change is a new entry appended to MIGRATIONS, with its hash appended below once it ships.
 */
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, SCHEMA_VERSION } from './schema.js'

const SHIPPED_SHA256: readonly string[] = [
  'daffb1dbecbc3278ef05609bdd7b414f1956afb6150c9e971effbb090b42b1d3',
  '22752b7d69a9fb85dcd3184c7ee452d659815a3c7557d79c8c25e26e87f9e28c',
  'c5f63b67f25188bcd99afad2fa11db18e7be8aae03773281fb301bff26eef948',
  '7bb1733685f07bc9db37e30f2b456cece98497d8e9ec649f2b26cff2c90b3339',
  'fe9dbd4325bf2371aa0147d8cf814c2f8d3d6afdb655710cf3d1bc25f77f4a84',
  '0d5282ba83b2306956f50c9469b5b73c20f1211d3f891e683b87eec6866c6b01',
  '327cc894a232d6383a4eb29d447cdde13de29d247d150f459245cfc0bf850fb5',
  'e8e666bca5c8bc6e6176ccb430fd0028810b4f0c9a1a90e2a941898ff10b4a9d',
]

const sha256 = (sql: string) => createHash('sha256').update(sql).digest('hex')

describe('MIGRATIONS', () => {
  it('keeps every shipped entry byte for byte', () => {
    expect(MIGRATIONS.slice(0, SHIPPED_SHA256.length).map(sha256)).toEqual(SHIPPED_SHA256)
  })

  it('pins a hash for every entry, so a new one is pinned when it ships', () => {
    expect(MIGRATIONS).toHaveLength(SHIPPED_SHA256.length)
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length)
  })
})
