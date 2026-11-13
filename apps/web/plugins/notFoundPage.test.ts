// @vitest-environment node
/**
 * The not-found page of the static copy (`public/404.html`, `public/404.css`): Cloudflare Pages
 * serves it with HTTP 404 for every path the copy does not have, `/api/…` included. It must work
 * under the site's Content-Security-Policy (no script, no inline style, nothing from another
 * host) and at any depth (every address a path from the site's root). The static build checks the
 * files it wrote by the same rules (`notFoundPage` below), so a static build without the page
 * fails; the server build leaves the page out.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  checkNotFoundPage,
  isRootPath,
  NOT_FOUND_PAGE,
  NOT_FOUND_STYLES,
  notFoundPage,
  notFoundPageProblems,
  notFoundStyleProblems,
  pageAddresses,
  styleAddresses,
} from './notFoundPage.js'
import { cspDirectives, HEADERS_SOURCE, headersFor, parseHeadersFile } from './securityHeaders.js'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUBLIC = join(WEB, 'public')
const PAGE = readFileSync(join(PUBLIC, NOT_FOUND_PAGE), 'utf8')
const STYLES = readFileSync(join(PUBLIC, NOT_FOUND_STYLES), 'utf8')

describe('public/404.html and public/404.css', () => {
  it('have no problem, and say plainly what happened and where to go', () => {
    expect(notFoundPageProblems(PAGE)).toEqual([])
    expect(notFoundStyleProblems(STYLES)).toEqual([])
    expect(PAGE).toMatch(/<html lang="en">/)
    expect(PAGE).toContain('<title>Not found – Depthwatch</title>')
    expect(PAGE).toContain('<h1>page not found</h1>')
    const text = PAGE.replace(/\s+/g, ' ')
    expect(text).toContain('There is no page at this address.')
    expect(text).toContain('no API, so addresses under /api end here too.')
    expect(PAGE).toContain('<a class="btn" href="/">Go to the home page</a>')
    expect(PAGE).toContain('<meta name="robots" content="noindex" />')
  })

  it('load only the stylesheet, the icon and the sans face, all from the site itself', () => {
    expect(pageAddresses(PAGE)).toEqual(['/favicon.svg', '/404.css', '/', '/', '/#/pools'])
    expect(styleAddresses(STYLES)).toEqual(['/fonts/hanken-grotesk-var.woff2'])
    for (const address of ['/favicon.svg', '/404.css', '/fonts/hanken-grotesk-var.woff2'])
      expect(existsSync(join(PUBLIC, address)), address).toBe(true)
  })

  it('need nothing the policy of public/_headers withholds, which applies at every path', () => {
    const rules = parseHeadersFile(readFileSync(HEADERS_SOURCE, 'utf8'))
    for (const path of ['/404.html', '/api/pools', '/no/such/page']) {
      const policy = headersFor(rules, path).get('content-security-policy') ?? ''
      const directives = cspDirectives(policy)
      for (const name of ['style-src', 'img-src', 'font-src'])
        expect(directives.get(name), `${path} ${name}`).toContain("'self'")
      expect(policy).not.toContain('unsafe-inline')
      expect(headersFor(rules, path).get('x-frame-options')).toBe('DENY')
    }
  })
})

describe('the rules', () => {
  const broken = (from: string, to: string) => {
    expect(PAGE).toContain(from)
    return notFoundPageProblems(PAGE.replace(from, to))
  }

  it('refuse a script, an inline style and an event handler, which the policy blocks', () => {
    expect(broken('</head>', '<script>void 0</script></head>')).toEqual([
      'it has a <script>, which the policy does not run',
    ])
    expect(broken('</head>', '<style>p{}</style></head>')).toEqual([
      'it has an inline style, which the policy does not apply',
    ])
    expect(broken('<main>', '<main style="color: red">')).toEqual([
      'it has an inline style, which the policy does not apply',
    ])
    expect(broken('<main>', '<main onclick="x()">')).toEqual([
      'it has an event handler attribute, which the policy does not run',
    ])
  })

  it('refuse an address that is relative, protocol-relative or on another host', () => {
    expect(broken('href="/404.css"', 'href="404.css"')).toEqual([
      `"404.css" is not a path from the site's root`,
    ])
    expect(broken('href="/404.css"', 'href="//cdn.example/404.css"')).toEqual([
      `"//cdn.example/404.css" is not a path from the site's root`,
    ])
    expect(broken('href="/favicon.svg"', "href='https://example.com/icon.svg'")).toEqual([
      `"https://example.com/icon.svg" is not a path from the site's root`,
    ])
    expect(['/', '/#/pools', '/fonts/a.woff2'].every(isRootPath)).toBe(true)
    expect(['', 'a', '//a', '/\\a', 'https://a', 'data:,x'].some(isRootPath)).toBe(false)
  })

  it('want a whole document with a link home', () => {
    expect(broken('<!doctype html>', '')).toEqual(['it does not start with <!doctype html>'])
    expect(broken('<meta charset="utf-8" />', '')).toEqual(['it has no <meta charset="utf-8">'])
    expect(broken('name="viewport"', 'name="x"')).toEqual([
      'it has no viewport <meta> with width=device-width',
    ])
    expect(broken('<title>Not found – Depthwatch</title>', '<title> </title>')).toEqual([
      'it has no <title>',
    ])
    expect(notFoundPageProblems(PAGE.replaceAll('href="/"', 'href="/#/pools"'))).toEqual([
      'it has no link to the home page (href="/")',
    ])
    // Text in a comment is not markup.
    expect(broken('<html lang="en">', '<!-- <script> style="x" --><html lang="en">')).toEqual([])
  })

  it('refuse an @import and a font or image from anywhere but the site root', () => {
    expect(notFoundStyleProblems(`@import "/a.css";\n${STYLES}`)).toEqual([
      'it has an @import; put the rules in this file',
    ])
    const remote = STYLES.replace('url("/fonts/', 'url("https://fonts.example/')
    expect(notFoundStyleProblems(remote)).toEqual([
      `"https://fonts.example/hanken-grotesk-var.woff2" is not a path from the site's root`,
    ])
    expect(
      styleAddresses("a { background: url( /i.svg ) } /* url(x) */ b { x: url('/j') }"),
    ).toEqual(['/i.svg', '/j'])
  })
})

describe('the build', () => {
  let dir = ''
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'depthwatch-404-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  /** A built output: what Vite copies from public/, and the app's index.html. */
  const built = () => {
    cpSync(PUBLIC, dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Depthwatch</title>\n')
  }
  const writeBundle = (plugin: Plugin) => {
    const hook = plugin.writeBundle as (options: { dir?: string }) => void
    hook.call(undefined, { dir })
  }

  it('checks the page the static build wrote, and fails without it', () => {
    built()
    expect(() => checkNotFoundPage(dir)).not.toThrow()
    writeBundle(notFoundPage({ keepFile: true }))
    expect(existsSync(join(dir, NOT_FOUND_PAGE))).toBe(true)
    rmSync(join(dir, NOT_FOUND_PAGE))
    expect(() => writeBundle(notFoundPage({ keepFile: true }))).toThrow(
      `not-found page: the static build wrote no ${join(dir, NOT_FOUND_PAGE)}`,
    )
  })

  it('fails when the page names a file the build does not have, or breaks a rule', () => {
    built()
    rmSync(join(dir, 'fonts', 'hanken-grotesk-var.woff2'))
    expect(() => checkNotFoundPage(dir)).toThrow(
      `/fonts/hanken-grotesk-var.woff2 is named by the not-found page but not in ${dir}`,
    )
    built()
    writeFileSync(join(dir, NOT_FOUND_PAGE), PAGE.replace('</head>', '<script></script></head>'))
    expect(() => checkNotFoundPage(dir)).toThrow('it has a <script>')
  })

  it('leaves the page and its stylesheet out of the server build, and nothing else', () => {
    built()
    writeBundle(notFoundPage({ keepFile: false }))
    expect(existsSync(join(dir, NOT_FOUND_PAGE))).toBe(false)
    expect(existsSync(join(dir, NOT_FOUND_STYLES))).toBe(false)
    for (const file of ['index.html', 'favicon.svg', '_headers', 'fonts'])
      expect(existsSync(join(dir, file)), file).toBe(true)
  })

  it('is a plugin of both builds in vite.config.ts', () => {
    const config = readFileSync(join(WEB, 'vite.config.ts'), 'utf8')
    expect(config).toContain('notFoundPage({ keepFile: true }),')
    expect(config).toContain('headers, notFoundPage({ keepFile: false })]')
  })
})
