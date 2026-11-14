/**
 * The static site's `index.html` (`VITE_STATIC=1` only): the tags a link preview reads (Open
 * Graph, and Twitter's card type), and the data line of the header shell.
 *
 * A shared link unfurls from the page's own tags, and the services that read them (Coinbase
 * Wallet, Farcaster, X, chat apps) need absolute URLs. They come from `VITE_SITE_URL`, the address
 * the site is published at, or `DEFAULT_SITE_URL` when it is unset: moving the site to another
 * domain is a one-line change of that variable (docs/DEPLOY.md, "A free static copy"). The card's
 * title and description are the `<title>` and the description meta of `index.html`, so each is
 * written once. The server build gets none of this: it is served from wherever its operator runs
 * it, so an absolute URL would point elsewhere.
 *
 * `index.html` holds a markup-only copy of the app bar inside `#root`, drawn before any script
 * runs and replaced by the app. The static site always shows a 32 px data line above the bar (the
 * snapshot line, or the demo line for a demo bundle), so here its slot gets an empty line of that
 * height and the bar does not move when the app takes over. The copy lists the Scorecards tab, as
 * a server's app does until its list of mandates answers; a static build whose bundle has no
 * mandate leaves it out, and hands the app what it knew of the bundle (`shippedDefine`, read by
 * `src/lib/shipped.ts`) so its nav, Home and the scorecards page take the same shape while the
 * bundle loads. No script and no style attribute is added, so the Content-Security-Policy of
 * `public/_headers` is unchanged.
 */
import type { Plugin } from 'vite'

/** Where the static site is published when `VITE_SITE_URL` is unset. */
export const DEFAULT_SITE_URL = 'https://depthwatch.pages.dev/'

/** The share image in `public/`, its size and its text alternative. */
export const SHARE_IMAGE = {
  path: 'og.png',
  width: 1200,
  height: 630,
  alt: 'Depthwatch: liquidity depth of Base pools. Open source, no token.',
} as const

/** What the static build knows of the bundle it ships before the app loads it. */
export interface ShippedFacts {
  /** `demo` or `live`, the bundle's `source`. */
  source: string
  /** How many mandates its scorecards list holds. */
  mandates: number
}

/** The shipped facts of a static bundle's JSON text. */
export function shippedFacts(bundleText: string): ShippedFacts {
  const parsed = JSON.parse(bundleText) as { source?: unknown; scorecards?: unknown }
  if (typeof parsed.source !== 'string' || !Array.isArray(parsed.scorecards))
    throw new Error('site meta: the bundle has no source or scorecards list')
  return { source: parsed.source, mandates: parsed.scorecards.length }
}

/** Vite `define` entries that hand the shipped facts to the app (`src/lib/shipped.ts`). */
export function shippedDefine(facts: ShippedFacts): Record<string, string> {
  return {
    'import.meta.env.DW_SHIPPED_SOURCE': JSON.stringify(facts.source),
    'import.meta.env.DW_SHIPPED_MANDATES': JSON.stringify(String(facts.mandates)),
  }
}

/** The Scorecards tab of the header shell in `index.html`, with the white space before it. */
export const SCORECARDS_TAB = /\s*<span class="nav-tab" data-tab="mm">[\s\S]*?<\/span>\s*<\/span>/

/** The comment in `index.html` where the static site's data line goes. */
export const DATA_LINE_SLOT = '<!--data-line-->'
/** An empty data line, the height of the one the app draws there. */
export const DATA_LINE_SHELL = '<div class="demo-line"><div class="wrap demo-inner"></div></div>'

/**
 * The site's address with exactly one trailing slash: `value`, or `DEFAULT_SITE_URL` when it is
 * unset or blank. Throws unless it is an http(s) URL without credentials, query or fragment.
 */
export function siteUrl(value: string | undefined): string {
  const text = value?.trim() ? value.trim() : DEFAULT_SITE_URL
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error(`VITE_SITE_URL: "${text}" is not a URL`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`VITE_SITE_URL: "${text}" is not an http(s) address`)
  if (url.username || url.password || url.search || url.hash)
    throw new Error(`VITE_SITE_URL: "${text}" must be a plain address, without a query or a #`)
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}

/** `text` safe inside a double-quoted HTML attribute. */
export function escapeAttribute(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/**
 * The `<title>` text and the description meta of `html`, as written there (already HTML-escaped).
 * Throws when either is missing, so a card is never built with empty text.
 */
export function pageText(html: string): { title: string; description: string } {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim()
  const description = /<meta\s+name="description"\s+content="([^"]*)"/.exec(html)?.[1]?.trim()
  if (!title) throw new Error('site meta: index.html has no <title>')
  if (!description) throw new Error('site meta: index.html has no description meta')
  return { title, description }
}

/** The link-preview tags of a page at `site` with this title and description, one per line. */
export function shareTags(site: string, page: { title: string; description: string }): string {
  const tags: Array<[attribute: 'property' | 'name', key: string, value: string]> = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Depthwatch'],
    ['property', 'og:title', page.title],
    ['property', 'og:description', page.description],
    ['property', 'og:url', escapeAttribute(site)],
    ['property', 'og:image', escapeAttribute(new URL(SHARE_IMAGE.path, site).href)],
    ['property', 'og:image:type', 'image/png'],
    ['property', 'og:image:width', String(SHARE_IMAGE.width)],
    ['property', 'og:image:height', String(SHARE_IMAGE.height)],
    ['property', 'og:image:alt', escapeAttribute(SHARE_IMAGE.alt)],
    ['name', 'twitter:card', 'summary_large_image'],
  ]
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${value}" />`).join('\n')
}

/**
 * `html` with the share tags at the end of `<head>`, an empty data line in its slot and, when the
 * shipped bundle has no mandate, no Scorecards tab in the header shell.
 */
export function staticIndexHtml(html: string, site: string, facts?: ShippedFacts): string {
  if (!html.includes('</head>')) throw new Error('site meta: index.html has no </head>')
  if (!html.includes(DATA_LINE_SLOT))
    throw new Error(`site meta: index.html has no ${DATA_LINE_SLOT} in its header shell`)
  if (!SCORECARDS_TAB.test(html))
    throw new Error('site meta: index.html has no Scorecards tab in its header shell')
  const tags = shareTags(site, pageText(html)).split('\n').join('\n    ')
  const out = html
    .replace('</head>', `  ${tags}\n  </head>`)
    .replace(DATA_LINE_SLOT, DATA_LINE_SHELL)
  return facts?.mandates === 0 ? out.replace(SCORECARDS_TAB, '') : out
}

/**
 * The plugin; `url` is `VITE_SITE_URL` as set (undefined or blank for the default), `shipped` reads
 * the facts of the bundle the build ships. The dev server reads no bundle: its app goes by the
 * data as it arrives.
 */
export function siteMeta(opts: { url: string | undefined; shipped: () => ShippedFacts }): Plugin {
  const site = siteUrl(opts.url)
  let facts: ShippedFacts | undefined
  return {
    name: 'depthwatch-site-meta',
    config(_config, { command }) {
      if (command !== 'build') return
      facts = opts.shipped()
      return { define: shippedDefine(facts) }
    },
    transformIndexHtml: {
      order: 'post',
      handler: (html) => staticIndexHtml(html, site, facts),
    },
  }
}
