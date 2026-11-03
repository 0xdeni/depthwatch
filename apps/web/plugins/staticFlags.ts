/**
 * The trade switch in the static build (docs/DEPLOY.md, "Trade switch"). `depthwatch export` writes
 * `flags.json` next to the bundle, exactly `{ "trade": … }` with the bundle's `features.trade`; the
 * static build ships it as `data/flags.json`, next to `data/bundle.json`, and the dashboard reads it
 * again with `cache: 'no-store'` before every signature request (`public/_headers` sends it with
 * `Cache-Control: no-store`, and so does the dev server).
 *
 * The build fails when the file is missing, is not exactly `{ "trade": … }` with the four fields,
 * or differs from the bundle's block, so the two reads of one site always agree. The values are
 * checked by `parseTradeFlags` in `@depthwatch/core` when the dashboard reads them (a Vite config
 * cannot load the workspace's TypeScript packages).
 */
import { existsSync, readFileSync } from 'node:fs'

/** Where the static site serves the file, relative to its `index.html`. */
export const STATIC_FLAGS_PATH = 'data/flags.json'

/** `Cache-Control` of the file: every read goes to the host. */
export const FLAGS_CACHE_CONTROL = 'no-store'

const TRADE_KEYS = ['enabled', 'maxSlippageBps', 'maxUsd', 'venues']

/** JSON text with object keys sorted, so two values compare by content. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)))
      : inner,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const keysOf = (value: Record<string, unknown>): string => Object.keys(value).sort().join(',')

/**
 * The text of the flags file at `source` after checking it against the bundle's text; throws a
 * readable error otherwise.
 */
export function readFlags(source: string, bundleText: string): string {
  const fail = (why: string): never => {
    throw new Error(
      `static build: ${source} ${why}. Run \`pnpm build:static\` from the repository root, or ` +
        '`pnpm depthwatch export --out apps/web/static-data/bundle.json`, which writes flags.json ' +
        'next to the bundle.',
    )
  }
  if (!existsSync(source)) return fail('not found')
  const text = readFileSync(source, 'utf8')
  let flags: unknown
  try {
    flags = JSON.parse(text)
  } catch {
    return fail('is not JSON')
  }
  if (!isRecord(flags) || keysOf(flags) !== 'trade') return fail('is not exactly { "trade": … }')
  const trade = flags.trade
  if (!isRecord(trade) || keysOf(trade) !== TRADE_KEYS.join(','))
    return fail(`has a trade block without exactly the fields ${TRADE_KEYS.join(', ')}`)
  const bundle: unknown = JSON.parse(bundleText)
  const inBundle = isRecord(bundle) && isRecord(bundle.features) ? bundle.features.trade : undefined
  if (inBundle === undefined) return fail('has no counterpart: the bundle has no features.trade')
  if (canonical(inBundle) !== canonical(trade))
    return fail("differs from the bundle's features.trade")
  return text
}
