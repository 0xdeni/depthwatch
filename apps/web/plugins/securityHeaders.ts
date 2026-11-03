/**
 * The static site's response headers: `public/_headers`, which Vite copies into the output and
 * Cloudflare Pages reads from there (docs/DEPLOY.md, "A free static copy"). Its
 * Content-Security-Policy runs inline scripts only by hash, so this plugin checks, in every build,
 * that the `script-src` hashes are exactly those of the inline scripts of the built `index.html`:
 * editing one without the other fails the build, and `src/productionBundle.test.ts`, which builds
 * the app, fails with it. `plugins/securityHeaders.test.ts` checks the source `index.html` and the
 * rules themselves.
 *
 * The server build (`dist/`, served by `depthwatch serve`) leaves the file out: the server does
 * not read it, so shipping it there would only publish rules that do not apply.
 */
import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The rules file, as written (`apps/web/public/_headers`). */
export const HEADERS_SOURCE = resolve(HERE, '..', 'public', '_headers')
export const HEADERS_FILE_NAME = '_headers'

/** One block of `_headers`: a URL pattern and its `Name: value` lines, names lowercased. */
export interface HeaderRule {
  pattern: string
  headers: Array<[name: string, value: string]>
}

/**
 * The rules of a `_headers` file: a line at column 0 opens a block with its URL pattern, indented
 * `Name: value` lines belong to it, `#` lines and blank lines are skipped. Throws on a header line
 * outside a block or without a colon.
 */
export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: HeaderRule[] = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] })
      continue
    }
    const rule = rules.at(-1)
    const colon = line.indexOf(':')
    if (rule === undefined || colon < 0)
      throw new Error(`_headers line ${index + 1}: expected "Name: value" under a URL pattern`)
    rule.headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()])
  }
  return rules
}

/** Whether a rule's pattern matches `path`: the exact path, or a single `*` splat. */
export function patternMatches(pattern: string, path: string): boolean {
  const star = pattern.indexOf('*')
  if (star < 0) return pattern === path
  const [head, tail] = [pattern.slice(0, star), pattern.slice(star + 1)]
  return path.length >= head.length + tail.length && path.startsWith(head) && path.endsWith(tail)
}

/**
 * The headers Cloudflare Pages sends for `path`: every matching rule's, in file order; a name set
 * by two rules gets their values joined with ", ", as Pages does.
 */
export function headersFor(rules: readonly HeaderRule[], path: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, path)) continue
    for (const [name, value] of rule.headers) {
      const before = out.get(name)
      out.set(name, before === undefined ? value : `${before}, ${value}`)
    }
  }
  return out
}

/** A policy's directives, by lowercased name, each with its source list. */
export function cspDirectives(policy: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name !== undefined && name !== '') out.set(name.toLowerCase(), sources)
  }
  return out
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
/** Script types a browser does not run, so the policy does not govern them. */
const DATA_TYPES = /\btype\s*=\s*["']?(application\/(ld\+)?json|importmap|text\/plain)\b/i

/**
 * `'sha256-…'` of every inline script of `html` (a `<script>` without `src` whose type runs), in
 * document order: the base64 SHA-256 of its exact text, as the policy's hash sources take it.
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  for (const [, attributes = '', body = ''] of html.matchAll(SCRIPT_RE)) {
    if (/\bsrc\s*=/i.test(attributes) || DATA_TYPES.test(attributes)) continue
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }
  return hashes
}

/** The hash sources of the `script-src` the rules give `/`. */
export function cspScriptHashes(rules: readonly HeaderRule[]): string[] {
  const policy = headersFor(rules, '/').get('content-security-policy')
  if (policy === undefined) throw new Error('_headers: no Content-Security-Policy for /')
  const scriptSrc = cspDirectives(policy).get('script-src')
  if (scriptSrc === undefined)
    throw new Error('_headers: the Content-Security-Policy has no script-src')
  return scriptSrc.filter((source) => /^'sha(256|384|512)-/.test(source))
}

/**
 * Throws unless the `script-src` hashes of `headersText` are exactly the inline scripts of `html`,
 * naming the hashes to add and to remove.
 */
export function checkInlineScripts(html: string, headersText: string): void {
  const inHtml = new Set(inlineScriptHashes(html))
  const inPolicy = new Set(cspScriptHashes(parseHeadersFile(headersText)))
  const add = [...inHtml].filter((hash) => !inPolicy.has(hash))
  const remove = [...inPolicy].filter((hash) => !inHtml.has(hash))
  if (add.length === 0 && remove.length === 0) return
  throw new Error(
    'apps/web/public/_headers: the Content-Security-Policy script-src hashes differ from the ' +
      `inline scripts of index.html (add: ${add.join(' ') || 'none'}; remove: ${remove.join(' ') || 'none'})`,
  )
}

/**
 * Checks the built `index.html` against the rules (both builds) and, for the server build, removes
 * `_headers` from the written output.
 */
export function securityHeaders(opts: { readText: () => string; keepFile: boolean }): Plugin {
  return {
    name: 'depthwatch-security-headers',
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const html = bundle['index.html']
        if (html === undefined || html.type !== 'asset')
          throw new Error('security headers: the build emitted no index.html')
        const text =
          typeof html.source === 'string' ? html.source : new TextDecoder().decode(html.source)
        checkInlineScripts(text, opts.readText())
      },
    },
    writeBundle(options) {
      if (!opts.keepFile && options.dir !== undefined)
        rmSync(join(options.dir, HEADERS_FILE_NAME), { force: true })
    },
  }
}
