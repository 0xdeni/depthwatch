/**
 * Home's facts against the static client: the biggest gap is the largest turnover even when the
 * head of the feed ties on a gap score of 100, its squares never read as an empty box, and each
 * block's link is named by its own text in reading order (WCAG 2.5.3).
 */
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createMockClient } from '../../api/mock.js'
import { createStaticClient } from '../../api/static.js'
import type { StaticBundle } from '../../api/types.js'
import { ratio } from '../../lib/format.js'
import { bundleFromClient } from '../../testing/staticBundle.js'
import { gapLabel } from './copy.js'
import { countsText, gradeCounts, NEST_PX, nestSides } from './HomeFacts.js'
import { findFacts, NOW, renderHome } from './testing.js'

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

const BASE = await bundleFromClient(createMockClient({ now: NOW }), {
  generatedAt: NOW,
  source: 'demo',
})

/** The feed's first four entries all score 100, at 101×, 195×, 174× and 132× a day. */
function tiedBundle(): StaticBundle {
  const bundle = structuredClone(BASE)
  const turnovers = [101, 195, 174, 132]
  bundle.gaps.slice(0, turnovers.length).forEach((item, i) => {
    item.gap = { ...item.gap, gapScore: 100, turnoverRatio: turnovers[i] ?? 0 }
    item.pool.gapScore = 100
  })
  return bundle
}

const blocks = async () => [
  ...(await findFacts()).querySelectorAll<HTMLAnchorElement>(':scope > a'),
]
const text = (el: Element | null) => el?.textContent ?? ''

describe('Home facts: the biggest gap', () => {
  it('is the largest turnover when the head of the feed ties at a gap score of 100', async () => {
    const bundle = tiedBundle()
    const client = createStaticClient(bundle)
    renderHome(client)
    const gap = (await blocks()).find((b) => b.getAttribute('href') === '/gaps')
    if (!gap) throw new Error('no gap block')
    expect(text(gap.querySelector('dd'))).toBe(ratio(195))
    const top = (await client.gaps({ limit: 1 })).items[0]
    if (!top) throw new Error('empty feed')
    expect(top.gap.turnoverRatio).toBe(195)
    expect(text(gap.querySelector('dt:not(.eyebrow)'))).toBe(gapLabel(top))
  })

  it('fills the day’s volume, so a tiny depth square never leaves an empty box', async () => {
    renderHome(createStaticClient(tiedBundle()))
    const gap = (await blocks()).find((b) => b.getAttribute('href') === '/gaps')
    const box = gap?.querySelector<HTMLElement>('.hf-box')
    expect(box?.querySelector('.nest-vol')).toBeTruthy()
    const [outline, solid] = nestSides(195)
    expect(outline).toBe(NEST_PX)
    expect(solid).toBeCloseTo(NEST_PX / Math.sqrt(195), 9)
    expect(box?.style.getPropertyValue('--out')).toBe(`${outline.toFixed(2)}px`)
    expect(box?.querySelector('i')?.style.getPropertyValue('--in')).toBe(`${solid.toFixed(2)}px`)
  })
})

describe('Home facts: link names', () => {
  const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  it('are each block’s own text in reading order: eyebrow, label, then value', async () => {
    renderHome(createStaticClient(tiedBundle()))
    const all = await blocks()
    expect(all).toHaveLength(3)
    for (const block of all) {
      // No name of its own: the link's text names it, so the name holds what is seen.
      expect(block.hasAttribute('aria-label')).toBe(false)
      const parts = [
        text(block.querySelector('dt.eyebrow')),
        text(block.querySelector('dt:not(.eyebrow)')),
        text(block.querySelector('dd .num')),
      ]
      const name = new RegExp(`^${parts.map(escapeRe).join('\\s*')}`)
      expect(screen.getByRole('link', { name })).toBe(block)
    }
  })

  it('says the grade counts the health bar shows, after the median and its grade', async () => {
    renderHome(createStaticClient(BASE))
    const health = (await blocks()).find((b) => b.getAttribute('href') === '/pools?sort=health')
    if (!health) throw new Error('no health block')
    const said = countsText(gradeCounts(BASE.pools))
    expect(said).toMatch(/^Rated pools by grade: [A-F] \d+/)
    expect(health.querySelector('.sr-only')?.textContent).toBe(said)
    expect(
      screen.getByRole('link', { name: new RegExp(`Grade [A-F]\\s*${escapeRe(said)}$`) }),
    ).toBe(health)
  })
})
