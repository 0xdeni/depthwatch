import { existsSync, readFileSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { agentDocs, staticSiteInfo } from './plugins/agentDocs.js'
import { notFoundPage } from './plugins/notFoundPage.js'
import { HEADERS_SOURCE, securityHeaders } from './plugins/securityHeaders.js'
import { shippedFacts, siteMeta } from './plugins/siteMeta.js'
import { FLAGS_CACHE_CONTROL, readFlags, STATIC_FLAGS_PATH } from './plugins/staticFlags.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The bundle the static build ships: written by `depthwatch export` (the root `pnpm build:static`
 * exports the demo world here first). Git-ignored.
 */
const STATIC_BUNDLE_SOURCE = resolve(HERE, 'static-data/bundle.json')
/** Where the static site reads it, relative to its index.html (`STATIC_BUNDLE_URL`). */
const STATIC_BUNDLE_PATH = 'data/bundle.json'
/** The trade switch `depthwatch export` writes next to the bundle (plugins/staticFlags.ts). */
const STATIC_FLAGS_SOURCE = resolve(HERE, 'static-data/flags.json')

/** The bundle's text after a sanity check of its envelope; throws a readable error otherwise. */
function readBundle(source: string): string {
  if (!existsSync(source)) {
    throw new Error(
      `static build: ${source} not found. Run \`pnpm build:static\` from the repository root, or ` +
        '`pnpm depthwatch export --demo --out apps/web/static-data/bundle.json` first.',
    )
  }
  const text = readFileSync(source, 'utf8')
  const parsed: unknown = JSON.parse(text)
  const envelope = parsed as { v?: unknown; source?: unknown } | null
  if (envelope === null || envelope.v !== 1 || typeof envelope.source !== 'string') {
    throw new Error(`static build: ${source} is not a v1 Depthwatch static bundle`)
  }
  return text
}

/**
 * Static mode only: copies the exported bundle into the output as `data/bundle.json` and the trade
 * switch next to it as `data/flags.json` (failing the build when either is missing or they
 * disagree), and serves both at the same paths from the dev server, the switch uncached.
 */
function staticBundle(source: string, flagsSource: string): Plugin {
  const serve = (path: string, read: () => string, cacheControl?: string) =>
    [
      `/${path}`,
      (_req: unknown, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        if (cacheControl !== undefined) res.setHeader('Cache-Control', cacheControl)
        try {
          res.end(read())
        } catch (error) {
          res.statusCode = 404
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    ] as const
  const flags = () => readFlags(flagsSource, readBundle(source))
  return {
    name: 'depthwatch-static-bundle',
    configureServer(server) {
      server.middlewares.use(...serve(STATIC_BUNDLE_PATH, () => readBundle(source)))
      server.middlewares.use(...serve(STATIC_FLAGS_PATH, flags, FLAGS_CACHE_CONTROL))
    },
    buildStart() {
      flags()
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: STATIC_BUNDLE_PATH, source: readBundle(source) })
      this.emitFile({ type: 'asset', fileName: STATIC_FLAGS_PATH, source: flags() })
    },
  }
}

/**
 * Two build modes (docs/design/web-v2.md §4):
 * - default (`vite build`): `dist/`, absolute base, BrowserRouter, `/api` with the mock fallback;
 * - static (`VITE_STATIC=1 vite build`, script `build:static`): `dist-static/`, relative base
 *   `./`, HashRouter and the client answering from `data/bundle.json`.
 * Both emit the agent documents (`AGENTS.md`, `llms.txt`, `openapi.json`, see
 * `plugins/agentDocs.ts`); the static copies carry a note generated from the shipped bundle. Both
 * check `public/_headers` against the built `index.html`; only the static build keeps that file
 * (`plugins/securityHeaders.ts`), and the not-found page `public/404.html`, which it checks
 * (`plugins/notFoundPage.ts`). Only the static build carries the link-preview tags, with absolute
 * URLs from `VITE_SITE_URL`, and hands its app and header shell what the shipped bundle holds
 * before it loads (`plugins/siteMeta.ts`).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, HERE, 'VITE_')
  const isStatic = env.VITE_STATIC === '1'
  const staticSite = () => staticSiteInfo(readBundle(STATIC_BUNDLE_SOURCE))
  const headers = securityHeaders({
    readText: () => readFileSync(HEADERS_SOURCE, 'utf8'),
    keepFile: isStatic,
  })
  return {
    base: isStatic ? './' : '/',
    plugins: isStatic
      ? [
          react(),
          staticBundle(STATIC_BUNDLE_SOURCE, STATIC_FLAGS_SOURCE),
          agentDocs({ staticSite }),
          siteMeta({
            url: env.VITE_SITE_URL,
            shipped: () => shippedFacts(readBundle(STATIC_BUNDLE_SOURCE)),
          }),
          headers,
          notFoundPage({ keepFile: true }),
        ]
      : [react(), agentDocs(), headers, notFoundPage({ keepFile: false })],
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:8787',
      },
    },
    build: {
      outDir: isStatic ? 'dist-static' : 'dist',
      sourcemap: true,
    },
  }
})
