/**
 * JSON helpers for values that contain bigints.
 *
 * Wire format: bigints become decimal strings. Revival is key-based (a caller passes the set of
 * property names that hold bigints), never pattern-based, so a symbol like "123" is never mangled.
 */

export type Jsonified<T> = T extends bigint
  ? string
  : T extends Array<infer U>
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T

/** Deep-copies `value`, turning every bigint into a decimal string. */
export function toJsonSafe<T>(value: T): Jsonified<T> {
  if (typeof value === 'bigint') return value.toString() as Jsonified<T>
  if (Array.isArray(value)) return value.map((v) => toJsonSafe(v)) as Jsonified<T>
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJsonSafe(v)
    return out as Jsonified<T>
  }
  return value as Jsonified<T>
}

/** JSON.stringify with bigints as decimal strings. */
export function jsonStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), space)
}

/**
 * Deep-copies `value`, turning the string values of the given property names back into bigints.
 * Non-numeric strings under those keys throw.
 */
export function reviveBigints<T>(value: unknown, bigintKeys: ReadonlySet<string>): T {
  const walk = (v: unknown, key: string | null): unknown => {
    if (Array.isArray(v)) return v.map((x) => walk(x, key))
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = walk(x, k)
      return out
    }
    if (typeof v === 'string' && key !== null && bigintKeys.has(key)) {
      if (!/^-?\d+$/.test(v))
        throw new Error(`reviveBigints: "${key}" is not an integer string: ${v}`)
      return BigInt(v)
    }
    return v
  }
  return walk(value, null) as T
}

/** Property names that hold bigints anywhere in the snapshot / volume / position / stock reading types. */
export const BIGINT_KEYS: ReadonlySet<string> = new Set([
  'amountIn',
  'amountOut',
  'feePaid',
  'activeLiquidity',
  'blockNumber',
  'createdAtBlock',
  'liquidity',
  'liquidityNet',
  'liquidityGross',
  'sqrtPriceX96',
  'sqrtPriceAfterX96',
  'tokenId',
  'volumeToken0',
  'volumeToken1',
  'amount0',
  'amount1',
  'reserve0',
  'reserve1',
  'feedRoundId',
  'feedAnswer',
  'oracleMultiplierWad',
  'tokenMultiplierWad',
])
