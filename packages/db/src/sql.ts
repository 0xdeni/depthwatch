/**
 * Low-level helpers shared by the repositories: parameter binding, typed column readers,
 * address normalisation and LIKE escaping.
 *
 * node:sqlite cannot bind booleans, `undefined` or bigints wider than 64 bits, so every parameter
 * goes through `bind`: bigints become decimal TEXT (our storage format for raw amounts), booleans
 * become 0/1 and `undefined` becomes NULL.
 */

import type { SQLInputValue, SQLOutputValue } from 'node:sqlite'
import type { Address } from '@depthwatch/core'

export type Row = Record<string, SQLOutputValue>
export type BindValue = SQLInputValue | boolean | undefined

export function toSqlValue(value: BindValue): SQLInputValue {
  if (value === undefined) return null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

export function bind(values: readonly BindValue[]): SQLInputValue[] {
  return values.map(toSqlValue)
}

function column(row: Row, col: string): SQLOutputValue {
  if (!(col in row)) throw new Error(`db: missing column "${col}"`)
  return row[col] ?? null
}

export function colText(row: Row, col: string): string {
  const v = column(row, col)
  if (typeof v !== 'string') throw new Error(`db: column "${col}" is not text (${typeof v})`)
  return v
}

export function colTextOrNull(row: Row, col: string): string | null {
  return column(row, col) === null ? null : colText(row, col)
}

export function colNumber(row: Row, col: string): number {
  const v = column(row, col)
  if (typeof v === 'number') return v
  if (
    typeof v === 'bigint' &&
    v >= BigInt(Number.MIN_SAFE_INTEGER) &&
    v <= BigInt(Number.MAX_SAFE_INTEGER)
  )
    return Number(v)
  throw new Error(`db: column "${col}" is not a number (${typeof v})`)
}

export function colNumberOrNull(row: Row, col: string): number | null {
  return column(row, col) === null ? null : colNumber(row, col)
}

const INTEGER_TEXT = /^-?\d+$/

export function colBigint(row: Row, col: string): bigint {
  const v = column(row, col)
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isInteger(v)) return BigInt(v)
  if (typeof v === 'string' && INTEGER_TEXT.test(v)) return BigInt(v)
  throw new Error(`db: column "${col}" is not an integer string (${String(v)})`)
}

export function colBigintOrNull(row: Row, col: string): bigint | null {
  return column(row, col) === null ? null : colBigint(row, col)
}

export function colBool(row: Row, col: string): boolean {
  return colNumber(row, col) !== 0
}

export function colJson<T>(row: Row, col: string): T {
  return JSON.parse(colText(row, col)) as T
}

export function colJsonOrNull<T>(row: Row, col: string): T | null {
  return column(row, col) === null ? null : colJson<T>(row, col)
}

/** Addresses are compared lowercase everywhere (DESIGN.md rule 2). */
export function normalizeAddress(address: string): Address {
  return address.toLowerCase() as Address
}

/** Serialises a list for `IN (SELECT value FROM json_each(?))`, a single parameter of any length. */
export function jsonList(values: readonly string[]): string {
  return JSON.stringify(values)
}

/** `%needle%` pattern for `LIKE ? ESCAPE '\'`, with LIKE metacharacters escaped. */
export function likeContains(needle: string): string {
  return `%${likeLiteral(needle)}%`
}

/** `prefix%` pattern for `LIKE ? ESCAPE '\'`, with LIKE metacharacters escaped. */
export function likePrefix(prefix: string): string {
  return `${likeLiteral(prefix)}%`
}

/** `text` with the LIKE metacharacters (`%`, `_`) and the escape character escaped. */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Validates pagination arguments and returns the values to bind for `LIMIT ? OFFSET ?` (-1 = no limit). */
export function page(
  limit: number | undefined,
  offset: number | undefined,
  defaultLimit = -1,
): [limit: number, offset: number] {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0))
    throw new RangeError(`db: invalid limit ${limit}`)
  const off = offset ?? 0
  if (!Number.isInteger(off) || off < 0) throw new RangeError(`db: invalid offset ${offset}`)
  return [limit ?? defaultLimit, off]
}

export function toCount(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value
}
