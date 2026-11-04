// @vitest-environment node
/**
 * The static site's headers (`public/_headers`): clickjacking and sniffing are refused, the
 * Content-Security-Policy runs only this origin's scripts plus the inline scripts of index.html by
 * hash, fetches go to this origin only (the static client reads `./data/bundle.json` and
 * `./data/flags.json`; the trade panel reads the chain through the user's wallet, not over HTTP),
 * and the trade switch is never cached. The build checks the built index.html the same way
 * (`securityHeaders` below); `src/productionBundle.test.ts` runs that build.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Rollup } from 'vite'
import { describe, expect, it } from 'vitest'
import {
  checkInlineScripts,
  cspDirectives,
  cspScriptHashes,
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

describe('public/_headers', () => {
  it('has one rule for every path and one for the trade switch', () => {
    expect(rules.map((rule) => rule.pattern)).toEqual(['/*', '/data/flags.json'])
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

describe('the preview rule (.github/workflows/trade-preview.yml)', () => {
  const workflow = readFileSync(
    resolve(HEADERS_SOURCE, '..', '..', '..', '..', '.github', 'workflows', 'trade-preview.yml'),
    'utf8',
  )
  // What the workflow's printf appends to the built file.
  const previewText = `${headersText}\n/*\n  X-Robots-Tag: noindex, nofollow\n`
  const preview = parseHeadersFile(previewText)

  it('is the rule the workflow appends after the build', () => {
    expect(workflow).toContain(
      "printf '\\n%s\\n%s\\n' '/*' '  X-Robots-Tag: noindex, nofollow' >> apps/web/dist-static/_headers",
    )
  })

  it('adds noindex, nofollow on every path and changes no other header', () => {
    for (const path of [
      '/',
      '/index.html',
      '/assets/index-abc.js',
      '/data/flags.json',
      '/404.html',
    ]) {
      const before = headersFor(rules, path)
      const after = headersFor(preview, path)
      expect(before.has('x-robots-tag')).toBe(false)
      expect(after.get('x-robots-tag')).toBe('noindex, nofollow')
      after.delete('x-robots-tag')
      expect(after).toEqual(before)
    }
    expect(headersFor(preview, '/').get('content-security-policy')).toBe(policy)
    expect(() => checkInlineScripts(indexHtml, previewText)).not.toThrow()
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

  it('join a header two rules set, and refuse a header line outside a rule', () => {
    const joined = parseHeadersFile('/*\n  X-Robots-Tag: noindex\n/a\n  X-Robots-Tag: nosnippet\n')
    expect(headersFor(joined, '/a').get('x-robots-tag')).toBe('noindex, nosnippet')
    expect(() => parseHeadersFile('  X-Frame-Options: DENY\n')).toThrow(/line 1/)
    expect(() => parseHeadersFile('/*\n  no colon\n')).toThrow(/line 2/)
  })
})

describe('securityHeaders (the Vite plugin)', () => {
  type Hooks = {
    generateBundle: {
      handler: (this: unknown, options: unknown, bundle: Rollup.OutputBundle) => void
    }
    writeBundle: (this: unknown, options: { dir?: string }) => void
  }
  const plugin = (keepFile: boolean) =>
    securityHeaders({ readText: () => headersText, keepFile }) as unknown as Hooks
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
