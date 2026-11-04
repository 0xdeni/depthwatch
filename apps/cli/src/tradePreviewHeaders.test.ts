/**
 * The headers of the Trade preview (docs/DEPLOY.md, "Trade preview (the live test)"). The build
 * step inserts `X-Robots-Tag: noindex, nofollow` into the one `/*` block of the built `_headers`:
 * on the first run, a second `/*` block appended to the file replaced the first on Pages, and the
 * preview served neither the Content-Security-Policy nor X-Frame-Options. Once the preview serves
 * the build, the run checks the headers it serves against that block. Both scripts run here as
 * the workflow runs them: the insertion on the real `_headers` (`apps/web/plugins/
 * securityHeaders.test.ts` checks the result against the model of Pages), the check against a
 * server on 127.0.0.1 that answers as the preview should, or as it did on the first run, and the
 * whole step around the check under `bash -e`, without its waits, against the same server.
 */
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type OutgoingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  nodeScripts,
  PRODUCTION_PUBLISHERS,
  read,
  runScripts,
  stepOf,
  workflow,
} from './testing/workflowText.js'

const PREVIEW = workflow('trade-preview.yml')
const BUILD = stepOf(PREVIEW, 'Build the static site')
const POLL = stepOf(PREVIEW, "Check the preview's switch")
const BUILT_FILE = 'apps/web/dist-static/_headers'
/** The `_headers` the static build ships: Vite copies `public/` into the output as it is. */
const SOURCE = read('apps', 'web', 'public', '_headers')
const POLICY = /^ {2}Content-Security-Policy: (.+)$/m.exec(SOURCE)?.[1] ?? ''

/** The one `node -e` script of a step, which must take the built `_headers` as its argument. */
function scriptOf(step: string): string {
  const scripts = nodeScripts(step)
  expect(scripts).toHaveLength(1)
  expect(scripts[0]?.args).toBe(BUILT_FILE)
  return scripts[0]?.script ?? ''
}
const INSERT = scriptOf(BUILD)
const CHECK = scriptOf(POLL)

/** Runs a command to its end, without blocking the server below; its output, both streams. */
function exec(command: string, args: string[], env: Record<string, string>, cwd?: string) {
  return new Promise<{ code: number | null; out: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1', ...env },
    })
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    child.stderr.on('data', (chunk) => {
      out += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, out }))
  })
}
/** Runs a workflow script as `node -e`. */
const run = (script: string, file: string, env: Record<string, string> = {}) =>
  exec(process.execPath, ['-e', script, file], env)

describe('the noindex header of the preview', () => {
  it('goes into the built /* block in the build step; nothing is appended', () => {
    expect(INSERT).toContain('const found = lines.filter((line) => line === "/*").length')
    expect(INSERT).toMatch(
      /if \(found !== 1\) \{\n[^}]*nothing was published\.[^}]*process\.exit\(1\)\n\s*\}/,
    )
    expect(INSERT).toContain(
      'lines.splice(lines.indexOf("/*") + 1, 0, "  X-Robots-Tag: noindex, nofollow")',
    )
    expect(INSERT).toContain('fs.writeFileSync(file, lines.join("\\n"))')
    expect(PREVIEW).not.toContain(`>> ${BUILT_FILE}`)
    expect(PREVIEW).not.toMatch(/printf[^\n]*X-Robots-Tag/)
    // A refusal stops the run before the upload: the step cannot be skipped.
    expect(BUILD).not.toMatch(/^\s+if:/m)
    const insert = PREVIEW.indexOf('lines.splice(lines.indexOf("/*") + 1')
    expect(insert).toBeGreaterThan(PREVIEW.indexOf('pnpm --filter @depthwatch/web build:static'))
    expect(insert).toBeLessThan(PREVIEW.indexOf('wrangler pages deploy'))
    expect(PREVIEW).toContain('Not found. This static copy of Depthwatch has no API')
    for (const file of PRODUCTION_PUBLISHERS)
      expect(workflow(file), file).not.toContain('X-Robots-Tag')
    expect(SOURCE).not.toContain('X-Robots-Tag')
  })
})

describe("the preview's security headers, checked after the upload", () => {
  const dir = mkdtempSync(join(tmpdir(), 'depthwatch-preview-headers-'))
  const file = join(dir, '_headers')
  /** The build the step compares the preview with, under `dir` as under the repository. */
  const build = join(dir, 'apps', 'web', 'dist-static')
  const INDEX =
    '<!doctype html><title>Depthwatch</title><script src="/assets/index-1.js"></script>\n'
  const FLAGS = '{"trade":{"enabled":true,"venues":["uniswap-v3"]}}\n'
  /** What the server answers, by path: headers, and this build's index.html or another one. */
  let served: (path: string) => OutgoingHttpHeaders = () => ({})
  let index = INDEX
  const server = createServer((request, response) => {
    response.writeHead(200, served(request.url ?? '/'))
    response.end(request.url === '/' ? index : FLAGS)
  })
  let url = ''

  beforeAll(async () => {
    writeFileSync(file, SOURCE)
    expect(await run(INSERT, file)).toMatchObject({ code: 0 })
    expect(readFileSync(file, 'utf8')).toContain('/*\n  X-Robots-Tag: noindex, nofollow\n')
    mkdirSync(join(build, 'data'), { recursive: true })
    copyFileSync(file, join(build, '_headers'))
    writeFileSync(join(build, 'index.html'), INDEX)
    writeFileSync(join(build, 'data', 'flags.json'), FLAGS)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })
  const check = (headersFile = file) => run(CHECK, headersFile, { PREVIEW_URL: url })

  /** The headers the preview should serve, and those it served on the first run. */
  const flags = (path: string) =>
    path === '/data/flags.json' ? { 'Cache-Control': 'no-store' } : {}
  const asBuilt = (path: string) => ({
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': POLICY,
    'X-Robots-Tag': 'noindex, nofollow',
    ...flags(path),
  })
  const firstRun = (path: string) => ({
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...flags(path),
  })

  it('passes when / and data/flags.json serve the built headers, names in any case', async () => {
    expect(POLICY).toMatch(/^default-src 'self'; script-src 'self' 'sha256-/)
    served = asBuilt
    expect(await check()).toEqual({ code: 0, out: '' })
    served = (path) => ({
      'content-security-policy': POLICY,
      'X-FRAME-OPTIONS': 'DENY',
      'x-robots-tag': 'noindex',
      ...flags(path),
    })
    expect(await check()).toEqual({ code: 0, out: '' })
  })

  it('fails on the headers the first run served, naming each one missing', async () => {
    served = firstRun
    const { code, out } = await check()
    expect(code).toBe(1)
    for (const path of ['/', '/data/flags.json'])
      for (const name of ['content-security-policy', 'x-frame-options'])
        expect(out).toContain(`${path}: ${name} served none, built `)
    expect(out).not.toContain('x-robots-tag')
  })

  it('fails unless the values are exactly the built ones, on both paths', async () => {
    for (const change of [
      (path: string) => ({ ...asBuilt(path), 'Content-Security-Policy': `${POLICY}; img-src *` }),
      (path: string) => ({ ...asBuilt(path), 'Content-Security-Policy': [POLICY, POLICY] }),
      (path: string) => ({ ...asBuilt(path), 'X-Frame-Options': 'SAMEORIGIN' }),
      (path: string) => (path === '/' ? asBuilt(path) : firstRun(path)),
    ]) {
      served = change
      expect(await check()).toMatchObject({ code: 1 })
    }
    served = (path) => ({ ...asBuilt(path), 'X-Robots-Tag': 'nofollow' })
    expect(await check()).toMatchObject({
      code: 1,
      out: expect.stringContaining('without noindex'),
    })
  })

  it('fails when the built /* block lacks a header, or the preview cannot be read', async () => {
    const bare = join(dir, '_headers.bare')
    writeFileSync(bare, readFileSync(file, 'utf8').replace(/^ {2}X-Frame-Options: .*\n/m, ''))
    served = (path) => ({ ...firstRun(path), 'Content-Security-Policy': POLICY })
    expect(await check(bare)).toMatchObject({ code: 1, out: expect.stringContaining('built none') })
    const closed = await run(CHECK, file, { PREVIEW_URL: 'http://127.0.0.1:1' })
    expect(closed).toMatchObject({ code: 1, out: expect.stringContaining('Could not read') })
    // A stalled answer ends there too, after 30 s, as the curl calls of the step do.
    expect(CHECK).toContain('const signal = AbortSignal.timeout(30000)')
    expect(CHECK).toContain('{ headers: { "cache-control": "no-cache" }, signal })')
    expect(POLL).toContain('curl --fail --silent --show-error --max-time 30')
  })

  it('runs once the preview serves this build, and only a pass ends the poll', () => {
    const lines = POLL.split('\n').map((line) => line.trim())
    const build = lines.indexOf(`if [ "$got" = "$want" ] && [ "$page" = "this build's" ]; then`)
    const pass = lines.indexOf(`' ${BUILT_FILE}; then`)
    expect(lines[build + 1]).toBe("if node -e '")
    expect(lines.slice(pass + 1, pass + 3)).toEqual([
      `echo "$PREVIEW_URL serves this build's index.html, the new switch and its security headers."`,
      'exit 0',
    ])
    expect(lines.filter((line) => line === 'exit 0')).toHaveLength(1)
    expect(POLL).not.toContain('::warning::')
  })

  /** The step's shell as the runner runs it (`bash -e`), in `dir`, with `sleep` doing nothing. */
  const poll = () => {
    const shells = runScripts(POLL)
    expect(shells).toHaveLength(1)
    const shell = `sleep() { :; }\n${shells[0] ?? ''}`
    return exec('bash', ['-e', '-c', shell], { PREVIEW_URL: url, RUNNER_TEMP: dir }, dir)
  }
  const lastLine = (out: string) => out.trim().split('\n').at(-1) ?? ''

  it('fails the run saying the preview must be switched off, and that it is still deployed', async () => {
    served = asBuilt
    const pass = await poll()
    expect(pass.code).toBe(0)
    expect(lastLine(pass.out)).toBe(
      `${url} serves this build's index.html, the new switch and its security headers.`,
    )
    served = firstRun
    const { code, out } = await poll()
    expect(code).toBe(1)
    expect(out).toContain('Attempt 12: the preview serves this build without its security headers')
    const error = lastLine(out)
    expect(error).toMatch(
      new RegExp(`^::error::${url.replace(/\./g, '\\.')} is serving this build without its`),
    )
    for (const text of [
      'A failed run leaves the preview deployed',
      'it must be switched off now, by running Trade preview again with off',
    ])
      expect(error).toContain(text)
    expect(out).not.toContain('does not serve this build')
  })

  it('fails without naming the headers when the preview serves another build', async () => {
    served = asBuilt
    index = INDEX.replace('index-1.js', 'index-0.js')
    const { code, out } = await poll()
    index = INDEX
    expect(code).toBe(1)
    expect(out).toContain('Attempt 12: the preview serves')
    expect(lastLine(out)).toBe(
      `::error::${url} does not serve this build and its switch after 2 minutes.`,
    )
    expect(out).not.toContain('security headers')
  })
})

describe('docs/DEPLOY.md: the headers of the preview', () => {
  const deploy = read('docs', 'DEPLOY.md')
  const start = deploy.indexOf('### Trade preview (the live test)')
  const section = deploy.slice(start, deploy.indexOf('## Upgrading')).replace(/\s+/g, ' ')

  it('says where the header goes, what the first run showed and what is checked', () => {
    for (const text of [
      'the build step inserts it into the one `/*` block of the built `_headers`, right after that line',
      'unless the file has exactly one line `/*`',
      'that a block replaces an earlier one with the same pattern was seen on Pages, not documented',
      'the static build fails when `_headers` opens a URL pattern twice',
      '`/` and `/data/flags.json` must be served the Content-Security-Policy and `X-Frame-Options` of the built `/*` block, exactly, and an `X-Robots-Tag` with `noindex`',
      'its switch and its security headers',
      'a built `_headers` without exactly one line `/*`',
      'if the log says the preview is serving this build without its security headers, a failed run leaves the preview deployed',
      'Switch it off at once by running Trade preview again with `off`',
      'The preview served `X-Robots-Tag: noindex, nofollow`, and `Cache-Control: no-store` on `/data/flags.json`',
      'the appended `/*` block replaced the first one instead of joining it',
      'the served headers are checked after each upload',
    ])
      expect(section, text).toContain(text)
    expect(section).not.toContain('`_headers` overrides what it ordinarily sends')
  })
})
