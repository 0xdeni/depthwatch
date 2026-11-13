// @vitest-environment node
/**
 * The static site's headers (`public/_headers`): clickjacking and sniffing are refused, the
 * Content-Security-Policy runs only this origin's scripts plus the inline scripts of index.html by
 * hash, fetches go to this origin only (the static client reads `./data/bundle.json` and
 * `./data/flags.json`; the trade panel reads the chain through the user's wallet, not over HTTP),
 * the trade switch is never cached, the hashed build output is cached for a year and the fonts for
 * a month, each path by one Cache-Control rule only. The build checks the built index.html the
 * same way, and refuses a URL pattern that opens two blocks (`securityHeaders` below);
 * `src/productionBundle.test.ts` runs that build.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Rollup } from 'vite'
import { describe, expect, it } from 'vitest'
import {
  checkHeadersFile,
  checkInlineScripts,
  cspDirectives,
  cspScriptHashes,
  duplicatePatterns,
  HEADERS_SOURCE,
  headersFor,
  inlineScriptHashes,
  parseHeadersFile,
  patternMatches,
  securityHeaders,
} from './securityHeaders.js'

const headersText = readFileSync(HEADERS_SOURCE, 'utf8')
const rules = parseHeadersFile(headersText)
const indexHtml = readFileSync(resolve(HEADERS_SOURCE, '..', '..', 'index.html'), 'utf8')
const policy = headersFor(rules, '/').get('content-security-policy') ?? ''
const directives = cspDirectives(policy)

/** The rules' patterns, in file order. */
const PATTERNS = ['/*', '/assets/*', '/fonts/*', '/data/flags.json']

/** Paths the static site serves, one or more under each rule. */
const SERVED = [
  '/',
  '/index.html',
  '/404.html',
  '/og.png',
  '/robots.txt',
  '/site.webmanifest',
  '/assets/index-DmZtxNsB.js',
  '/assets/index-mGDWXUO6.css',
  '/assets/index-DmZtxNsB.js.map',
  '/fonts/hanken-grotesk-var.woff2',
  '/fonts/ibm-plex-mono-500.woff2',
  '/data/bundle.json',
  '/data/flags.json',
]

describe('public/_headers', () => {
  it('has one rule for every path, two cache rules and one for the trade switch, each once', () => {
    expect(rules.map((rule) => rule.pattern)).toEqual(PATTERNS)
    expect(duplicatePatterns(rules)).toEqual([])
    expect(checkHeadersFile(headersText, '_headers')).toEqual(rules)
  })

  it('refuses framing and content sniffing on every path', () => {
    for (const path of ['/', '/index.html', '/assets/index-abc.js', '/data/bundle.json']) {
      const headers = headersFor(rules, path)
      expect(headers.get('x-frame-options')).toBe('DENY')
      expect(headers.get('x-content-type-options')).toBe('nosniff')
      expect(headers.get('content-security-policy')).toBe(policy)
    }
    expect(directives.get('frame-ancestors')).toEqual(["'none'"])
  })

  it('runs scripts from this origin and the hashed inline scripts only', () => {
    const scriptSrc = directives.get('script-src') ?? []
    expect(scriptSrc[0]).toBe("'self'")
    expect(scriptSrc.slice(1).every((source) => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(source))).toBe(
      true,
    )
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|strict-dynamic|\*/)
    expect(directives.get('default-src')).toEqual(["'self'"])
    expect(directives.get('object-src')).toEqual(["'none'"])
    expect(directives.get('base-uri')).toEqual(["'none'"])
  })

  it('fetches from this origin only, and loads styles, fonts and images from it', () => {
    expect(directives.get('connect-src')).toEqual(["'self'"])
    expect(directives.get('style-src')).toEqual(["'self'"])
    expect(directives.get('font-src')).toEqual(["'self'"])
    // The scorecard badge preview is the badge SVG as a data: URI (lib/badge.ts).
    expect(directives.get('img-src')).toEqual(["'self'", 'data:'])
  })

  it('never lets data/flags.json be cached, and only that file', () => {
    expect(headersFor(rules, '/data/flags.json').get('cache-control')).toBe('no-store')
    expect(headersFor(rules, '/data/bundle.json').has('cache-control')).toBe(false)
    expect(headersFor(rules, '/').has('cache-control')).toBe(false)
  })

  it('caches the hashed build output for a year and the fonts for a month', () => {
    for (const path of ['/assets/index-DmZtxNsB.js', '/assets/index-mGDWXUO6.css'])
      expect(headersFor(rules, path).get('cache-control')).toBe(
        'public, max-age=31536000, immutable',
      )
    expect(headersFor(rules, '/fonts/hanken-grotesk-var.woff2').get('cache-control')).toBe(
      'public, max-age=2592000',
    )
    // The page and the data are revalidated as Pages does by default, so a new copy shows at once.
    for (const path of ['/', '/index.html', '/data/bundle.json', '/og.png', '/site.webmanifest'])
      expect(headersFor(rules, path).has('cache-control'), path).toBe(false)
  })

  it('gives no path two Cache-Control values, which Pages would join with a comma', () => {
    const caching = rules.filter((rule) => rule.headers.some(([name]) => name === 'cache-control'))
    expect(caching.map((rule) => rule.pattern)).toEqual([
      '/assets/*',
      '/fonts/*',
      '/data/flags.json',
    ])
    // Every path one of those rules could match, and the paths the site serves.
    const probes = [...SERVED, ...caching.map((rule) => rule.pattern.replace('*', 'x/y.js'))]
    for (const path of probes) {
      const setters = caching.filter((rule) => patternMatches(rule.pattern, path))
      expect(setters.length, path).toBeLessThanOrEqual(1)
      expect(headersFor(rules, path).get('cache-control') ?? '', path).not.toContain(', public')
    }
    // The rule for every path sets none.
    expect(rules[0]?.headers.map(([name]) => name)).not.toContain('cache-control')
  })

  it('hashes exactly the inline scripts of index.html', () => {
    const inHtml = inlineScriptHashes(indexHtml)
    expect(inHtml).toHaveLength(1)
    expect(cspScriptHashes(rules).sort()).toEqual([...inHtml].sort())
    expect(() => checkInlineScripts(indexHtml, headersText)).not.toThrow()
  })

  it('fails when the inline script changes without the policy, naming both hashes', () => {
    const edited = indexHtml.replace("q.get('theme')", "q.get('scheme')")
    expect(edited).not.toBe(indexHtml)
    const [added] = inlineScriptHashes(edited)
    const [old] = inlineScriptHashes(indexHtml)
    expect(() => checkInlineScripts(edited, headersText)).toThrow(`(add: ${added}; remove: ${old})`)
    const extra = indexHtml.replace('</head>', '<script>void 0</script></head>')
    expect(() => checkInlineScripts(extra, headersText)).toThrow(/add: 'sha256-[^;]+; remove: none/)
  })
})

describe("the preview's noindex header (.github/workflows/trade-preview.yml)", () => {
  const workflow = readFileSync(
    resolve(HEADERS_SOURCE, '..', '..', '..', '..', '.github', 'workflows', 'trade-preview.yml'),
    'utf8',
  )
  const step = workflow.slice(
    workflow.indexOf('- name: Build the static site'),
    workflow.indexOf('- name: Install wrangler'),
  )
  // The script the build step runs on the built file; it holds no single quote.
  const script = /node -e '([^']*)' apps\/web\/dist-static\/_headers\n/.exec(step)?.[1] ?? ''
  /** Runs the script on a copy of `text`, as the workflow runs it on the built `_headers`. */
  const insert = (text: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-preview-'))
    try {
      const file = join(dir, '_headers')
      writeFileSync(file, text)
      const { status, stdout } = spawnSync(process.execPath, ['-e', script, file], {
        encoding: 'utf8',
      })
      return { status, stdout, text: readFileSync(file, 'utf8') }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  // What the first run appended to the built file instead.
  const appended = `${headersText}\n/*\n  X-Robots-Tag: noindex, nofollow\n`

  it('is inserted into the /* block by the build step, not appended', () => {
    expect(script).toContain(
      'lines.splice(lines.indexOf("/*") + 1, 0, "  X-Robots-Tag: noindex, nofollow")',
    )
    expect(workflow).not.toContain('>> apps/web/dist-static/_headers')
  })

  it('goes right after the one /* line of the built file, every other line as built', () => {
    // The static build copies public/_headers into dist-static unchanged.
    const result = insert(headersText)
    expect(result.status).toBe(0)
    const lines = headersText.split('\n')
    lines.splice(lines.indexOf('/*') + 1, 0, '  X-Robots-Tag: noindex, nofollow')
    expect(result.text).toBe(lines.join('\n'))
    const preview = checkHeadersFile(result.text, 'the preview _headers')
    expect(preview.map((rule) => rule.pattern)).toEqual(PATTERNS)
    for (const path of SERVED) {
      const before = headersFor(rules, path)
      const after = headersFor(preview, path)
      expect(before.has('x-robots-tag')).toBe(false)
      expect(after.get('x-robots-tag')).toBe('noindex, nofollow')
      after.delete('x-robots-tag')
      expect(after).toEqual(before)
    }
    for (const path of ['/', '/data/flags.json']) {
      expect(headersFor(preview, path).get('content-security-policy')).toBe(policy)
      expect(headersFor(preview, path).get('x-frame-options')).toBe('DENY')
    }
    expect(() => checkInlineScripts(indexHtml, result.text)).not.toThrow()
  })

  it('stops the run, changing nothing, unless exactly one line is /*', () => {
    for (const text of [
      appended,
      headersText.replace('\n/*\n', '\n/**\n'),
      headersText.replaceAll('\n', '\r\n'),
    ]) {
      const result = insert(text)
      expect(result.status).toBe(1)
      expect(result.stdout).toMatch(
        /^::error::.* lines \/\* where the preview needs exactly one; nothing was published\.\n$/,
      )
      expect(result.text).toBe(text)
    }
  })

  it('would lose the policy if appended as a block of its own, so the build refuses that', () => {
    // As seen on Pages on the first run: the appended /* block replaced the first one.
    const served = headersFor(parseHeadersFile(appended), '/')
    expect(served.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(served.has('content-security-policy')).toBe(false)
    expect(served.has('x-frame-options')).toBe(false)
    expect(duplicatePatterns(parseHeadersFile(appended))).toEqual(['/*'])
    expect(() => checkHeadersFile(appended, 'dist-static/_headers')).toThrow(
      /^dist-static\/_headers: more than one block opens with "\/\*"\. /,
    )
    expect(() => checkInlineScripts(indexHtml, appended)).toThrow(/more than one block/)
  })
})

describe('the helpers', () => {
  it('hash a script exactly as browsers do, skipping external and data scripts', () => {
    // The SHA-256 of the empty string, base64.
    expect(inlineScriptHashes('<script></script>')).toEqual([
      "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='",
    ])
    expect(
      inlineScriptHashes(
        '<script type="module" src="./a.js"></script><script type="application/ld+json">{}</script>',
      ),
    ).toEqual([])
    expect(inlineScriptHashes('<SCRIPT type="module">x</SCRIPT >')).toHaveLength(1)
  })

  it('match paths as Pages does: exact paths and one splat', () => {
    expect(patternMatches('/*', '/')).toBe(true)
    expect(patternMatches('/*', '/a/b.js')).toBe(true)
    expect(patternMatches('/data/flags.json', '/data/flags.json')).toBe(true)
    expect(patternMatches('/data/flags.json', '/data/flags.json.bak')).toBe(false)
    expect(patternMatches('/data/*.json', '/data/bundle.json')).toBe(true)
    expect(patternMatches('/data/*.json', '/data/x.js')).toBe(false)
  })

  it('join a header two patterns set, and refuse a header line outside a rule', () => {
    const joined = parseHeadersFile('/*\n  X-Robots-Tag: noindex\n/a\n  X-Robots-Tag: nosnippet\n')
    expect(headersFor(joined, '/a').get('x-robots-tag')).toBe('noindex, nosnippet')
    expect(duplicatePatterns(joined)).toEqual([])
    expect(() => parseHeadersFile('  X-Frame-Options: DENY\n')).toThrow(/line 1/)
    expect(() => parseHeadersFile('/*\n  no colon\n')).toThrow(/line 2/)
  })

  it('let a block replace every earlier block with the same pattern, as Pages was seen to', () => {
    const twice = parseHeadersFile('/*\n  A: 1\n  B: 2\n/a\n  A: 3\n/*\n  C: 4\n/a\n  B: 5\n')
    expect([...headersFor(twice, '/a')]).toEqual([
      ['c', '4'],
      ['b', '5'],
    ])
    expect(duplicatePatterns(twice)).toEqual(['/*', '/a'])
    expect(() => checkHeadersFile('/a\n  A: 1\n/a\n  A: 2\n', 'x')).toThrow(/opens with "\/a"/)
  })
})

describe('securityHeaders (the Vite plugin)', () => {
  type Hooks = {
    generateBundle: {
      handler: (this: unknown, options: unknown, bundle: Rollup.OutputBundle) => void
    }
    writeBundle: (this: unknown, options: { dir?: string }) => void
  }
  const plugin = (keepFile: boolean, text = headersText) =>
    securityHeaders({ readText: () => text, keepFile }) as unknown as Hooks
  const bundleOf = (html: string) =>
    ({
      'index.html': { type: 'asset', fileName: 'index.html', source: html },
    }) as unknown as Rollup.OutputBundle

  it('checks the built index.html', () => {
    const { generateBundle } = plugin(true)
    expect(() => generateBundle.handler.call({}, {}, bundleOf(indexHtml))).not.toThrow()
    expect(() =>
      generateBundle.handler.call({}, {}, bundleOf(indexHtml.replace('catch {}', 'catch {;}'))),
    ).toThrow(/script-src hashes differ/)
    expect(() => generateBundle.handler.call({}, {}, {} as Rollup.OutputBundle)).toThrow(
      /no index.html/,
    )
    const twice = `${headersText}\n/*\n  X-Robots-Tag: noindex\n`
    expect(() =>
      plugin(true, twice).generateBundle.handler.call({}, {}, bundleOf(indexHtml)),
    ).toThrow(/^apps\/web\/public\/_headers: more than one block opens with "\/\*"/)
  })

  it('fails the static build when its _headers opens a pattern twice, or is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-headers-'))
    try {
      const file = join(dir, '_headers')
      expect(() => plugin(true).writeBundle.call({}, { dir })).toThrow(/wrote no .*_headers/)
      writeFileSync(file, `${headersText}\n/data/flags.json\n  Cache-Control: no-cache\n`)
      expect(() => plugin(true).writeBundle.call({}, { dir })).toThrow(
        /_headers: more than one block opens with "\/data\/flags\.json"/,
      )
      writeFileSync(file, headersText)
      expect(() => plugin(true).writeBundle.call({}, { dir })).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps _headers in the static output and removes it from the server output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depthwatch-headers-'))
    try {
      const file = join(dir, '_headers')
      writeFileSync(file, headersText)
      plugin(true).writeBundle.call({}, { dir })
      expect(existsSync(file)).toBe(true)
      plugin(false).writeBundle.call({}, { dir })
      expect(existsSync(file)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
