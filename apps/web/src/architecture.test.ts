/**
 * The dashboard's architecture, pinned to the documents that describe it:
 * - its dependency on `@depthwatch/core` is a runtime one (`DEXES`, `healthGrade`,
 *   `computeHealthScore`, …), not a type-only one, and the packages tables in docs/ARCHITECTURE.md
 *   and DESIGN.md say so;
 * - `components/` and `lib/`, shared by every page, import nothing from `pages/`;
 * - the v4 build (docs/design/visual-v4.md §7) adds no dependency and no chart library (the swap
 *   panel later added `chain`'s browser-safe entry and viem, lazily loaded), has the
 *   parts of its file map, plays the first view from one module, and carries its amendments into
 *   principles.md, ia-v3.md, DESIGN.md and visual-v3.md (§1.8, §7.7).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SRC, '..', '..', '..')

/** Source files (tests excluded) that import at least one runtime value from core. */
function valueImportersOfCore(): string[] {
  const out: string[] = []
  for (const entry of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
    const source = readFileSync(join(SRC, entry), 'utf8')
    // `import type { … }` never matches (`type` sits between `import` and `{`); inline `type X`
    // specifiers are filtered below, so what remains is a value import.
    for (const match of source.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*'@depthwatch\/core'/g)) {
      const specifiers = (match[1] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (specifiers.some((s) => !s.startsWith('type '))) {
        out.push(entry)
        break
      }
    }
  }
  return out.sort()
}

/** The cells of the markdown table row whose first cell is `firstCell`. */
function tableRow(markdown: string, firstCell: string): string[] {
  const line = markdown.split('\n').find((l) => l.startsWith(`| ${firstCell} `))
  if (!line) throw new Error(`no table row starting with ${firstCell}`)
  return line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim())
}

describe('packages tables: web depends on core at runtime', () => {
  it('the dashboard imports runtime values from core', () => {
    expect(valueImportersOfCore()).toEqual(
      expect.arrayContaining(['pages/lists/poolsState.ts', 'pages/lists/poolsText.ts']),
    )
  })

  it('ARCHITECTURE.md and DESIGN.md list core as a plain dependency, not types only', () => {
    const architecture = readFileSync(join(ROOT, 'docs', 'ARCHITECTURE.md'), 'utf8')
    const dependsOn = tableRow(architecture, '`@depthwatch/web`')[1]
    expect(dependsOn).toMatch(/^core, /)
    expect(dependsOn).not.toMatch(/types/)

    const design = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8')
    const mayImport = tableRow(design, '`apps/web`')[3]
    expect(mayImport).toMatch(/^core, /)
    expect(mayImport).not.toMatch(/types/)
  })
})

/** Source files (tests and test harnesses excluded), relative to `src`. */
function appSources(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/(^|\/)testing/.test(f),
  )
}

describe('module layers', () => {
  it('components and lib, which every page shares, import nothing from pages', () => {
    const fromPages = appSources().filter(
      (f) =>
        /^(components|lib)\//.test(f) &&
        /from '(?:\.\.?\/)+pages\//.test(readFileSync(join(SRC, f), 'utf8')),
    )
    expect(fromPages).toEqual([])
  })
})

describe('the v4 build (docs/design/visual-v4.md §7)', () => {
  it('adds no dependency and no chart library (§7.1); the swap panel later added chain and viem', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@depthwatch/chain',
      '@depthwatch/core',
      '@tanstack/react-query',
      'react',
      'react-dom',
      'react-router-dom',
      'viem',
    ])
  })

  it('imports chain only through its browser-safe entry, and viem only in the lazy swap panel', () => {
    const importers = (pattern: RegExp) =>
      appSources()
        .filter((f) => pattern.test(readFileSync(join(SRC, f), 'utf8')))
        .sort()
    expect(importers(/from '@depthwatch\/chain(?!\/addresses')/)).toEqual([])
    const viem = importers(/from 'viem(?:\/[\w-]+)?'/)
    expect(viem.length).toBeGreaterThan(0)
    expect(viem.filter((f) => !f.startsWith('trade/'))).toEqual([])
    // The panel is reached only through the lazy import of pages/pool/TradeSection.tsx.
    const panelImporters = appSources().filter(
      (f) =>
        !f.startsWith('trade/') && /trade\/[\w]+\.js'/.test(readFileSync(join(SRC, f), 'utf8')),
    )
    expect(panelImporters).toEqual(['pages/pool/TradeSection.tsx'])
    const section = readFileSync(join(SRC, 'pages', 'pool', 'TradeSection.tsx'), 'utf8')
    expect(section).toMatch(/lazy\(\(\) => import\('\.\.\/\.\.\/trade\/TradePanel\.js'\)\)/)
    expect(section).not.toMatch(/^import [^\n]*trade\//m)
  })

  it('has the new parts of the file map, and the session first view replaces the Home intro', () => {
    const parts = [
      'components/shell/Dock.tsx',
      'components/ui/Band.tsx',
      'components/ui/Block.tsx',
      'components/ui/DexFilter.tsx',
      'components/charts/SquareField.tsx',
      'components/charts/squareFieldModel.ts',
      'components/charts/KpiChart.tsx',
      'lib/firstView.ts',
    ]
    for (const file of parts) expect(existsSync(join(SRC, file)), file).toBe(true)
    expect(existsSync(join(SRC, 'pages', 'home', 'useIntro.ts'))).toBe(false)
    // One module owns the session gate and the timeline (§4.1, §7.6).
    const gate = appSources().filter((f) =>
      /sessionStorage|dw-first-view/.test(readFileSync(join(SRC, f), 'utf8')),
    )
    expect(gate).toEqual(['lib/firstView.ts'])
  })

  it('draws the favicon as the mark, its sides in Cerulean and Yellow (§5.13)', () => {
    const svg = readFileSync(join(SRC, '..', 'public', 'favicon.svg'), 'utf8')
    expect(svg).toContain('.a{fill:#0a0b0d}')
    expect(svg).toContain('.b{fill:#3c8aff}')
    expect(svg).toContain('.c{fill:#ffd12f;stroke:#0a0b0d;stroke-width:.5}')
    expect(svg).toMatch(/prefers-color-scheme:dark\)\{\.a\{fill:#eef0f3\}/)
    expect(svg).not.toMatch(/#0000ff/i)
  })

  it('carries every rule §1.8 amends into principles.md, marked "v4 amended" (§7.7)', () => {
    const spec = readFileSync(join(ROOT, 'docs', 'design', 'visual-v4.md'), 'utf8')
    const table = spec.slice(spec.indexOf('### 1.8'), spec.indexOf('Forbidden pattern 16'))
    const ids = new Set<string>()
    const forbidden = new Set<string>()
    for (const row of table.split('\n').filter((l) => /^\| [^-R]/.test(l))) {
      const cell = row.split('|')[1] ?? ''
      for (const m of cell.matchAll(/\b[A-Z]{1,2}\d+\b/g)) ids.add(m[0])
      const f = cell.match(/forbidden ([\d, ]+)/)
      for (const n of f?.[1]?.split(',') ?? []) if (n.trim()) forbidden.add(n.trim())
    }
    expect(ids.size).toBeGreaterThan(25)
    expect([...forbidden].sort()).toEqual(['1', '13', '4', '6', '7'])
    const principles = readFileSync(join(ROOT, 'docs', 'design', 'principles.md'), 'utf8')
    const rules = principles.slice(0, principles.indexOf('## 16. Forbidden'))
    const starts = [...rules.matchAll(/^\s*(?:- |\d+\. )\*\*([A-Z]{1,2}\d+)\./gm)]
    const blockOf = (id: string) => {
      const i = starts.findIndex((m) => m[1] === id)
      if (i < 0) return ''
      return rules.slice(starts[i]?.index, starts[i + 1]?.index ?? rules.length)
    }
    for (const id of ids) expect(blockOf(id), id).toContain('v4 amended')
    const list = principles.slice(principles.indexOf('## 16. Forbidden'))
    for (const n of forbidden) {
      const item = list.slice(list.indexOf(`\n${n}. **`) + 1).split(/\n\d+\. \*\*/)[0] ?? ''
      expect(item, `forbidden ${n}`).toContain('v4 amended')
    }
    expect(principles).toMatch(/v4 amended[^\n]*visual-v4\.md §1\.8/)
  })

  it('points DESIGN.md and ia-v3.md at v4, and marks visual-v3.md superseded (§7.7)', () => {
    const design = readFileSync(join(ROOT, 'DESIGN.md'), 'utf8')
    expect(design).toContain('The visual and interaction spec is docs/design/visual-v4.md')
    const ia = readFileSync(join(ROOT, 'docs', 'design', 'ia-v3.md'), 'utf8')
    expect(ia).toContain('v4 amended')
    const v3 = readFileSync(join(ROOT, 'docs', 'design', 'visual-v3.md'), 'utf8')
    expect(v3.split('\n').find((l) => l.startsWith('Status:'))).toMatch(
      /superseded by \[`visual-v4\.md`\]\(visual-v4\.md\) where they differ/,
    )
  })
})
