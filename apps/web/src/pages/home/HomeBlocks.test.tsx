/**
 * Home below the answer (docs/design/visual-v4.md §5.6, §6.2) against the in-repo mock: the three
 * fact blocks over the band and their comparisons, the gaps and market-maker previews, and the
 * states (nothing scored, a failed total, no volume, no median, no gap, no mandate).
 */
import { computeGap, healthGrade } from '@depthwatch/core'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../api/errors.js'
import { MOCK_MM_BREACHED_ID, MOCK_MM_OK_ID } from '../../api/mock.js'
import { DASH, NB, poolHref, ratio, score, usd } from '../../lib/format.js'
import { gapLabel, gapsTakeaway, healthLabel, isMeaningfulGap, volumeLabel } from './copy.js'
import { gradeCounts } from './HomeFacts.js'
import { findFacts, renderHome, withClient } from './testing.js'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

/** A preview by its heading: a section, or the one destination block that holds it. */
function preview(name: string): HTMLElement {
  const el = screen.getByRole('heading', { level: 2, name }).closest<HTMLElement>('section, a')
  if (!el) throw new Error(`no preview ${name}`)
  return el
}

const blocks = async () => [
  ...(await findFacts()).querySelectorAll<HTMLAnchorElement>(':scope > a'),
]
/** The text a reader sees: without the link name's unseen pauses (`.sr-only`). */
function seen(el: Element | null): string | undefined {
  const copy = el?.cloneNode(true) as Element | undefined
  for (const hidden of copy?.querySelectorAll('.sr-only') ?? []) hidden.remove()
  return copy?.textContent ?? undefined
}
const factValue = (block: Element) => seen(block.querySelector('dd'))
const factLabel = (block: Element) => seen(block.querySelector('dt:not(.eyebrow)'))
const factEyebrow = (block: Element) => seen(block.querySelector('dt.eyebrow'))

describe('Home: the fact blocks over the band', () => {
  it('shows 24 h volume, median health and the biggest gap, each a single destination', async () => {
    const client = renderHome()
    const { totals } = await client.stats()
    const pools = (await client.pools({ limit: 200 })).items
    const top = (await client.gaps({ limit: 200 })).items[0]
    if (!top || totals.medianHealth === null) throw new Error('mock has no gap or median')
    const [volume, health, gap] = await blocks()
    if (!volume || !health || !gap) throw new Error('three facts expected')
    expect([volume, health, gap].map((b) => b.getAttribute('href'))).toEqual([
      '/pools?sort=volume',
      '/pools?sort=health',
      '/gaps',
    ])
    expect(volume.className).toContain('ink')
    for (const b of [volume, health, gap]) expect(b.hasAttribute('data-over')).toBe(true)
    expect([volume, health, gap].map(factEyebrow)).toEqual([
      `24${NB}h volume`,
      'Health',
      'Biggest gap',
    ])

    const turnover = computeGap(totals.volume24hUsd, totals.depth2Usd).turnoverRatio
    expect(factValue(volume)).toBe(usd(totals.volume24hUsd))
    expect(factLabel(volume)).toBe(volumeLabel(turnover))
    expect(factLabel(volume)).toContain(`${ratio(turnover)} the depth within 2`)

    expect(factValue(health)).toContain(score(totals.medianHealth))
    const grade = healthGrade(totals.medianHealth)
    expect(within(health).getByRole('img', { name: `Grade ${grade}` })).toBeTruthy()
    expect(factLabel(health)).toBe(healthLabel(totals.rated))
    const said = gradeCounts(pools)
      .map((g) => `${g.grade} ${g.n}`)
      .join(', ')
    // Each block's link is named by its own text (WCAG 2.5.3); the grade counts are said once.
    for (const b of [volume, health, gap]) expect(b.hasAttribute('aria-label')).toBe(false)
    expect(health.querySelector(':scope > .sr-only')?.textContent).toBe(
      `. Rated pools by grade: ${said}`,
    )
    expect(gradeCounts(pools).reduce((s, g) => s + g.n, 0)).toBe(totals.rated)

    expect(isMeaningfulGap(top)).toBe(true)
    expect(factValue(gap)).toBe(ratio(top.gap.turnoverRatio))
    expect(factLabel(gap)).toBe(gapLabel(top))
  })

  it('draws Traded and Depth on one track: the depth bar is its share of the volume', async () => {
    const client = renderHome()
    const { totals } = await client.stats()
    const [volume] = await blocks()
    const bars = [...(volume?.querySelectorAll<HTMLElement>('.hf-track i') ?? [])]
    const widths = bars.map((b) => Number.parseFloat(b.style.width))
    expect(widths[0]).toBe(100)
    expect(widths[1]).toBeCloseTo((totals.depth2Usd / (totals.volume24hUsd ?? 1)) * 100, 1)
  })

  it('shows a dash, never $0, and no comparison when no pool has a known 24 h volume', async () => {
    const stats = await withClient().stats()
    renderHome(
      withClient({
        stats: async () => ({ ...stats, totals: { ...stats.totals, volume24hUsd: null } }),
      }),
    )
    const [volume] = await blocks()
    if (!volume) throw new Error('no volume fact')
    expect(factValue(volume)).toBe(usd(null))
    expect(factLabel(volume)).toBe(volumeLabel(null))
    expect(volume.querySelector('.hf-vs')).toBeNull()
  })

  it('has no median and no grade when no pool is rated', async () => {
    const stats = await withClient().stats()
    renderHome(
      withClient({
        stats: async () => ({
          ...stats,
          totals: { ...stats.totals, rated: 0, medianHealth: null },
        }),
      }),
    )
    const [, health] = await blocks()
    if (!health) throw new Error('no health fact')
    expect(factValue(health)).toBe(DASH)
    expect(factLabel(health)).toBe('median health: no pool is deep enough to rate yet')
    expect(within(health).queryByRole('img')).toBeNull()
    expect(await screen.findByText(/, but none is deep enough to grade yet\.$/)).toBeTruthy()
  })
})

describe('Home: previews', () => {
  it('previews the 3 biggest gaps with their glyphs and links to /gaps', async () => {
    const client = renderHome()
    const meaningful = (await client.gaps({ limit: 200 })).items.filter(isMeaningfulGap)
    await screen.findByText(gapsTakeaway(meaningful.length))
    const gaps = preview('where liquidity is thin')
    expect(gaps.className).toContain('c7')
    expect(within(gaps).getByRole('link', { name: 'See all gaps' }).getAttribute('href')).toBe(
      '/gaps',
    )
    const rows = within(gaps).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    const first = meaningful[0]
    if (!first || !rows[0]) throw new Error('no gaps')
    const link = within(rows[0]).getByRole('link')
    expect(link.getAttribute('href')).toBe(poolHref(first.pool.pool.id))
    expect(link.getAttribute('aria-label')).toContain(
      `trades ${ratio(first.gap.turnoverRatio)} its depth a day`,
    )
    expect(rows[0].textContent).toContain(
      `Trades ${ratio(first.gap.turnoverRatio)} its depth a day`,
    )
    expect(within(rows[0]).getByRole('img').getAttribute('aria-label')).toMatch(
      /^Gap score \d+ of 100: trades 3 times its depth a day or more$/,
    )
    expect(within(gaps).getByText('Gap score 0–100; the tick marks 3× turnover')).toBeTruthy()
  })

  it('previews the mandates with status, the pool and the 7 d uptime against its target', async () => {
    renderHome()
    await screen.findByText(/^1 of 2 mandates is within its/)
    const mm = preview('market makers on the record')
    expect(mm.querySelector('.take')?.textContent).toBe(
      '1 of 2 mandates is within its KPIs right now.',
    )
    expect(within(mm).getByRole('link', { name: 'See all scorecards' }).getAttribute('href')).toBe(
      '/mm',
    )
    const rows = within(mm).getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('a.rl-link')?.getAttribute('href'))).toEqual([
      `/mm/${MOCK_MM_BREACHED_ID}`,
      `/mm/${MOCK_MM_OK_ID}`,
    ])
    expect(within(rows[0] as HTMLElement).getByText('Breached')).toBeTruthy()
    await waitFor(() => expect(rows[0]?.textContent).toContain('Demo Markets on USDC / AERO'))
  })

  it('leaves the scorecards preview out while no mandate is registered, the gaps taking the row', async () => {
    renderHome(withClient({ scorecards: async () => ({ items: [] }) }))
    const gaps = await screen.findByRole('heading', { level: 2, name: 'where liquidity is thin' })
    await waitFor(() =>
      expect(
        within(gaps.closest('section') as HTMLElement).getAllByRole('listitem').length,
      ).toBeGreaterThan(0),
    )
    expect(screen.queryByRole('heading', { name: 'market makers on the record' })).toBeNull()
    expect(gaps.closest('section')?.classList.contains('c12')).toBe(true)
    // With mandates, the two share the row.
    cleanup()
    renderHome()
    await screen.findByRole('heading', { level: 2, name: 'market makers on the record' })
    expect(preview('where liquidity is thin').classList.contains('c7')).toBe(true)
  })

  it('names an unscored mandated pool by its short address', async () => {
    const { items } = await withClient().scorecards()
    const poolId = `aerodrome-v2:0x${'ab'.repeat(20)}`
    renderHome(
      withClient({
        scorecards: async () => ({
          items: items.map((s) => ({ ...s, mandate: { ...s.mandate, poolId } })),
        }),
      }),
    )
    await waitFor(() =>
      expect(screen.getAllByText(/^Demo Markets on 0xabab…abab$/)).toHaveLength(items.length),
    )
  })
})

describe('Home: states', () => {
  it('without a meaningful gap: no Gap marker, no rows, the highest turnover as the fact', async () => {
    const feed = await withClient().gaps({ limit: 200 })
    const calm = feed.items.filter((g) => !isMeaningfulGap(g))
    const top = calm[0]
    if (!top) throw new Error('mock has no calm pool')
    renderHome(withClient({ gaps: async () => ({ ...feed, items: calm, meaningful: 0 }) }))
    const fig = await screen.findByRole('group', { name: /^Base: / })
    expect(within(fig).queryByRole('link', { name: /^Liquidity gap/ })).toBeNull()
    await screen.findByText('No pool trades 3× its depth today.')
    expect(within(preview('where liquidity is thin')).queryByRole('list')).toBeNull()
    const gap = (await blocks())[2]
    if (!gap) throw new Error('no third fact')
    expect(factEyebrow(gap)).toBe('Highest turnover')
    expect(factValue(gap)).toBe(ratio(top.gap.turnoverRatio))
  })

  it("counts the API's meaningful gaps over the whole feed, not the page it shows", async () => {
    const feed = await withClient().gaps({ limit: 200 })
    renderHome(withClient({ gaps: async () => ({ ...feed, total: 900, meaningful: 640 }) }))
    expect(
      await screen.findByText('640 pools trade 3× their depth or more every day.'),
    ).toBeTruthy()
  })

  it('adds the quiet line under fewer than 3 gap rows', async () => {
    const feed = await withClient().gaps({ limit: 200 })
    const one = [
      ...feed.items.filter(isMeaningfulGap).slice(0, 1),
      ...feed.items.filter((g) => !isMeaningfulGap(g)),
    ]
    renderHome(withClient({ gaps: async () => ({ ...feed, items: one, meaningful: 1 }) }))
    expect(await screen.findByText('1 pool trades 3× its depth or more every day.')).toBeTruthy()
    const gaps = preview('where liquidity is thin')
    expect(within(gaps).getAllByRole('listitem')).toHaveLength(2)
    expect(within(gaps).getByText('Every other pool trades less than 3× its depth.')).toBeTruthy()
  })

  it('says so when no pool is scored yet: the spine only, no facts, the band closed', async () => {
    const stats = await withClient().stats()
    renderHome(
      withClient({
        stats: async () => ({ ...stats, totals: { ...stats.totals, scored: 0, pools: 3 } }),
        pools: async () => ({ items: [], total: 0 }),
        gaps: async () => ({ items: [], total: 0, meaningful: 0, minVolumeUsd: 10_000 }),
      }),
    )
    const h1 = await screen.findByRole('heading', { level: 1, name: 'No pools are scored yet.' })
    expect(
      screen.getByText('3 pools discovered. Scores appear after the first snapshot.'),
    ).toBeTruthy()
    expect(await screen.findByLabelText('No Base pools are scored yet')).toBeTruthy()
    expect(document.querySelector('.home-facts')).toBeNull()
    expect(h1.closest('.band')?.classList.contains('is-closed')).toBe(true)
    expect(await screen.findByText('No pool trades 3× its depth today.')).toBeTruthy()
  })

  it('keeps the page usable when the totals fail to load', async () => {
    renderHome(
      withClient({
        stats: async () => {
          throw new ApiError(500, 'boom')
        },
      }),
    )
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^Unable to load the totals\./)
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Liquidity on Base')
    expect(await screen.findByRole('group', { name: /^Base: / })).toBeTruthy()
    expect(document.querySelector('.home-facts')).toBeNull()
  })
})
