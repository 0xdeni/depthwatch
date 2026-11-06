/**
 * A stock reading's status in words (docs/design/stocks-api.md §3): Live, Off-hours, Paused,
 * Invalid, Unread or No feed, with its shape (docs/design/visual-v4.md §5.5). In the list it is a
 * status word, the shape in the status colour and the word in ink; on the stock's own page it is
 * the filled chip. A stock whose transfers are paused also carries "Transfers paused", a triangle,
 * whatever the feed says. Red and Green are never text.
 */
import type { ReferenceStatus } from '@depthwatch/core'
import { Shape, type ShapeName } from '../../components/ui/Icon.js'
import {
  NO_READING,
  STATUS_WORD,
  type StockTone,
  statusTone,
  TRANSFERS_PAUSED,
} from '../../lib/stockText.js'

const SHAPE: Readonly<Record<StockTone, ShapeName>> = {
  ok: 'circle',
  warn: 'square',
  bad: 'triangle',
  none: 'ring',
}

export function StockStatus({
  status,
  chip = false,
}: {
  /** Null: no reading stored yet. */
  status: ReferenceStatus | null
  /** The filled chip of the stock's own page. */
  chip?: boolean
}) {
  const tone = statusTone(status)
  return (
    <span className={`${chip ? 'status-chip' : 'status'} tone-${tone}`}>
      <Shape shape={SHAPE[tone]} />
      {status === null ? NO_READING : STATUS_WORD[status]}
    </span>
  )
}

export function TransfersPaused({ chip = false }: { chip?: boolean }) {
  return (
    <span className={`${chip ? 'status-chip' : 'status'} tone-bad`}>
      <Shape shape="triangle" />
      {TRANSFERS_PAUSED}
    </span>
  )
}
