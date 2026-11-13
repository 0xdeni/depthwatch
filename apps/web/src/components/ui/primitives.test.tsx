import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '../../App.js'
import { createMockClient } from '../../api/mock.js'
import { BackLink } from './BackLink.js'
import { Band } from './Band.js'
import { Block, Overlap } from './Block.js'
import { Button, ButtonLink, buttonClass, IconButton } from './Button.js'
import { CopyButton } from './CopyButton.js'
import { Fact, Facts, FactsRow } from './Fact.js'
import { GradeGlyph } from './GradeGlyph.js'
import { ICON_NAMES, Icon } from './Icon.js'
import { NotFoundState, SectionError, useDelayedPending } from './States.js'
import { StatusChip } from './StatusChip.js'
import { StatusWord } from './StatusWord.js'
import { TextChange } from './TextChange.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('icons and buttons (§5.3, §5.13)', () => {
  it('draws every icon as a 16 px, 1.5 px stroke, aria-hidden SVG', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />)
      const svg = container.querySelector('svg')
      expect(svg?.getAttribute('viewBox')).toBe('0 0 16 16')
      expect(svg?.getAttribute('stroke-width')).toBe('1.5')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      unmount()
    }
  })

  it('are the ones the design rules list: every icon in §5.13, outlines in --ctl-edge (§5.3)', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
    const doc = readFileSync(join(root, 'docs', 'design', 'visual-v4.md'), 'utf8')
    const icons = doc.match(/\*\*Icons\*\* \(K9\):[\s\S]*?No icon in a tinted square/)?.[0] ?? ''
    for (const name of ICON_NAMES) {
      const listed = name.replace(/^chev.*/, 'chevrons').replace(/^arrow.*/, 'arrows')
      expect(icons, name).toContain(` ${listed}`)
    }
    for (const variant of ['Ghost', 'Icon'])
      expect(doc).toMatch(new RegExp(`\\| ${variant} +\\|[^\\n]*\\| 1\\.5 px \`--ctl-edge\` inset`))
    expect(doc).toMatch(/\| Gray 50 +\| `#717886` \| Light control outlines/)
  })

  it("has the variants of §5.3, none of them sharing the band's class", () => {
    expect(buttonClass('primary')).toBe('btn primary')
    expect(buttonClass('on-band')).toBe('btn on-band')
    expect(buttonClass('ghost', 'sm')).toBe('btn ghost is-sm')
    expect(buttonClass('on-band-ghost', 'md', 'x')).toBe('btn on-band-ghost x')
    render(
      <MemoryRouter>
        <Button>Retry</Button>
        <ButtonLink variant="on-band" to="/pools">
          Browse pools
        </ButtonLink>
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Retry' }).className).toBe('btn ghost')
    const browse = screen.getByRole('link', { name: 'Browse pools' })
    expect(browse.className).toBe('btn on-band')
    expect(browse.classList.contains('band')).toBe(false)
  })

  it('names icon buttons and keeps a loading button labelled', () => {
    render(
      <>
        <IconButton icon="swap" label="Show price in WETH" />
        <Button loading>Retry</Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Show price in WETH' }).className).toBe('icon-btn')
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry.getAttribute('aria-busy')).toBe('true')
    expect(retry.querySelector('.spinner')).toBeTruthy()
  })

  it('back link: a chevron icon plus the list name, never a text arrow (K2)', () => {
    render(
      <MemoryRouter>
        <BackLink to="/pools" label="Pools" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: 'Pools' })
    expect(link.getAttribute('href')).toBe('/pools')
    expect(link.querySelector('svg')).toBeTruthy()
    expect(link.textContent).toBe('Pools')
  })
})

describe('grades and status (§5.5): ink letter and shape on a kit fill', () => {
  it('names the grade glyph and picks the band shape', () => {
    render(
      <>
        <GradeGlyph grade="A" />
        <GradeGlyph grade="C" size="fact" />
        <GradeGlyph grade="F" />
      </>,
    )
    const [a, c, f] = screen.getAllByRole('img')
    expect(a?.getAttribute('aria-label')).toBe('Grade A')
    expect(a?.className).toBe('grade tone-ok')
    expect(a?.querySelector('circle')).toBeTruthy()
    expect(c?.className).toBe('grade tone-warn is-fact')
    expect(c?.querySelector('rect')).toBeTruthy()
    expect(f?.querySelector('path')).toBeTruthy()
  })

  it('writes the status words with a shape, filled only as the chip', () => {
    render(
      <>
        <StatusWord status="ok" />
        <StatusWord status="breached" />
        <StatusChip status="breached" compact />
      </>,
    )
    expect(screen.getByText('Within KPI').className).toBe('status tone-ok')
    const [word, chip] = screen.getAllByText('Breached')
    expect(word?.className).toBe('status tone-bad')
    expect(chip?.className).toBe('status-chip tone-bad is-compact')
    expect(chip?.querySelector('svg')).toBeTruthy()
  })
})

describe('facts (§5.6): value first, label second', () => {
  it('pairs each value with its label, glyph or breached triangle', () => {
    render(
      <Facts layout="scorecard">
        <Fact value="$7.82K" label="sell side now, below the $50K KPI" breached />
        <Fact value="82" label="median health" grade="A" />
      </Facts>,
    )
    const terms = screen.getAllByRole('term').map((t) => t.textContent)
    expect(terms).toEqual(['sell side now, below the $50K KPI', 'median health'])
    const values = screen.getAllByRole('definition')
    expect(values[0]?.textContent).toBe('$7.82K')
    expect(screen.getByRole('img', { name: 'Below KPI' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Grade A' })).toBeTruthy()
    expect(document.querySelector('dl')?.className).toBe('facts is-stack')
  })

  it('puts an eyebrow above the value, and the facts row in one ink block over the band', () => {
    render(
      <FactsRow layout="pool" note="Liquidity gap: one of 48 pools.">
        <Fact eyebrow="24 h volume" value="$11.4M" label="traded in 24 h" />
      </FactsRow>,
    )
    const row = document.querySelector('.facts-row') as HTMLElement
    expect(row.className).toBe('blk ink facts-row')
    expect(row.hasAttribute('data-over')).toBe(true)
    expect(row.querySelector('dl')?.className).toBe('facts is-grid')
    const terms = screen.getAllByRole('term')
    expect(terms.map((t) => [t.className, t.textContent])).toEqual([
      ['eyebrow fact-eb', '24 h volume'],
      ['', 'traded in 24 h'],
    ])
    expect(row.querySelector('.facts-note')?.textContent).toBe('Liquidity gap: one of 48 pools.')
  })
})

describe('the band and blocks (§5.2)', () => {
  it('lays the band on its own ground layer, with the eyebrow rising in the first view', () => {
    render(
      <Band label="What a gap is" eyebrow="Liquidity gaps">
        <p className="lead">A gap is a pool that trades far more each day than its depth.</p>
      </Band>,
    )
    const band = screen.getByRole('region', { name: 'What a gap is' })
    expect(band.className).toBe('band')
    const ground = band.firstElementChild as HTMLElement
    expect(ground.className).toBe('band-ground')
    expect(ground.getAttribute('aria-hidden')).toBe('true')
    const eyebrow = band.querySelector('.eyebrow') as HTMLElement
    expect(eyebrow.textContent).toBe('Liquidity gaps')
    expect(eyebrow.hasAttribute('data-in')).toBe(true)
  })

  it('stacks blocks over the band, ink and panel variants, and single destinations', () => {
    render(
      <MemoryRouter>
        <Overlap grid>
          <Block over span={4}>
            depth
          </Block>
          <Block variant="ink" over span={5} to="/gaps" linkLabel="See all gaps">
            205×
          </Block>
          <Block variant="panel" flush as="section">
            about
          </Block>
        </Overlap>
      </MemoryRouter>,
    )
    const overlap = document.querySelector('.overlap') as HTMLElement
    expect(overlap.className).toBe('wrap overlap')
    expect(overlap.firstElementChild?.className).toBe('grid')
    const plain = screen.getByText('depth')
    expect(plain.className).toBe('blk blk--over c4')
    expect(plain.hasAttribute('data-over')).toBe(true)
    const dest = screen.getByRole('link', { name: 'See all gaps' })
    expect(dest.className).toBe('blk ink blk--over c5 is-dest')
    expect(dest.getAttribute('href')).toBe('/gaps')
    const panel = screen.getByText('about')
    expect(panel.tagName).toBe('SECTION')
    expect(panel.className).toBe('blk blk--panel blk--flush')
    expect(panel.hasAttribute('data-over')).toBe(false)
  })
})

describe('number change (§4.3)', () => {
  it('swaps instantly when not animated', () => {
    const { rerender, container } = render(<TextChange value="$7.82K" animate={false} />)
    rerender(<TextChange value="$7.66K" animate={false} />)
    expect(container.textContent).toBe('$7.66K')
    expect(container.querySelector('.nt-ch')).toBeNull()
  })

  it('settles in only the characters that changed, and reads the whole value', () => {
    const { rerender, container } = render(<TextChange value="$7.82K" />)
    rerender(<TextChange value="$7.66K" />)
    const changed = [...container.querySelectorAll('.nt-ch.is-in')].map((n) => n.textContent)
    expect(changed).toEqual(['6', '6'])
    expect(container.querySelector('.sr-only')?.textContent).toBe('$7.66K')
    expect(container.firstElementChild?.className).toBe('roll')
  })
})

describe('copy (§4.4)', () => {
  it('reads "Copied" with a check for 2 s and announces it', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<CopyButton text="<img>" label="Copy HTML" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy HTML' }))
    })
    expect(writeText).toHaveBeenCalledWith('<img>')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Copied')
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
  })
})

describe('states (§5.12)', () => {
  it('shows no loading UI under 300 ms and keeps it at least 400 ms once shown', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ p }) => useDelayedPending(p), {
      initialProps: { p: true },
    })
    act(() => vi.advanceTimersByTime(299))
    expect(result.current).toBe(false)
    rerender({ p: false })
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current).toBe(false)
    rerender({ p: true })
    act(() => vi.advanceTimersByTime(300))
    expect(result.current).toBe(true)
    rerender({ p: false })
    act(() => vi.advanceTimersByTime(399))
    expect(result.current).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toBe(false)
  })

  it('reports a section failure with a Retry and no apology (ST3)', () => {
    const onRetry = vi.fn()
    render(<SectionError what="history" onRetry={onRetry} />)
    expect(screen.getByRole('alert').textContent).toContain(
      'Unable to load history. Check that the API is running, then retry.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('says what was not found, shows the id and two ways on (ST4)', () => {
    render(
      <Providers client={createMockClient()} mock staticBuild>
        <MemoryRouter>
          <NotFoundState
            title="pool not found"
            message="Depthwatch does not track this pool, or the link is wrong."
            id="uniswap-v3:0xdead"
          />
        </MemoryRouter>
      </Providers>,
    )
    const h1 = screen.getByRole('heading', { level: 1, name: 'pool not found' })
    expect(h1.className).toBe('display')
    expect(h1.previousElementSibling?.textContent).toBe('Not found')
    expect(h1.previousElementSibling?.className).toBe('eyebrow')
    expect(screen.getByText('uniswap-v3:0xdead').className).toBe('mono nf-id')
    expect(
      screen.getByText(/This static copy only holds the data it was exported with\./),
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse pools' }).className).toBe('btn ghost')
    expect(screen.getByRole('link', { name: 'See liquidity gaps' }).className).toBe('ulink')
  })
})
