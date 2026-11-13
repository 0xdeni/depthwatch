// @vitest-environment node
/**
 * The static site's link previews (`plugins/siteMeta.ts`): Open Graph and Twitter card tags with
 * absolute URLs from `VITE_SITE_URL` (or the default address), the title and description taken
 * from index.html, the data line and the Scorecards tab of the header shell, and what the app is
 * told of the shipped bundle; nothing that would change the Content-Security-Policy. Then the files those tags and index.html's links point at: the share
 * image, the icons, the web manifest and robots.txt in `public/`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { IndexHtmlTransformHook } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { checkInlineScripts, HEADERS_SOURCE, inlineScriptHashes } from './securityHeaders.js'
import {
  DATA_LINE_SHELL,
  DATA_LINE_SLOT,
  DEFAULT_SITE_URL,
  escapeAttribute,
  pageText,
  SCORECARDS_TAB,
  SHARE_IMAGE,
  shareTags,
  shippedDefine,
  shippedFacts,
  siteMeta,
  siteUrl,
  staticIndexHtml,
} from './siteMeta.js'

const PUBLIC = resolve(HEADERS_SOURCE, '..')
const indexHtml = readFileSync(resolve(PUBLIC, '..', 'index.html'), 'utf8')
const headersText = readFileSync(HEADERS_SOURCE, 'utf8')

/** The `content` of the meta tag whose `property` or `name` is `key`, in `html`. */
function meta(html: string, key: string): string | undefined {
  const tag = new RegExp(
    `<meta (?:property|name)="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`,
  )
  return tag.exec(html)?.[1]
}

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file)
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

describe('siteUrl (VITE_SITE_URL)', () => {
  it('defaults to the published address when unset or blank', () => {
    expect(siteUrl(undefined)).toBe('https://depthwatch.pages.dev/')
    expect(siteUrl('  ')).toBe(DEFAULT_SITE_URL)
  })

  it('takes another address, ending it with one slash', () => {
    expect(siteUrl('https://example.org')).toBe('https://example.org/')
    expect(siteUrl(' https://example.org/depth/ ')).toBe('https://example.org/depth/')
    expect(siteUrl('http://127.0.0.1:4321')).toBe('http://127.0.0.1:4321/')
  })

  it('refuses anything that is not a plain http(s) address', () => {
    expect(() => siteUrl('depthwatch.pages.dev')).toThrow(/is not a URL/)
    expect(() => siteUrl('ftp://example.org/')).toThrow(/not an http\(s\) address/)
    for (const bad of [
      'https://example.org/?a=1',
      'https://example.org/#top',
      'https://me:pw@example.org/',
    ])
      expect(() => siteUrl(bad), bad).toThrow(/without a query or a #/)
  })
})

describe('the share tags', () => {
  const built = staticIndexHtml(indexHtml, DEFAULT_SITE_URL)

  it('describe the site with absolute URLs, the image with its size and text', () => {
    expect(meta(built, 'og:type')).toBe('website')
    expect(meta(built, 'og:site_name')).toBe('Depthwatch')
    expect(meta(built, 'og:url')).toBe('https://depthwatch.pages.dev/')
    expect(meta(built, 'og:image')).toBe('https://depthwatch.pages.dev/og.png')
    expect(meta(built, 'og:image:type')).toBe('image/png')
    expect(meta(built, 'og:image:width')).toBe('1200')
    expect(meta(built, 'og:image:height')).toBe('630')
    expect(meta(built, 'og:image:alt')).toBe(SHARE_IMAGE.alt)
    expect(meta(built, 'twitter:card')).toBe('summary_large_image')
  })

  it('take the title and description of index.html, so each is written once', () => {
    const page = pageText(indexHtml)
    expect(page.title).toBe('Depthwatch – liquidity depth of Base pools')
    expect(page.description).toMatch(/^What it takes to move the price in the Uniswap, Aerodrome/)
    expect(meta(built, 'og:title')).toBe(page.title)
    expect(meta(built, 'og:description')).toBe(page.description)
    expect(page.description).not.toMatch(/best|recommend|cheapest/i)
    // The site scores the pools it tracks, not every pool on Base (the freshness popover says how
    // many of how many), so a shared link claims no more.
    expect(page.description).toContain('pools Depthwatch tracks on Base')
    expect(page.description).not.toMatch(/\bevery\b|\ball\b/i)
    expect(() => pageText('<head></head>')).toThrow(/no <title>/)
    expect(() => pageText('<title>x</title>')).toThrow(/no description/)
  })

  it('follow VITE_SITE_URL, path included', () => {
    const site = siteUrl('https://example.org/depth')
    const html = staticIndexHtml(indexHtml, site)
    expect(meta(html, 'og:url')).toBe('https://example.org/depth/')
    expect(meta(html, 'og:image')).toBe('https://example.org/depth/og.png')
    expect(html).not.toContain('pages.dev')
  })

  it('escape what they did not take from index.html', () => {
    expect(escapeAttribute('a&b "c" <d>')).toBe('a&amp;b &quot;c&quot; &lt;d&gt;')
    const tags = shareTags('https://example.org/a&b/', { title: 'T', description: 'D' })
    expect(tags).toContain('content="https://example.org/a&amp;b/"')
    expect(tags.split('\n')).toHaveLength(11)
  })

  it('go at the end of <head> and change no script, so the policy stays as it is', () => {
    const head = built.slice(built.indexOf('<head>'), built.indexOf('</head>'))
    expect(head).toContain('<meta property="og:image"')
    expect(built.slice(built.indexOf('</head>'))).not.toContain('<meta property=')
    expect(inlineScriptHashes(built)).toEqual(inlineScriptHashes(indexHtml))
    expect(() => checkInlineScripts(built, headersText)).not.toThrow()
    expect(built).not.toMatch(/\sstyle=/)
  })

  it('come with the data line of the header shell, in its slot', () => {
    expect(indexHtml.split(DATA_LINE_SLOT)).toHaveLength(2)
    expect(built).not.toContain(DATA_LINE_SLOT)
    const shell = built.slice(built.indexOf('<div id="root">'), built.indexOf('</body>'))
    expect(shell).toContain(`<div class="appbar" aria-hidden="true">\n        ${DATA_LINE_SHELL}`)
    expect(() => staticIndexHtml('<head></head><title>t</title>', DEFAULT_SITE_URL)).toThrow(
      /no <!--data-line-->/,
    )
  })

  it('are written by the plugin, for the static build only', () => {
    const plugin = siteMeta({ url: undefined, shipped: () => ({ source: 'live', mandates: 2 }) })
    const hook = plugin.transformIndexHtml as { order: string; handler: IndexHtmlTransformHook }
    expect(hook.order).toBe('post')
    expect(hook.handler.call({} as never, indexHtml, {} as never)).toBe(built)
    expect(() => siteMeta({ url: 'not a url', shipped: () => SHIPPED })).toThrow(/VITE_SITE_URL/)
    const config = readFileSync(resolve(PUBLIC, '..', 'vite.config.ts'), 'utf8')
    const staticPlugins = config.slice(
      config.indexOf('? ['),
      config.indexOf(': [react(), agentDocs()'),
    )
    expect(staticPlugins).toContain('url: env.VITE_SITE_URL,')
    expect(staticPlugins).toContain('shipped: () => shippedFacts(readBundle(STATIC_BUNDLE_SOURCE))')
    expect(config.slice(config.indexOf(': [react(), agentDocs()'))).not.toContain('siteMeta')
  })
})

const SHIPPED = { source: 'live', mandates: 0 }

describe('what the static build knows of its bundle before it loads', () => {
  it('reads the source and the number of mandates from the bundle', () => {
    const bundle = { v: 1, source: 'live', generatedAt: 5, scorecards: [{}, {}] }
    expect(shippedFacts(JSON.stringify(bundle))).toEqual({ source: 'live', mandates: 2 })
    expect(() => shippedFacts('{"v":1,"source":"demo"}')).toThrow(/scorecards/)
  })

  it('hands both to the app through define, on a build only', () => {
    expect(shippedDefine(SHIPPED)).toEqual({
      'import.meta.env.DW_SHIPPED_SOURCE': '"live"',
      'import.meta.env.DW_SHIPPED_MANDATES': '"0"',
    })
    const read = vi.fn(() => SHIPPED)
    const plugin = siteMeta({ url: undefined, shipped: read })
    const config = plugin.config as (c: object, e: { command: string }) => unknown
    expect(config({}, { command: 'serve' })).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    expect(config({}, { command: 'build' })).toEqual({ define: shippedDefine(SHIPPED) })
  })

  it('leaves the Scorecards tab out of the header shell when the bundle has no mandate', () => {
    expect(indexHtml.match(new RegExp(SCORECARDS_TAB, 'g'))).toHaveLength(1)
    const tabs = (html: string) =>
      [...html.matchAll(/<span class="nav-long">(\w+)<\/span>/g)].map((m) => m[1])
    expect(tabs(staticIndexHtml(indexHtml, DEFAULT_SITE_URL, SHIPPED))).toEqual(['Methodology'])
    expect(
      tabs(staticIndexHtml(indexHtml, DEFAULT_SITE_URL, { source: 'demo', mandates: 2 })),
    ).toEqual(['Scorecards', 'Methodology'])
    // Without facts (the dev server) the shell keeps the tab, as a server's app does.
    expect(tabs(staticIndexHtml(indexHtml, DEFAULT_SITE_URL))).toEqual([
      'Scorecards',
      'Methodology',
    ])
    const without = staticIndexHtml(indexHtml, DEFAULT_SITE_URL, SHIPPED)
    expect(without).toContain(
      '<span class="nav-tab">Gaps</span>\n            <span class="nav-tab">',
    )
    expect(() =>
      staticIndexHtml(indexHtml.replace(SCORECARDS_TAB, ''), DEFAULT_SITE_URL, SHIPPED),
    ).toThrow(/no Scorecards tab/)
  })
})

describe('the files in public/', () => {
  const file = (name: string) => join(PUBLIC, name)

  it('hold the share image at its stated size, small enough to fetch quickly', () => {
    expect(pngSize(file(SHARE_IMAGE.path))).toEqual({
      width: SHARE_IMAGE.width,
      height: SHARE_IMAGE.height,
    })
    expect(statSync(file(SHARE_IMAGE.path)).size).toBeLessThan(150_000)
  })

  it('hold the icons index.html and the manifest name, at their sizes', () => {
    for (const href of ['/favicon.svg', '/favicon-48.png', '/apple-touch-icon.png'])
      expect(indexHtml).toContain(`href="${href}"`)
    expect(indexHtml).toContain('<link rel="manifest" href="/site.webmanifest" />')
    expect(pngSize(file('favicon-48.png'))).toEqual({ width: 48, height: 48 })
    expect(pngSize(file('apple-touch-icon.png'))).toEqual({ width: 180, height: 180 })
    const manifest = JSON.parse(readFileSync(file('site.webmanifest'), 'utf8')) as {
      name: string
      short_name: string
      display: string
      start_url: string
      theme_color: string
      background_color: string
      icons: Array<{ src: string; sizes: string; type: string }>
    }
    expect(manifest).toMatchObject({
      name: 'Depthwatch',
      short_name: 'Depthwatch',
      display: 'browser',
      start_url: './',
      theme_color: '#ffffff',
      background_color: '#ffffff',
    })
    for (const icon of manifest.icons) {
      expect(existsSync(file(icon.src)), icon.src).toBe(true)
      if (icon.type === 'image/png') {
        const { width, height } = pngSize(file(icon.src))
        expect(icon.sizes).toBe(`${width}x${height}`)
      }
    }
  })

  it('let every crawler in, and say nothing else', () => {
    expect(readFileSync(file('robots.txt'), 'utf8')).toBe('User-agent: *\nAllow: /\n')
  })
})
