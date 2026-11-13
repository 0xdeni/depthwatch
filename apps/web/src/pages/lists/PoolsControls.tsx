/**
 * The Pools controls on the band (docs/design/visual-v4.md §6.3, §5.4, §5.10, PH4, TB7).
 *
 * Desktop: the white search (up to 380 px), the band's "All pools / Rated only" segmented control,
 * a spacer and the on-band ghost "Columns" button (the shared pools table's ColumnsMenu); the DEX
 * filter sits in the band's left column (`PoolsDexFilter`).
 * Phones: the full-width search, then two equal 44 px buttons that state their value, "All DEXes"
 * with the filter icon and "Sort: health" with its direction arrow, each opening a bottom sheet:
 * Filter pools holds each DEX with its share of the depth and the rating, Sort pools is the
 * shared one, which is also the column picker.
 */
import { type Dex, POOL_QUERY_MAX_LENGTH } from '@depthwatch/core'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { SortDir, StatsResponse } from '../../api/types.js'
import { Button } from '../../components/ui/Button.js'
import {
  DexFilter,
  type DexShare,
  dexShareLabel,
  dexShares,
} from '../../components/ui/DexFilter.js'
import { SearchInput } from '../../components/ui/Inputs.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { Sheet, SheetOptions } from '../../components/ui/Sheet.js'
import { ColumnsMenu, SortSheet } from '../../components/ui/TableControls.js'
import { dexLabel, shareOf } from '../../lib/format.js'
import { isKeyboardClick } from '../../lib/motion.js'
import type { OptionalColumn, PoolsSortKey } from '../../lib/poolsTable.js'

type DexValue = Dex | 'all'
type RatingValue = 'all' | 'rated'

/** Which pools the table offers: every pool (the unrated ones behind a row) or only the rated. */
export const RATING_OPTIONS: ReadonlyArray<{ value: RatingValue; label: string }> = [
  { value: 'all', label: 'All pools' },
  { value: 'rated', label: 'Rated only' },
]

/** The phone filter button's label: the DEX's short name ("Aerodrome CL"), or "All DEXes". */
const SHORT: Partial<Record<Dex, string>> = {
  'aerodrome-slipstream': 'Aerodrome CL',
  'aero-slipstream': 'Aero CL',
}
export function dexShort(dex: Dex | ''): string {
  if (!dex) return 'All DEXes'
  return SHORT[dex] ?? dexLabel(dex)
}

/** How the change was made: keyboard changes never animate (M2). */
export interface ChangeMeta {
  keyboard: boolean
}

/** The DEX rows of the filter (All DEXes, then each DEX by depth), or null before the stats. */
export function useDexRows(stats: StatsResponse | undefined): DexShare[] | null {
  return stats ? dexShares(stats.byDex, stats.totals.depth2Usd) : null
}

/** The DEX filter on the band's left column (desktop), its rows fed by `stats.byDex`. */
export function PoolsDexFilter({
  rows,
  dex,
  onDex,
}: {
  rows: readonly DexShare[]
  dex: Dex | ''
  onDex: (dex: Dex | '', meta: ChangeMeta) => void
}) {
  return (
    <div className="lists-dex" data-in>
      <DexFilter rows={rows} value={dex || null} onChange={(v, meta) => onDex(v ?? '', meta)} />
    </div>
  )
}

export interface PoolsControlsProps {
  phone: boolean
  search: string
  onSearch: (value: string) => void
  /** The DEX rows with their shares, for the phone's Filter sheet; null before the stats. */
  dexRows: readonly DexShare[] | null
  dex: Dex | ''
  onDex: (dex: Dex | '', meta: ChangeMeta) => void
  sort: PoolsSortKey
  dir: SortDir
  /** A new sort metric from the phone sheet, at its default direction. */
  onSortKey: (key: PoolsSortKey) => void
  onDir: (dir: SortDir) => void
  cols: readonly OptionalColumn[]
  onCols: (cols: OptionalColumn[]) => void
  /** Some loaded pool has its top LP share: it is offered as a sort and a column. */
  topShare: boolean
  /** "Rated only": the pools with no grade are not offered. */
  ratedOnly: boolean
  onRatedOnly: (ratedOnly: boolean, meta: ChangeMeta) => void
}

export function PoolsControls(props: PoolsControlsProps) {
  const { phone, search, onSearch } = props
  return (
    <div className="lists-ctl" data-in>
      <SearchInput value={search} onChange={onSearch} maxLength={POOL_QUERY_MAX_LENGTH} />
      {phone ? <PhoneControls {...props} /> : <DesktopControls {...props} />}
    </div>
  )
}

function DesktopControls({ cols, onCols, topShare, ratedOnly, onRatedOnly }: PoolsControlsProps) {
  return (
    <>
      <SegmentedControl<RatingValue>
        label="Rating"
        options={RATING_OPTIONS}
        value={ratedOnly ? 'rated' : 'all'}
        onChange={(v, meta) => onRatedOnly(v === 'rated', meta)}
        onBand
      />
      <span className="lists-spacer" />
      <ColumnsMenu cols={cols} onChange={onCols} topShare={topShare} className="lists-cols" />
    </>
  )
}

/** Open state of one phone sheet, and whether it moves (keyboard opens and closes are instant). */
function useSheet() {
  const [open, setOpen] = useState(false)
  const [instant, setInstant] = useState(false)
  return {
    open,
    instant,
    show: (e: MouseEvent) => {
      setInstant(isKeyboardClick(e))
      setOpen(true)
    },
    close: (keyboard = false) => {
      if (keyboard) setInstant(true)
      setOpen(false)
    },
  }
}

function PhoneControls({
  dexRows,
  dex,
  onDex,
  sort,
  dir,
  onSortKey,
  onDir,
  topShare,
  ratedOnly,
  onRatedOnly,
}: PoolsControlsProps) {
  const filter = useSheet()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  const rows = dexRows ?? [{ dex: null, label: 'All DEXes', share: null }]
  return (
    <div className="lists-ph-ctl">
      <Button
        icon="filter"
        aria-haspopup="dialog"
        aria-expanded={filter.open}
        onClick={filter.show}
      >
        {dexShort(dex)}
      </Button>
      <SortSheet sort={sort} dir={dir} onSort={onSortKey} onDir={onDir} topShare={topShare} />
      <Sheet
        open={filter.open}
        instant={filter.instant}
        onClose={() => filter.close()}
        title="Filter pools"
      >
        {/* A tap picks the DEX and closes the sheet after the check lands (160 ms); Enter or
            Space closes it at once; arrow keys only move the selection. */}
        <div
          onClickCapture={(e) => {
            if (!(e.target as Element).closest('.opt')) return
            clearTimeout(closeTimer.current)
            if (isKeyboardClick(e)) filter.close(true)
            else closeTimer.current = setTimeout(() => filter.close(), 160)
          }}
        >
          <SheetOptions<DexValue>
            heading
            label="DEX"
            options={rows.map((r) => ({
              value: r.dex ?? 'all',
              label: r.label,
              meta: r.share === null ? undefined : shareOf(r.share),
              ariaLabel: dexShareLabel(r),
            }))}
            value={dex || 'all'}
            onChange={(v) => onDex(v === 'all' ? '' : v, { keyboard: true })}
          />
          <SheetOptions<RatingValue>
            heading
            label="Rating"
            options={RATING_OPTIONS}
            value={ratedOnly ? 'rated' : 'all'}
            onChange={(v) => onRatedOnly(v === 'rated', { keyboard: true })}
          />
        </div>
      </Sheet>
    </div>
  )
}
