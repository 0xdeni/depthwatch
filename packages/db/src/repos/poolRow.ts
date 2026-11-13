/**
 * Shared SELECT fragments, filter builder and row mapper for pools joined with their tokens.
 * Used by PoolsRepo and ScoresRepo so a PoolMeta is materialised in exactly one place.
 */
import {
  type Address,
  type Dex,
  type Hex,
  POOL_QUERY_WORD_BREAKS,
  type PoolKind,
  type PoolMeta,
  poolSearch,
  type TokenInfo,
} from '@depthwatch/core'
import {
  type BindValue,
  colBigint,
  colBool,
  colNumber,
  colNumberOrNull,
  colText,
  colTextOrNull,
  likeContains,
  likePrefix,
  normalizeAddress,
  type Row,
} from '../sql.js'

export const POOL_SELECT = `
  p.id AS p_id, p.dex AS p_dex, p.kind AS p_kind, p.address AS p_address, p.pool_id AS p_pool_id,
  p.token0 AS p_token0, p.token1 AS p_token1, p.fee_pips AS p_fee_pips,
  p.tick_spacing AS p_tick_spacing, p.stable AS p_stable, p.hooks AS p_hooks,
  p.created_at_block AS p_created_at_block, p.tracked AS p_tracked, p.first_seen_at AS p_first_seen_at,
  t0.symbol AS t0_symbol, t0.name AS t0_name, t0.decimals AS t0_decimals,
  t1.symbol AS t1_symbol, t1.name AS t1_name, t1.decimals AS t1_decimals`

export const POOL_FROM = `pools p
  JOIN tokens t0 ON t0.address = p.token0
  JOIN tokens t1 ON t1.address = p.token1`

export interface PoolFilter {
  dex?: Dex
  tracked?: boolean
  /**
   * Search text, read by core's `poolSearch` and matched as `matchesPoolSearch` says. A pasted
   * pool id (`uniswap-v3:0xd0b5…`, also with "%3A" or as the pool's link) finds the pools on that
   * DEX whose address or v4 pool id starts with its hex. Any other text is split into terms by
   * `poolQueryTerms`, and every term must match: anywhere in either token's symbol or address,
   * the pool address or the v4 pool id, or at the start of a word in either token's name. Terms
   * never read the DEX (`dex` filters it).
   */
  q?: string
  /**
   * A token address (any case): pools with exactly it as token0 or token1. Unlike `q`, never
   * matched against symbols, which are free on-chain strings and may contain an address.
   */
  token?: Address
}

export interface PoolRecord {
  pool: PoolMeta
  tracked: boolean
  firstSeenAt: number
}

const LIKE = `LIKE ? ESCAPE '\\'`

/** The columns a search term may match anywhere: token symbols and addresses, the pool's address and id. */
const ANYWHERE_COLUMNS = [
  't0.symbol',
  't0.address',
  't1.symbol',
  't1.address',
  'p.address',
  'p.pool_id',
] as const

/** The columns a term must match at the start of a word: the token names. */
const WORD_COLUMNS = ['t0.name', 't1.name'] as const

/** `column` with a space before each word: a leading space, and every word break as a space. */
function spacedWords(column: string): string {
  return `(' ' || ${POOL_QUERY_WORD_BREAKS.reduce((sql, mark) => `replace(${sql}, '${mark}', ' ')`, column)})`
}

/** One term's condition: core's `matchesPoolTerms` for a single term, in SQL. */
const TERM_SQL = `(${[
  ...ANYWHERE_COLUMNS.map((column) => `${column} ${LIKE}`),
  ...WORD_COLUMNS.map((column) => `${spacedWords(column)} ${LIKE}`),
].join(' OR ')})`

/** The parameters of `TERM_SQL` for one folded term: contains it, or contains " " + it. */
function termParams(term: string): BindValue[] {
  const anywhere = likeContains(term)
  const wordStart = `% ${anywhere.slice(1)}`
  return [...ANYWHERE_COLUMNS.map(() => anywhere), ...WORD_COLUMNS.map(() => wordStart)]
}

/**
 * A pasted pool id's condition, core's `matchesPoolId` in SQL: the DEX, then the address or v4
 * pool id starting with the id's hex (`LIKE` folds ASCII case, as core does).
 */
const POOL_ID_SQL = `(p.dex = ? AND (p.address ${LIKE} OR p.pool_id ${LIKE}))`

/**
 * Whether the filter reads token columns: only the terms of `q` match symbols and names; a pasted
 * pool id and the other filters read `pools` alone.
 */
export function filterReadsTokens(filter: PoolFilter): boolean {
  const search = poolSearch(filter.q)
  return search.kind === 'terms' && search.terms.length > 0
}

/** WHERE conditions (without the keyword) and their bound parameters for a PoolFilter. */
export function poolFilterClauses(filter: PoolFilter): { clauses: string[]; params: BindValue[] } {
  const clauses: string[] = []
  const params: BindValue[] = []
  if (filter.dex !== undefined) {
    clauses.push('p.dex = ?')
    params.push(filter.dex)
  }
  if (filter.tracked !== undefined) {
    clauses.push('p.tracked = ?')
    params.push(filter.tracked)
  }
  if (filter.token !== undefined) {
    const token = normalizeAddress(filter.token)
    clauses.push('(p.token0 = ? OR p.token1 = ?)')
    params.push(token, token)
  }
  const search = poolSearch(filter.q)
  if (search.kind === 'pool-id') {
    const prefix = likePrefix(search.keyPrefix)
    clauses.push(POOL_ID_SQL)
    params.push(search.dex, prefix, prefix)
  } else {
    // Every term must match somewhere, in either token: "usdc weth" finds the WETH / USDC pools.
    for (const term of search.terms) {
      clauses.push(TERM_SQL)
      params.push(...termParams(term))
    }
  }
  return { clauses, params }
}

export function whereSql(clauses: readonly string[]): string {
  return clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`
}

function tokenFromRow(row: Row, prefix: 't0' | 't1', address: Address): TokenInfo {
  return {
    address,
    symbol: colText(row, `${prefix}_symbol`),
    name: colText(row, `${prefix}_name`),
    decimals: colNumber(row, `${prefix}_decimals`),
  }
}

export function rowToPoolMeta(row: Row): PoolMeta {
  const token0 = colText(row, 'p_token0') as Address
  const token1 = colText(row, 'p_token1') as Address
  return {
    id: colText(row, 'p_id'),
    dex: colText(row, 'p_dex') as Dex,
    kind: colText(row, 'p_kind') as PoolKind,
    address: colTextOrNull(row, 'p_address') as Address | null,
    poolId: colTextOrNull(row, 'p_pool_id') as Hex | null,
    token0: tokenFromRow(row, 't0', token0),
    token1: tokenFromRow(row, 't1', token1),
    feePips: colNumber(row, 'p_fee_pips'),
    tickSpacing: colNumberOrNull(row, 'p_tick_spacing'),
    stable: colBool(row, 'p_stable'),
    hooks: colTextOrNull(row, 'p_hooks') as Address | null,
    createdAtBlock: colBigint(row, 'p_created_at_block'),
  }
}

export function rowToPoolRecord(row: Row): PoolRecord {
  return {
    pool: rowToPoolMeta(row),
    tracked: colBool(row, 'p_tracked'),
    firstSeenAt: colNumber(row, 'p_first_seen_at'),
  }
}
