/**
 * "over time" (ia-v3 §4.3 section 4, docs/design/visual-v4.md §5.9.6, §6.4): the 24 h / 7 d window
 * control, then the depth ±2 % and spread at $10K small multiples sharing one x axis fitted to the
 * snapshots, and the caption that states the span they cover. The 7 d series is drawn under both
 * windows, so 24 h is its tail and a window switch morphs the same points (§4.3; instant from the
 * keyboard). The window lives in the URL (`window`). The finding reads persistence, or says when
 * the snapshots are too few to measure it; Details holds the persistence table and the health, TVL
 * and price series (L2).
 */
import { type ReactNode, useState } from 'react'
import { usePoolHistory } from '../../api/hooks.js'
import type {
  HistoryPoint,
  HistoryWindow,
  PersistenceMetrics,
  PoolDetail,
} from '../../api/types.js'
import { type MultipleSeries, SmallMultiples } from '../../components/charts/SmallMultiples.js'
import { Section } from '../../components/ui/Section.js'
import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { SectionError, Skeleton, useDelayedPending } from '../../components/ui/States.js'
import { TableScroll } from '../../components/ui/TableScroll.js'
import { TextChange } from '../../components/ui/TextChange.js'
import { bps, count, NB, price, score, tokenText, uptime, usd } from '../../lib/format.js'
import { baseQuote } from '../../lib/orient.js'
import { useIsPhone } from '../../lib/useMediaQuery.js'
import { overTimeCaption, persistenceParts, spreadHeadText, tooFewTakeaway } from './poolText.js'

const DAY = 86_400
const WINDOW_LABEL: Readonly<Record<HistoryWindow, string>> = {
  '24h': '24 hours',
  '7d': '7 days',
}
const WINDOW_SHORT: Readonly<Record<HistoryWindow, string>> = {
  '24h': `24${NB}h`,
  '7d': `7${NB}d`,
}

/**
 * The two multiples. Each y range is cropped to its own data and labelled at both ends in the
 * head's own format ("$29.5M", "$29M"), so a 2 % range never reads as a swing without its numbers
 * and a bracket end never contradicts the head (§5.9.6). The spread is never cropped below 2 % of
 * its median, and a spread that moves less than its 0.1 bps precision draws level.
 */
function mainSeries(): MultipleSeries<HistoryPoint>[] {
  return [
    {
      key: 'depth',
      label: `Depth ±2${NB}%, both sides`,
      value: (pt) => pt.depth2Usd,
      format: usd,
    },
    {
      key: 'spread',
      label: 'Spread at $10K',
      value: (pt) => pt.spread10kBps,
      format: bps,
      // Percent first, bps second; the bracket's ends stay in bps, the unit of its precision.
      head: spreadHeadText,
      minSpan: 0.02,
    },
  ]
}

/** A tick of a series whose nice steps can be fractional: "2,450", "84.5", "0.795". */
const fineTick = (v: number) =>
  Number(v.toPrecision(4)).toLocaleString('en-US', { maximumFractionDigits: 6 })

function moreSeries(
  points: readonly HistoryPoint[],
  pool: PoolDetail['pool'],
  spot: number | null,
): MultipleSeries<HistoryPoint>[] {
  // The price reads from the pool's base token, as the title's price line does (N2).
  const { base, quote, inverted } = baseQuote(pool, spot)
  const out: MultipleSeries<HistoryPoint>[] = [
    {
      key: 'health',
      label: 'Health',
      height: 120,
      value: (pt) => pt.health,
      format: score,
      tick: fineTick,
      minSpan: 0.1,
    },
  ]
  if (points.some((pt) => pt.tvlUsd !== null))
    out.push({
      key: 'tvl',
      label: 'TVL',
      height: 120,
      value: (pt) => pt.tvlUsd,
      format: usd,
      minSpan: 0.05,
    })
  out.push({
    key: 'price',
    label: `Price, ${tokenText(quote)} per ${tokenText(base)}`,
    height: 120,
    value: (pt) => (inverted ? (pt.price > 0 ? 1 / pt.price : null) : pt.price),
    format: price,
    tick: fineTick,
    minSpan: 0.02,
  })
  return out
}

function PersistenceTable({ detail }: { detail: PoolDetail }) {
  const rows: [string, PersistenceMetrics | null][] = [
    [WINDOW_SHORT['24h'], detail.persistence24h],
    [WINDOW_SHORT['7d'], detail.persistence7d],
  ]
  const thin = rows.every(([, p]) => (p?.samples ?? 0) < 3)
  const short = !thin && rows.every(([, p]) => p === null || p.stability === null)
  return (
    <>
      <TableScroll>
        <table className="tbl dense">
          <caption className="sr-only">Persistence of depth ±2{NB}% per window</caption>
          <thead>
            <tr>
              <th scope="col">Window</th>
              <th scope="col" className="r">
                Samples
              </th>
              <th scope="col" className="r">
                Median
              </th>
              <th scope="col" className="r">
                p10
              </th>
              <th scope="col" className="r">
                Min
              </th>
              <th scope="col" className="r">
                Stability
              </th>
              <th scope="col" className="r">
                Uptime
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, p]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="r num">{count(p?.samples)}</td>
                <td className="r num">{usd(p?.depthUsdMedian)}</td>
                <td className="r num">{usd(p?.depthUsdP10)}</td>
                <td className="r num">{usd(p?.depthUsdMin)}</td>
                <td className="r num">{uptime(p?.stability)}</td>
                <td className="r num">{uptime(p?.uptime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="tbl-note">
        {thin
          ? 'Fewer than 3 snapshots: persistence is scored neutral until more arrive.'
          : short
            ? 'The snapshots span under a quarter of each window: persistence is scored neutral until they cover it.'
            : 'Stability is p10 over the median; uptime is the share of snapshots at or above half the median.'}
      </p>
    </>
  )
}

export function OverTime({
  detail,
  window: win,
  onWindow,
}: {
  detail: PoolDetail
  window: HistoryWindow
  onWindow: (w: HistoryWindow) => void
}) {
  const history = usePoolHistory(detail.pool.id, '7d')
  const [keyboard, setKeyboard] = useState(false)
  const loading = useDelayedPending(history.isPending)
  const phone = useIsPhone()
  const p = win === '7d' ? detail.persistence7d : detail.persistence24h
  const parts = persistenceParts(p)
  const data = history.data
  const domain: readonly [number, number] | null = data
    ? win === '7d'
      ? [data.from, data.to]
      : [data.to - DAY, data.to]
    : null
  // The snapshots inside the window, and how many the other window holds.
  const times = (from: number) =>
    (data?.points ?? []).filter((pt) => pt.timestamp >= from - 1).map((pt) => pt.timestamp)
  const shown = data && domain ? times(domain[0]) : []
  const other = data ? times(win === '7d' ? data.to - DAY : data.from).length : 0
  const takeaway = parts ? (
    <>
      Depth stayed above half its median in <TextChange value={parts.uptime} animate={!keyboard} />{' '}
      of <TextChange value={parts.samples} animate={!keyboard} /> snapshots.
    </>
  ) : (
    tooFewTakeaway(p?.samples ?? 0, shown)
  )
  let body: ReactNode
  if (history.isError && !data) {
    body = <SectionError what="history" onRetry={() => void history.refetch()} />
  } else if (!data || !domain) {
    const h = phone ? 296 : 340
    body = loading ? <Skeleton height={h} /> : <div style={{ height: h }} />
  } else if (data.points.length < 2) {
    body = <p className="muted">Not enough snapshots yet to draw a series.</p>
  } else {
    body = (
      <>
        <SmallMultiples
          points={data.points}
          series={mainSeries()}
          domain={domain}
          windowLabel={WINDOW_LABEL[win]}
          instant={keyboard}
        />
        <p className="cap pool-ts-cap">{overTimeCaption(shown, other)}</p>
      </>
    )
  }
  return (
    <Section
      id="s-time"
      title="over time"
      takeaway={takeaway}
      details={{
        content: (
          <>
            <PersistenceTable detail={detail} />
            {data && domain && data.points.length >= 2 ? (
              <div className="pool-more-series">
                <SmallMultiples
                  points={data.points}
                  series={moreSeries(data.points, detail.pool, detail.latest?.price ?? null)}
                  domain={domain}
                  windowLabel={WINDOW_LABEL[win]}
                  instant={keyboard}
                />
              </div>
            ) : null}
          </>
        ),
      }}
    >
      <div className="pool-ts-head">
        <SegmentedControl
          label="Time window"
          options={[
            { value: '24h', label: WINDOW_SHORT['24h'] },
            { value: '7d', label: WINDOW_SHORT['7d'] },
          ]}
          value={win}
          onChange={(w, meta) => {
            setKeyboard(meta.keyboard)
            onWindow(w)
          }}
        />
      </div>
      {body}
    </Section>
  )
}
