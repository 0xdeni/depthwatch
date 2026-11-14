/**
 * The page Cloudflare Pages serves, with HTTP 404, for every path the static copy does not have:
 * `public/404.html` and its stylesheet `public/404.css`, which Vite copies into the output. Without
 * a 404.html at the top of the output, Pages treats the site as a single-page app and answers
 * every unknown path, `/api/…` included, with index.html and HTTP 200, although the static copy has
 * no API (docs/DEPLOY.md, "A free static copy").
 *
 * The page lives under the site's Content-Security-Policy (`public/_headers`), which runs no
 * inline script and applies no inline style, and Pages serves it at any depth (`/api/pools/x` as
 * well as `/x`). So the static build checks the two files it wrote: a whole document (doctype,
 * charset, viewport, title) with no script, no inline style and no event handler attribute, a link
 * home, and every address it loads or links to a path from the site's root (`/…`) that the build
 * has, never relative, protocol-relative or on another host; the stylesheet imports nothing and
 * loads only such paths. `notFoundPage.test.ts` checks the source files against the same rules.
 *
 * The server build (`dist/`, served by `depthwatch serve`) leaves both files out: the server
 * answers unknown paths itself, and the page's sentence about the missing API is true only of the
 * static copy.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

export const NOT_FOUND_PAGE = '404.html'
export const NOT_FOUND_STYLES = '404.css'

const withoutComments = (text: string, comment: RegExp) => text.replace(comment, '')
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g

/** The value of every `href` and `src` attribute of `html`, in document order. */
export function pageAddresses(html: string): string[] {
  const text = withoutComments(html, HTML_COMMENT)
  return [...text.matchAll(/\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  )
}

/** The address of every `url(…)` of a stylesheet, quotes removed. */
export function styleAddresses(css: string): string[] {
  const text = withoutComments(css, CSS_COMMENT)
  return [...text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  )
}

/** Whether `address` is a path from the site's root: `/…`, never `//host/…`. */
export const isRootPath = (address: string) => /^\/(?![/\\])/.test(address)

/** What is wrong with a not-found page; empty when nothing is. */
export function notFoundPageProblems(html: string): string[] {
  const text = withoutComments(html, HTML_COMMENT)
  const problems: string[] = []
  if (!/^<!doctype html>/i.test(html)) problems.push('it does not start with <!doctype html>')
  if (!/<meta charset="utf-8"\s*\/?>/i.test(text)) problems.push('it has no <meta charset="utf-8">')
  if (!/<meta name="viewport" content="width=device-width[^"]*"\s*\/?>/i.test(text))
    problems.push('it has no viewport <meta> with width=device-width')
  if (!/<title>[^<]*\S[^<]*<\/title>/i.test(text)) problems.push('it has no <title>')
  if (/<script\b/i.test(text)) problems.push('it has a <script>, which the policy does not run')
  if (/<style\b/i.test(text) || /<[^>]*\sstyle\s*=/i.test(text))
    problems.push('it has an inline style, which the policy does not apply')
  if (/<[^>]*\son[a-z]+\s*=/i.test(text))
    problems.push('it has an event handler attribute, which the policy does not run')
  const addresses = pageAddresses(html)
  for (const address of addresses.filter((a) => !isRootPath(a)))
    problems.push(`"${address}" is not a path from the site's root`)
  if (!addresses.includes('/')) problems.push('it has no link to the home page (href="/")')
  return problems
}

/** What is wrong with the not-found page's stylesheet; empty when nothing is. */
export function notFoundStyleProblems(css: string): string[] {
  const problems: string[] = []
  if (/@import\b/i.test(withoutComments(css, CSS_COMMENT)))
    problems.push('it has an @import; put the rules in this file')
  for (const address of styleAddresses(css).filter((a) => !isRootPath(a)))
    problems.push(`"${address}" is not a path from the site's root`)
  return problems
}

/** The file of `dir` that a root path names: its query and fragment dropped, `/` for index.html. */
function fileOf(dir: string, address: string): string {
  const path = address.replace(/[?#].*$/, '')
  return join(dir, path.endsWith('/') ? `${path}index.html` : path)
}

/**
 * Throws unless `dir`, a built output, has the page and its stylesheet, both without problems, and
 * every root path they name.
 */
export function checkNotFoundPage(dir: string): void {
  const page = join(dir, NOT_FOUND_PAGE)
  const styles = join(dir, NOT_FOUND_STYLES)
  for (const file of [page, styles])
    if (!existsSync(file)) throw new Error(`not-found page: the static build wrote no ${file}`)
  const html = readFileSync(page, 'utf8')
  const css = readFileSync(styles, 'utf8')
  const problems = [
    ...notFoundPageProblems(html).map((problem) => `${page}: ${problem}`),
    ...notFoundStyleProblems(css).map((problem) => `${styles}: ${problem}`),
  ]
  for (const address of [...pageAddresses(html), ...styleAddresses(css)].filter(isRootPath))
    if (!existsSync(fileOf(dir, address)))
      problems.push(`${address} is named by the not-found page but not in ${dir}`)
  if (problems.length > 0) throw new Error(`not-found page: ${problems.join('; ')}`)
}

/** Checks the page in the static build's output; removes it from the server build's. */
export function notFoundPage(opts: { keepFile: boolean }): Plugin {
  return {
    name: 'depthwatch-not-found-page',
    writeBundle(options) {
      if (options.dir === undefined) return
      if (opts.keepFile) {
        checkNotFoundPage(options.dir)
        return
      }
      for (const file of [NOT_FOUND_PAGE, NOT_FOUND_STYLES])
        rmSync(join(options.dir, file), { force: true })
    },
  }
}
