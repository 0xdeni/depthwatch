// @vitest-environment node
/**
 * The swap panel stays out of what the site loads at boot (DESIGN.md, "Dashboard (apps/web)"):
 * the chunks a page loads at boot, before anything warms the panel, carry no wallet code, no viem
 * and no Builder Code, and stay within a byte budget, while the lazy panel chunk carries both the
 * ERC-8021 marker and the EIP-6963 request (the control: else the first check proves nothing).
 * Builds in memory twice: as `pnpm build` does (the server build), and as the static site's
 * script (`VITE_STATIC=1`), whose boot is the entry plus `staticBoot`; the static build's data
 * plugins only emit files, so its script is built from the app alone.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { build, type InlineConfig, type Rollup } from 'vite'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The ERC-8021 marker that ends the Builder Code suffix. */
const MARKER = '80218021802180218021802180218021'
const WALLET_STRINGS = [MARKER, 'eip6963:requestProvider', 'eth_requestAccounts', 'bc_j6obesn8']

/**
 * Bytes of minified JavaScript a page may load at boot. Before the panel: 567,150 (server) and
 * 573,910 (static: entry 320,228 + staticBoot 253,682). With it: 577,038 and 583,070 (the section,
 * its gate and the compiled-in routes and allowlist it reads); 578,257 and 584,358 before the
 * stock pages, 604,213 and 610,568 with them (`/stocks`, `/stocks/:token` and their words,
 * docs/design/stocks-api.md §3). The budget leaves about 2 % for growth; the panel's own chunk is
 * about 182 KB with viem, so a leak of it into boot fails here.
 */
const BOOT_BUDGET = { server: 616_000, static: 623_000 }

type OutputChunk = Rollup.OutputChunk

async function chunks(env: Record<string, string>, config: InlineConfig): Promise<OutputChunk[]> {
  const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]))
  Object.assign(process.env, env)
  try {
    const result = await build({
      root: WEB_ROOT,
      logLevel: 'silent',
      mode: 'production',
      ...config,
      build: { write: false, sourcemap: false, reportCompressedSize: false },
    })
    const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[]
    return outputs.flatMap((o) => o.output.filter((f): f is OutputChunk => f.type === 'chunk'))
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

/** The boot chunks (every chunk reachable from the entry without entering the panel's) and the panel's. */
function split(all: OutputChunk[]) {
  const byName = new Map(all.map((c) => [c.fileName, c]))
  const panel = all.filter((c) =>
    c.moduleIds.some((id) => id.endsWith('/src/trade/TradePanel.tsx')),
  )
  expect(panel).toHaveLength(1)
  const trade = panel[0]!
  const boot = new Set<OutputChunk>()
  const queue = all.filter((c) => c.isEntry)
  while (queue.length > 0) {
    const chunk = queue.pop()!
    if (chunk === trade || boot.has(chunk)) continue
    boot.add(chunk)
    for (const name of [...chunk.imports, ...chunk.dynamicImports]) {
      const next = byName.get(name)
      if (next) queue.push(next)
    }
  }
  return { boot: [...boot], trade }
}

function check(all: OutputChunk[], budget: number) {
  const { boot, trade } = split(all)
  const bootCode = boot.map((c) => c.code).join('\n')
  expect(WALLET_STRINGS.filter((text) => bootCode.includes(text))).toEqual([])
  const viem = boot.flatMap((c) => c.moduleIds).filter((id) => /[/\\]viem[/\\]/.test(id))
  expect(viem).toEqual([])
  // The control: the panel's chunk has what the boot chunks must not.
  expect(WALLET_STRINGS.filter((text) => !trade.code.includes(text))).toEqual([])
  expect(trade.isDynamicEntry).toBe(true)
  const bytes = boot.reduce((sum, c) => sum + Buffer.byteLength(c.code), 0)
  expect(bytes).toBeLessThanOrEqual(budget)
  return { bootBytes: bytes, tradeBytes: Buffer.byteLength(trade.code) }
}

describe('the swap panel is a lazy chunk', () => {
  it('stays out of the server build’s boot chunks', async () => {
    const all = await chunks(
      { NODE_ENV: 'production', VITE_MOCK: '', VITE_STATIC: '' },
      { configFile: join(WEB_ROOT, 'vite.config.ts') },
    )
    const { tradeBytes } = check(all, BOOT_BUDGET.server)
    expect(tradeBytes).toBeGreaterThan(100_000)
  }, 120_000)

  it('stays out of the static site’s boot chunks (entry and staticBoot)', async () => {
    const all = await chunks(
      { NODE_ENV: 'production', VITE_MOCK: '', VITE_STATIC: '1' },
      { configFile: false, base: './', plugins: [react()] },
    )
    expect(all.some((c) => c.moduleIds.some((id) => id.endsWith('/src/staticBoot.tsx')))).toBe(true)
    check(all, BOOT_BUDGET.static)
  }, 120_000)
})
