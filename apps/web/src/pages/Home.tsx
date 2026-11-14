/**
 * `/` (ia-v3 §4.1, docs/design/visual-v4.md §6.2): one answer, one figure, three facts. The band
 * opens on the answer, "$49.9M sits within 2 % of the price across 492 pools on Base.", with the
 * lead and the actions, then the focal depth butterfly of Base: where that depth sits pool by
 * pool, the "All of Base" total row with its concentration bracket, and its "Show data" table.
 * Three fact blocks stack over the band's lower edge (24 h volume, median health, biggest gap);
 * the previews hand the reader to the gaps feed and, once a mandate is registered, the
 * market-maker scorecards (with none, that block and the nav's Scorecards tab stay out). Home has
 * no URL state (ia-v3 §2); the first view of a session is played by the app shell on the parts
 * marked for it.
 */

import { useGaps, useMandatesListed, useScorecards, useStats } from '../api/hooks.js'
import type { ButterflyGap } from '../components/charts/index.js'
import { Overlap } from '../components/ui/Block.js'
import { useDelayedPending } from '../components/ui/States.js'
import { useAllPools } from '../lib/useAllPools.js'
import { GAP_FEED } from '../lib/useGapFeed.js'
import { isMeaningfulGap } from './home/copy.js'
import { HomeFacts } from './home/HomeFacts.js'
import { type HeroFigure, HomeHero } from './home/HomeHero.js'
import { FactsSkeleton } from './home/HomeSkeleton.js'
import { GapsPreview, MandatesPreview } from './home/Previews.js'
import './home/home.css'

export function Home() {
  const stats = useStats()
  const all = useAllPools()
  // The feed's first page: its biggest gaps, and the API's count of every meaningful one.
  const gaps = useGaps(GAP_FEED)
  const scorecards = useScorecards()

  // Shown once a mandate exists (or to report that the list failed). While the list loads, a
  // static build goes by the bundle it was built with and a server keeps the block's skeleton, so
  // the row keeps its shape (`useMandatesListed`).
  const mandates = useMandatesListed() || scorecards.isError
  const meaningful = gaps.data?.items.filter(isMeaningfulGap)
  const biggest = meaningful?.[0]
  const gap: ButterflyGap | null =
    biggest && biggest.gap.turnoverRatio !== null
      ? { poolId: biggest.pool.pool.id, turnoverRatio: biggest.gap.turnoverRatio }
      : null
  const pending = stats.isPending || all.isPending || gaps.isPending || scorecards.isPending
  const waiting = !useDelayedPending(pending)

  const figure: HeroFigure = {
    // Sides as stored (token0's), the same values the pool's page and scorecards show.
    pools: all.pools,
    gap,
    ready: all.pools !== undefined && !gaps.isPending,
    isError: all.isError,
    retry: all.refetch,
  }
  const totals = stats.data?.totals
  // The facts wait for the gap feed and the pools too, so no block pops in beside the others.
  const factsPending = !totals || gaps.isPending || all.isPending
  const noFacts = stats.isError || (totals !== undefined && totals.scored === 0)
  let facts = null
  if (!noFacts)
    facts =
      totals && !factsPending ? (
        <HomeFacts totals={totals} top={gaps.data?.items[0]} pools={all.pools} />
      ) : (
        <FactsSkeleton waiting={waiting} />
      )
  return (
    <div className="home">
      <HomeHero stats={stats} figure={figure} closed={noFacts} waiting={waiting} />
      {facts ? <Overlap label="Key facts">{facts}</Overlap> : null}
      <div className={`wrap grid home-prev${facts ? '' : ' is-first'}`}>
        <GapsPreview
          gaps={gaps}
          meaningful={meaningful}
          count={gaps.data?.meaningful}
          waiting={waiting}
          wide={!mandates}
        />
        {mandates ? (
          <MandatesPreview scorecards={scorecards} pools={all.pools} waiting={waiting} />
        ) : null}
      </div>
    </div>
  )
}
