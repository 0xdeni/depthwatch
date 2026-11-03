/**
 * `@depthwatch/chain/addresses` is browser-safe: its module graph (relative imports and the
 * `@depthwatch/core` workspace package, followed to the end) holds no `node:` import, no Node
 * built-in and no other package, while the package barrel does pull `node:crypto`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as subpath from './addressesExport.js'

const SRC = dirname(fileURLToPath(import.meta.url))
const PACKAGE = join(SRC, '..')
const WORKSPACE_ENTRIES: Record<string, string> = {
  '@depthwatch/core': join(PACKAGE, '..', 'core', 'src', 'index.ts'),
}

/** Every module specifier of a TypeScript source: static, re-export, side-effect and dynamic. */
function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const out: string[] = []
  const patterns = [
    /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) for (const m of code.matchAll(pattern)) out.push(m[1]!)
  return out
}

/** Walks the graph from `entry`; returns the visited files and every non-relative specifier. */
function moduleGraph(entry: string): { files: string[]; external: Map<string, string[]> } {
  const seen = new Set<string>()
  const external = new Map<string, string[]>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec).replace(/\.js$/, '.ts')
        if (!existsSync(target)) throw new Error(`${file}: cannot resolve ${spec}`)
        queue.push(target)
        continue
      }
      external.set(spec, [...(external.get(spec) ?? []), file])
      const workspace = WORKSPACE_ENTRIES[spec]
      if (workspace) queue.push(workspace)
    }
  }
  return { files: [...seen], external }
}

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))

describe('@depthwatch/chain/addresses', () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as {
    exports: Record<string, { types: string; default: string }>
  }

  it('is exported from package.json and points at addressesExport.ts', () => {
    expect(pkg.exports['./addresses']).toEqual({
      types: './src/addressesExport.ts',
      default: './src/addressesExport.ts',
    })
  })

  it('has no node: import, Node built-in or package but @depthwatch/core in its graph', () => {
    const { files, external } = moduleGraph(join(PACKAGE, pkg.exports['./addresses']!.default))
    expect(files.length).toBeGreaterThan(3)
    const offenders = [...external.keys()].filter(
      (s) => s.startsWith('node:') || NODE_BUILTINS.has(s),
    )
    expect(offenders).toEqual([])
    expect([...external.keys()]).toEqual(['@depthwatch/core'])
  })

  it('the walk does see node: imports where they exist (the package barrel)', () => {
    const { external } = moduleGraph(join(SRC, 'index.ts'))
    expect([...external.keys()]).toEqual(expect.arrayContaining(['node:crypto', 'viem']))
  })

  it('exports the addresses, the trade group and the trade ABIs', () => {
    expect(Object.keys(subpath)).toEqual(
      expect.arrayContaining([
        'BASE_ADDRESSES',
        'TOKENS',
        'TRADE_ROUTES',
        'TRADE_TOKENS',
        'tradeRouteFor',
        'isTradeToken',
        'swapRouter02Abi',
        'slipstreamSwapRouterAbi',
        'quoterV2Abi',
        'slipstreamQuoterV2Abi',
        'metaquoterAbi',
        'tradeErc20Abi',
        'tradePoolAbi',
        'uniswapV3GetPoolAbi',
        'clFactoryGetPoolAbi',
      ]),
    )
  })
})
