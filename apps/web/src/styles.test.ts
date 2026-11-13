/**
 * Guards for the stylesheets (docs/design/visual-v4.md §2, §3, §8), part one: the token blocks and
 * the locked kit palette, the contrast pairs of §2.4, the retired v3 names, the type rules and the
 * self-hosted fonts. Part two (styles/rules.test.ts) holds the greps, motion, touch and layout
 * guards. Every rule holds for every stylesheet under src (styles/, and the chart and page sheets
 * their components import).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allCss,
  block,
  decls,
  read,
  STYLES,
  sharedCss,
  sources,
  stripComments,
  tokensCss,
  WEB,
} from './styles/cssRules.js'

/** Base brand kit v1.0 (§2.2): the only colours, alpha allowed. */
const KIT: Readonly<Record<string, string>> = {
  '--blue': '#0000ff',
  '--cerulean': '#3c8aff',
  '--yellow': '#ffd12f',
  '--green': '#66c800',
  '--red': '#fc401f',
  '--tan': '#b8a581',
  '--g0': '#ffffff',
  '--g10': '#eef0f3',
  '--g15': '#dee1e7',
  '--g30': '#b1b7c3',
  '--g50': '#717886',
  '--g60': '#5b616e',
  '--g80': '#32353d',
  '--g100': '#0a0b0d',
}
/** The chart stylesheets, which their components import. */
const SRC_CHARTS = join(WEB, 'src', 'components', 'charts')

/** The API badge's own colours, which its preview copies (§5.11). */
const BADGE = ['#2a3140', '#b8232f', '#1c7a4c', '#5c6573']

const rgbOf = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function ratio(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const light = decls(block(tokensCss, ':root'))
const darkMedia = decls(block(tokensCss, ':root:not([data-theme="light"])'))
const darkForced = decls(block(tokensCss, ':root[data-theme="dark"]'))
const dark = new Map([...light, ...darkMedia])

/** A token's colour in a theme: var() chains resolved to a kit hex, or an rgb() over a surface. */
function colour(theme: Map<string, string>, name: string, over?: [number, number, number]) {
  let v = theme.get(name) ?? ''
  for (let i = 0; i < 8 && v.startsWith('var('); i++) v = theme.get(v.slice(4, -1)) ?? ''
  if (v.startsWith('#')) return rgbOf(v)
  const m = v.match(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/)
  if (!m || !over) throw new Error(`${name} is not a solid colour: ${v}`)
  const a = Number(m[4])
  return [1, 2, 3].map((k, i) => Math.round(a * Number(m[k]) + (1 - a) * (over[i] ?? 0))) as [
    number,
    number,
    number,
  ]
}

describe('colour tokens (§2.2, §3.1)', () => {
  it('locks the kit palette to its published values', () => {
    for (const [name, hex] of Object.entries(KIT)) expect(light.get(name), name).toBe(hex)
  })

  it('repeats the dark block verbatim under :root[data-theme="dark"]', () => {
    expect([...darkForced.entries()]).toEqual([...darkMedia.entries()])
    expect(tokensCss).toMatch(/:root\[data-theme="dark"\] \{\s*color-scheme: dark;/)
    for (const name of darkMedia.keys()) expect(light.has(name), name).toBe(true)
  })

  it('defines the roles that are new in v4 and none of the retired v3 ones', () => {
    const roles = [
      '--band',
      '--on-band',
      '--on-band-2',
      '--ink',
      '--on-ink',
      '--on-ink-2',
      '--ink-edge',
      '--sell-band',
      '--buy-band',
      '--buy-edge',
      '--on-status',
      '--breach-op',
      '--focus-band',
      '--nav-ind',
      '--edge',
      '--hl',
      '--hl-ink',
      '--sh-1',
      '--sh-2',
      '--sh-band',
      '--sh-3',
    ]
    const all = decls(tokensCss.replace(/[{}]/g, ';'))
    for (const name of roles) expect(all.has(name), name).toBe(true)
    for (const name of ['--well', '--raised', '--hover', '--border', '--text-3', '--ok-bg'])
      expect(all.has(name), name).toBe(false)
  })

  it('keeps the ink block and the footer Gray 100 in both themes; text off the band never white in dark', () => {
    for (const theme of [light, dark]) expect(colour(theme, '--ink')).toEqual(rgbOf('#0a0b0d'))
    expect(colour(dark, '--text-1')).toEqual(rgbOf('#eef0f3'))
    expect(colour(dark, '--surface')).toEqual(rgbOf('#0a0b0d'))
    expect(colour(dark, '--panel')).toEqual(rgbOf('#0a0b0d'))
  })

  it('meets the contrast pairs of §2.4 in both themes', () => {
    const blue = rgbOf(KIT['--blue'] ?? '')
    const pair = (t: Map<string, string>, fg: string, bg: string) =>
      ratio(colour(t, fg, colour(t, bg)), colour(t, bg))
    for (const t of [light, dark]) {
      expect(pair(t, '--text-1', '--canvas')).toBeGreaterThanOrEqual(15)
      expect(pair(t, '--text-2', '--canvas')).toBeGreaterThanOrEqual(6)
      expect(pair(t, '--text-2', '--surface-2')).toBeGreaterThanOrEqual(5.4)
      expect(pair(t, '--on-ink-2', '--ink')).toBeGreaterThanOrEqual(9.7)
      expect(pair(t, '--sell', '--canvas')).toBeGreaterThanOrEqual(3.3)
      expect(pair(t, '--focus', '--canvas')).toBeGreaterThanOrEqual(3)
      expect(pair(t, '--nav-ind', '--canvas')).toBeGreaterThanOrEqual(3)
      expect(ratio(colour(t, '--on-band'), blue)).toBeGreaterThanOrEqual(8.5)
      expect(ratio(colour(t, '--on-band-2', blue), blue)).toBeGreaterThanOrEqual(5.5)
      expect(ratio(colour(t, '--buy-band'), blue)).toBeGreaterThanOrEqual(5.8)
      expect(ratio(colour(t, '--focus-band'), blue)).toBeGreaterThanOrEqual(3)
      for (const s of ['--ok', '--warn', '--bad'])
        expect(pair(t, '--on-status', s), s).toBeGreaterThanOrEqual(5.5)
      // Marks: Red on the canvas (breach triangle, shortfall); both sides and the Yellow ring on
      // the ink block.
      expect(pair(t, '--bad', '--canvas')).toBeGreaterThanOrEqual(3.5)
      expect(pair(t, '--sell', '--ink')).toBeGreaterThanOrEqual(5.8)
      expect(pair(t, '--buy', '--ink')).toBeGreaterThanOrEqual(13)
      expect(pair(t, '--focus-band', '--ink')).toBeGreaterThanOrEqual(3)
    }
    expect(pair(light, '--focus', '--canvas')).toBeGreaterThanOrEqual(8.5)
    expect(pair(dark, '--text-2', '--surface-2')).toBeGreaterThanOrEqual(6)
    // Blue is never text on dark; Cerulean never sits on the band (§2.4).
    expect(ratio(rgbOf('#0000ff'), rgbOf('#0a0b0d'))).toBeLessThan(3)
    expect(colour(dark, '--focus')).toEqual(rgbOf('#3c8aff'))
    expect(colour(light, '--sell-band')).toEqual(rgbOf('#ffffff'))
  })

  it('outlines controls in --ctl-edge, at least 3:1 on every surface they sit on (WCAG 1.4.11)', () => {
    const pair = (t: Map<string, string>, fg: string, bg: string) =>
      ratio(colour(t, fg, colour(t, bg)), colour(t, bg))
    for (const [name, t] of [
      ['light', light],
      ['dark', dark],
      ['dark, forced', new Map([...light, ...darkForced])],
    ] as const)
      for (const bg of ['--canvas', '--surface', '--panel'])
        expect(pair(t, '--ctl-edge', bg), `${name}: --ctl-edge on ${bg}`).toBeGreaterThanOrEqual(3)
    // A control in a light well (Gray 10) keeps its outline too.
    expect(pair(light, '--ctl-edge', '--surface-2')).toBeGreaterThanOrEqual(3)
    // Inputs, checkboxes, icon buttons and ghost buttons take it; nothing outlines in --line-2.
    const controls = stripComments(read(join(STYLES, 'controls.css')))
    expect(controls.match(/inset 0 0 0 1\.5px var\(--ctl-edge\)/g)).toHaveLength(4)
    expect(controls).not.toMatch(/inset 0 0 0 [\d.]+px var\(--line-2\)/)
  })

  it('writes every colour as a kit value (alpha allowed) or one of the badge colours', () => {
    const kit = new Set(Object.values(KIT).map((h) => rgbOf(h).join(' ')))
    const css = stripComments(allCss).replace(/mask-image:[^;]*;/g, '')
    for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const hex = m[0].toLowerCase()
      if (BADGE.includes(hex)) continue
      expect(kit.has(rgbOf(hex).join(' ')), hex).toBe(true)
    }
    for (const m of css.matchAll(/rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/g))
      expect(kit.has(`${m[1]} ${m[2]} ${m[3]}`), m[0]).toBe(true)
    expect(css).not.toMatch(/oklch\(|hsla?\(|color-mix\(|(?<!repeating-)linear-gradient\(/)
  })

  it('gives Base Blue backgrounds only to the band, the primary button, the dock’s current tab and the selected DEX bar', () => {
    const css = stripComments(sharedCss)
    const blueBg = [
      ...css.matchAll(/([^{}]+)\{[^{}]*background(?:-color)?:\s*var\(--(?:blue|band)\)/g),
    ]
      .map((m) => (m[1] ?? '').trim())
      .sort()
    expect(blueBg).toEqual([
      '.band-ground',
      '.btn.primary',
      '.dexf-row[aria-checked="true"] .dexf-bar i',
      '.dock a[aria-current="page"]',
    ])
  })
})

describe('retired v3 token names (§3.2)', () => {
  /** The v3 names that v4 replaces or retires; `--field-` and `--ht-` were the field of light. */
  const RETIRED = [
    '--raised',
    '--overlay',
    '--well',
    '--hover',
    '--border-subtle',
    '--border',
    '--control',
    '--text-3',
    '--ok-bg',
    '--warn-bg',
    '--bad-bg',
    '--bad-mark',
    '--band-op',
    '--dot',
    '--shadow-pop',
    '--shadow-dialog',
    '--t-prose',
    '--dur-hover',
    '--appbar-h',
    '--field-under',
  ]

  it('neither defines nor reads a retired name, in any stylesheet or component', () => {
    const code = [stripComments(allCss), ...sources].join('\n')
    for (const name of RETIRED) {
      const escaped = name.replace(/-/g, '\\-')
      expect(code, name).not.toMatch(new RegExp(`${escaped}(?![\\w-])\\s*:`))
      expect(code, name).not.toMatch(new RegExp(`var\\(${escaped}(?![\\w-])`))
    }
    expect(code).not.toMatch(/var\(--(?:ht|dot)-/)
  })
})

describe('type (§3.3, §3.4)', () => {
  it('keeps each fluid size within 2.5 × its minimum', () => {
    for (const m of tokensCss.matchAll(/--t-[\w-]+: clamp\(([\d.]+)rem, [^,]+, ([\d.]+)rem\)/g))
      expect(Number(m[2]) / Number(m[1])).toBeLessThanOrEqual(2.5)
  })

  it('sets every font size from a token (or 1rem, or inherit), never below 12 px', () => {
    for (const m of allCss.matchAll(/font-size:\s*([^;]+);/g)) {
      const value = (m[1] ?? '').trim()
      expect(value, value).toMatch(/^(var\(--t-[\w-]+\)|1rem|inherit)$/)
    }
    for (const m of tokensCss.matchAll(/--t-[\w-]+:\s*([\d.]+)rem;/g))
      expect(Number(m[1]), m[0]).toBeGreaterThanOrEqual(0.75)
  })

  it('uppercases only the eyebrow, in mono at +0.09em', () => {
    const upper = [
      ...stripComments(allCss).matchAll(/([^{}]+)\{[^{}]*text-transform:\s*uppercase/g),
    ]
    expect(upper.map((m) => (m[1] ?? '').trim())).toEqual(['.eyebrow'])
    const eyebrow = block(sharedCss, '.eyebrow')
    expect(eyebrow).toMatch(/font-family:\s*var\(--mono\)/)
    expect(eyebrow).toMatch(/letter-spacing:\s*0\.09em/)
  })

  it('sets mono only on eyebrows, ids, addresses, block numbers and code', () => {
    const mono = [
      ...stripComments(sharedCss).matchAll(/([^{}]+)\{[^{}]*font-family:\s*var\(--mono\)/g),
    ]
      .flatMap((m) => (m[1] ?? '').split(','))
      .map((s) => s.trim())
      .sort()
    expect(mono).toEqual(['.addr', '.codeblock', '.eyebrow', '.mono', 'code', 'kbd', 'pre', 'samp'])
  })
})

describe('fonts (§3.3)', () => {
  const fontsCss = read(join(STYLES, 'fonts.css'))
  const html = read(join(WEB, 'index.html'))

  it('self-hosts the three subsets with their licences beside them', () => {
    for (const file of [
      'hanken-grotesk-var.woff2',
      'ibm-plex-mono-400.woff2',
      'ibm-plex-mono-500.woff2',
      'OFL-HankenGrotesk.txt',
      'OFL-IBMPlexMono.txt',
    ])
      expect(existsSync(join(WEB, 'public', 'fonts', file)), file).toBe(true)
    expect(fontsCss.match(/@font-face/g)).toHaveLength(4)
    expect(fontsCss).toContain('url("/fonts/hanken-grotesk-var.woff2")')
    expect(fontsCss).toMatch(/font-family: "Hanken Fallback";[\s\S]*size-adjust: 101\.7%;/)
    expect(fontsCss.match(/font-display: swap;/g)).toHaveLength(3)
  })

  it('preloads the sans face only and requests no third-party font host', () => {
    expect(html.match(/rel="preload"/g)).toHaveLength(1)
    expect(html).toMatch(/href="\/fonts\/hanken-grotesk-var\.woff2"[\s\S]*as="font"/)
    const everything = [html, allCss, ...sources].join('\n')
    expect(everything).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/)
  })

  it('pins theme-color to white in light and Gray 100 in dark', () => {
    expect(html).toContain('media="(prefers-color-scheme: light)" content="#ffffff"')
    expect(html).toContain('media="(prefers-color-scheme: dark)" content="#0a0b0d"')
  })
})

/**
 * Rules jsdom cannot see, which the rows and facts rely on: a rated grade is a picture, so a tap
 * on it reaches its row's pool link; the gap bars' score column fits "100"; the pool page's grade
 * basis follows the score's label; the phone rows' info button sits outside the head row's flow.
 */
describe('rows and facts: rules a test of the markup cannot see', () => {
  /** Selectors of a list split at its top-level commas (`:not(.a, .b)` stays one selector). */
  const selectorList = (text: string) => {
    const out: string[] = []
    let depth = 0
    let current = ''
    for (const c of text) {
      if (c === ',' && depth === 0) {
        out.push(current)
        current = ''
        continue
      }
      if (c === '(') depth++
      if (c === ')') depth--
      current += c
    }
    return [...out, current].map((s) => s.trim().replace(/\s+/g, ' '))
  }
  /** The declarations of every top-level rule whose selector list holds `selector`. */
  const rulesFor = (css: string, selector: string) =>
    [...stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => selectorList(m[1] ?? '').includes(selector))
      .map((m) => (m[2] ?? '').replace(/\s+/g, ' '))
      .join(';')
  const status = read(join(STYLES, 'status.css'))

  it('lets a tap on a rated grade, marked or not, through to the row link; chips keep theirs', () => {
    for (const selector of ['.grade:not(.is-unrated, .is-stale)', '.grade-marked'])
      expect(rulesFor(status, selector), selector).toContain('pointer-events: none')
    // "Not rated" and "Stale price" are buttons for their reasons: never made inert.
    expect(stripComments(status)).not.toMatch(
      /\.grade\.is-(unrated|stale)[^{]*\{[^}]*pointer-events: none/,
    )
  })

  it('gives the gap bars’ score 3ch, so 100 and 99 end their bars at the same x', () => {
    const glyphs = read(join(SRC_CHARTS, 'glyphs.css'))
    expect(rulesFor(glyphs, '.gbar .num')).toContain('min-width: 3ch')
  })

  it('puts the pool page’s grade basis after the score’s label', () => {
    const content = read(join(STYLES, 'content.css'))
    const order = (css: string, selector: string) =>
      Number(rulesFor(css, selector).match(/order: (\d+)/)?.[1])
    expect(order(content, '.fact dd')).toBe(1)
    expect(order(content, '.fact dt:not(.fact-eb)')).toBe(2)
    expect(order(status, '.fact dd.fact-basis')).toBe(3)
  })

  it('takes the phone rows’ info button out of the head row’s flow, over the grade column', () => {
    expect(rulesFor(status, '.prow-head > .th-info')).toContain('position: absolute')
    expect(rulesFor(status, '.prow-head:has(> .th-info)')).toContain('position: relative')
    // Only the head row's own labels make room for the grade column, not the button's icon.
    const tables = read(join(STYLES, 'tables.css'))
    expect(rulesFor(tables, '.prow-head > span:last-child')).toContain('padding-right: 52px')
    expect(rulesFor(tables, '.prow-head span:last-child')).toBe('')
  })

  it('keeps the header info button’s 44 px touch layer off the sort button beside it', () => {
    const info = rulesFor(status, '.th-info')
    const width = Number(info.match(/(?:^|;|\s)width: (\d+)px/)?.[1])
    const gap = Number(info.match(/margin-left: (\d+)px/)?.[1])
    // touch-hit centres a 44 px layer on the button: it reaches (44 - width) / 2 past each side.
    expect(gap).toBeGreaterThanOrEqual((44 - width) / 2)
  })
})
