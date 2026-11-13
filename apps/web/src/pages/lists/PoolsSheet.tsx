/**
 * The Pools table sheet (docs/design/visual-v4.md §5.8, §6.3): one plane-2 block stacked over the
 * band's lower edge, flush and clipped to its radius. A caption row (the live count of rated pools
 * at left, "All pools updated …" at right), the shared pools table (rows on phones), then its foot:
 * "Show 50 more pools" (pages of 50, `page`), on phones "Show all 50 rated pools" after the first
 * 25 (`rows=all`), and once every rated row is on screen the one toggle that adds the unrated pools
 * under an "Unrated pools" row (`unrated`, pages of 50), with "Show 50 more unrated pools" beside it.
 */
import { type Dex, poolSearch } from '@depthwatch/core'
import type { PoolSummary } from '../../api/types.js'
import { Button } from '../../components/ui/Button.js'
import { PoolsTable } from '../../components/ui/PoolsTable.js'
import { EmptyState, Refetch } from '../../components/ui/States.js'
import { dexLabel } from '../../lib/format.js'
import { updatedCaption } from '../../lib/poolsTable.js'
import { PAGE_SIZE, type PoolsState, showAllRowsLabel, visibleRows } from './poolsState.js'
import { poolsCount, showUnratedLabel } from './poolsText.js'
import { dexesNamedBy } from './searchDexes.js'
import type { PoolRows } from './usePoolRows.js'

export interface PoolsSheetProps {
  state: PoolsState
  phone: boolean
  now: number
  /** The rated pools for the URL state. */
  pools: PoolRows
  /** The unrated pools, loaded once the reader opens them. */
  unrated: PoolRows
  /** Unrated pools matching the filters. */
  unratedTotal: number
  /** Scored and rated pools in the stats, for the empty state and the filtered count. */
  scored: number | undefined
  rated: number | undefined
  update: (patch: Partial<PoolsState>) => void
  onSort: (key: PoolsState['sort']) => void
  onClearSearch: () => void
}

export function PoolsSheet(props: PoolsSheetProps) {
  const { state, phone, now, pools, unrated, unratedTotal, update } = props
  const rows = pools.rows ?? []
  const unratedOpen = !state.ratedOnly && state.unrated > 0
  const rated = visibleRows(rows, { phone, allRows: state.allRows, unratedOpen })
  // The phone shows 25 rated rows at first; the rest of the loaded page waits behind one button.
  const held = rows.length - rated.length
  const extra = unratedOpen && unrated.rows?.length ? unrated.rows : []
  const shown: PoolSummary[] = [...rated, ...extra]
  const divider = extra.length ? { at: rated.length, label: 'Unrated pools' } : undefined
  // The unrated pools are offered once every rated one is on screen.
  const offerUnrated = !state.ratedOnly && pools.remaining === 0 && held === 0 && unratedTotal > 0
  const filtered = state.q.trim() !== '' || state.dex !== ''
  const total = pools.total ?? rows.length
  return (
    <>
      <div className="tbl-caption">
        <span aria-live="polite">
          {poolsCount(total, props.rated, filtered, {
            shown: extra.length,
            total: unrated.total ?? unratedTotal,
          })}
        </span>
        <span>{updatedCaption(shown, now)}</span>
      </div>
      {shown.length ? (
        <Refetch busy={pools.busy}>
          <PoolsTable
            rows={shown}
            state={state}
            now={now}
            phone={phone}
            onSort={props.onSort}
            label="Pools"
            describedBy="pools-answer"
            divider={divider}
          />
        </Refetch>
      ) : (
        <div className="lists-empty">
          <PoolsEmpty
            state={state}
            scored={props.scored}
            rated={props.rated}
            hasUnrated={!state.ratedOnly && unratedTotal > 0}
            onClear={props.onClearSearch}
            onAllDexes={() => update({ dex: '' })}
            onSearchDex={(dex, q) => update({ dex, q })}
          />
        </div>
      )}
      <SheetFoot {...props} held={held} offerUnrated={offerUnrated} />
    </>
  )
}

function SheetFoot({
  state,
  pools,
  unrated,
  unratedTotal,
  update,
  held,
  offerUnrated,
}: PoolsSheetProps & { held: number; offerUnrated: boolean }) {
  const unratedOpen = !state.ratedOnly && state.unrated > 0
  const more =
    held > 0 ? (
      <Button onClick={() => update({ allRows: true })}>
        {showAllRowsLabel(pools.rows?.length ?? 0, pools.remaining === 0)}
      </Button>
    ) : pools.remaining > 0 ? (
      <Button loading={pools.loadingMore} onClick={() => update({ page: state.page + 1 })}>
        Show {Math.min(PAGE_SIZE, pools.remaining)} more pools
      </Button>
    ) : null
  if (!more && !offerUnrated) return null
  return (
    <div className="tbl-foot">
      {more}
      {offerUnrated ? (
        <>
          {/* One toggle that stays mounted, so keyboard focus stays on it when it is pressed;
              the caption's live region says how many unrated pools are now on screen. */}
          <Button
            aria-expanded={unratedOpen}
            onClick={() => update({ unrated: unratedOpen ? 0 : 1 })}
          >
            {unratedOpen ? 'Hide unrated pools' : showUnratedLabel(unratedTotal)}
          </Button>
          {unratedOpen && unrated.remaining > 0 ? (
            <Button
              loading={unrated.loadingMore}
              onClick={() => update({ unrated: state.unrated + 1 })}
            >
              Show {Math.min(PAGE_SIZE, unrated.remaining)} more unrated pools
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/**
 * Empty (ST2): what is empty, and the one next step. Never shown before data has loaded. Search
 * reads tokens and addresses, never the DEX: a search that names a DEX ("uniswap v3 weth") is
 * told so and, when it names one, offered that DEX with the rest of the search; a pasted pool id
 * of another DEX than the filter's is offered every DEX, keeping the id.
 */
function PoolsEmpty({
  state,
  scored,
  rated,
  hasUnrated,
  onClear,
  onAllDexes,
  onSearchDex,
}: {
  state: PoolsState
  scored: number | undefined
  rated: number | undefined
  /** Unrated pools match the filters, so "no pools" would be wrong: no rated pools. */
  hasUnrated: boolean
  onClear: () => void
  onAllDexes: () => void
  onSearchDex: (dex: Dex, q: string) => void
}) {
  const q = state.q.trim()
  const noun = hasUnrated || state.ratedOnly ? 'rated pools' : 'pools'
  if (q) {
    const none = `No ${noun} match “${q}”${state.dex ? ` on ${dexLabel(state.dex)}` : ''}`
    const search = poolSearch(q)
    if (search.kind === 'pool-id' && state.dex && search.dex !== state.dex) {
      return (
        <EmptyState action={<Button onClick={onAllDexes}>Show all DEXes</Button>}>
          {none}: the id names {dexLabel(search.dex)}.
        </EmptyState>
      )
    }
    const named = dexesNamedBy(q)
    const [only] = named
    if (only) {
      const action =
        named.length === 1 ? (
          <Button onClick={() => onSearchDex(only.dex, only.rest)}>
            {only.rest
              ? `Search “${only.rest}” on ${dexLabel(only.dex)}`
              : `Show ${dexLabel(only.dex)} pools`}
          </Button>
        ) : (
          <Button onClick={onClear}>Clear search</Button>
        )
      return (
        <EmptyState action={action}>
          {none}: search reads tokens and addresses, and DEXes have their own filter.
        </EmptyState>
      )
    }
    return <EmptyState action={<Button onClick={onClear}>Clear search</Button>}>{none}.</EmptyState>
  }
  if (state.dex && scored !== 0) {
    return (
      <EmptyState action={<Button onClick={onAllDexes}>Show all DEXes</Button>}>
        {hasUnrated || state.ratedOnly
          ? `No pools on ${dexLabel(state.dex)} are rated yet.`
          : `No pools on ${dexLabel(state.dex)} are scored yet.`}
      </EmptyState>
    )
  }
  if (scored !== undefined && scored > 0 && rated === 0) {
    return <EmptyState>No pool is deep enough to rate yet.</EmptyState>
  }
  return <EmptyState>No pools are scored yet. Scores appear after the first snapshots.</EmptyState>
}
