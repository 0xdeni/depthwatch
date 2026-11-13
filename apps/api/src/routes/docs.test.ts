/**
 * docs/ARCHITECTURE.md ("API and dashboard") says which documents list the API routes. These
 * checks pin that pointer to the routes `createApp` really registers: a document the page says
 * lists every route must list each of them, and the per-layer pointers must hold for their layer.
 * DESIGN.md's API section names each response by its `dto.ts` type, which must exist, and its
 * "May import" column lists every dependency of each workspace package's package.json. Every
 * document that states the pools search (`q`) gives core's rule, the pasted pool id included.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { POOL_QUERY_MAX_LENGTH } from '@depthwatch/core'
import { IN_MEMORY, openDatabase } from '@depthwatch/db'
import { describe, expect, it } from 'vitest'
import { createApp } from '../app.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Where each document that can be named as a route listing keeps its routes. */
const LISTINGS = [
  { name: 'README', file: 'README.md', heading: '## API' },
  { name: 'DESIGN.md', file: 'DESIGN.md', heading: '## API (apps/api)' },
  {
    name: '[design/scorecards.md](design/scorecards.md)',
    file: 'docs/design/scorecards.md',
    heading: '## 6. API (`apps/api`)',
  },
] as const

/** `METHOD /path` of every handler `createApp` registers (middleware entries are `ALL`). */
function registeredRoutes(): string[] {
  const db = openDatabase(IN_MEMORY)
  try {
    const routes = createApp(db)
      .routes.filter((r) => r.method !== 'ALL')
      .map((r) => `${r.method} ${r.path}`)
    return [...new Set(routes)]
  } finally {
    db.close()
  }
}

/** The body under `heading` up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`${heading} not found`)
  const body = markdown.slice(start + heading.length + 2)
  const end = body.search(new RegExp(`\\n#{1,${heading.indexOf(' ')}} `))
  return end < 0 ? body : body.slice(0, end)
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The routes `markdown` does not mention as `METHOD /path` (a longer path does not count). */
function unlisted(markdown: string, routes: readonly string[]): string[] {
  return routes.filter((route) => !new RegExp(`${escapeRegExp(route)}(?![\\w/:.-])`).test(markdown))
}

/** A listing's route section, by the name ARCHITECTURE.md gives the document. */
function listing(name: (typeof LISTINGS)[number]['name']): string {
  const doc = LISTINGS.find((l) => l.name === name)
  if (!doc) throw new Error(`unknown listing ${name}`)
  return section(read(doc.file), doc.heading)
}

const routes = registeredRoutes()
const scorecardRoutes = routes.filter((r) => / \/api\/mm(?:\/|$)/.test(r))
const layer1Routes = routes.filter((r) => !scorecardRoutes.includes(r))
const architecture = section(read('docs/ARCHITECTURE.md'), '## API and dashboard').replace(
  /\s+/g,
  ' ',
)

describe('ARCHITECTURE.md: the documents it names list the routes createApp registers', () => {
  it('sees both layers of routes', () => {
    expect(layer1Routes).toEqual(expect.arrayContaining(['GET /api/health', 'GET /api/pools/:id']))
    expect(scorecardRoutes).toEqual(
      expect.arrayContaining(['GET /api/mm/:id/badge.svg', 'POST /api/mm', 'DELETE /api/mm/:id']),
    )
  })

  it('every document named as listing all routes lists each of them', () => {
    const claim = architecture.match(/(?:Every route is|Routes are) listed in (.+?)[.;](?:\s|$)/)
    if (!claim?.[1]) throw new Error(`no route-listing pointer in:\n${architecture}`)
    const named = LISTINGS.filter((l) => claim[1]?.includes(l.name))
    expect(named.map((l) => l.name)).toContain('README')
    for (const doc of named) {
      expect({ doc: doc.name, missing: unlisted(listing(doc.name), routes) }).toEqual({
        doc: doc.name,
        missing: [],
      })
    }
  })

  it('DESIGN.md lists the layer-1 routes', () => {
    expect(architecture).toContain('DESIGN.md lists the layer-1 ones')
    expect(unlisted(listing('DESIGN.md'), layer1Routes)).toEqual([])
  })

  it('design/scorecards.md §6 lists the scorecard routes', () => {
    expect(architecture).toContain(
      '[design/scorecards.md](design/scorecards.md) §6 the scorecard ones',
    )
    expect(
      unlisted(listing('[design/scorecards.md](design/scorecards.md)'), scorecardRoutes),
    ).toEqual([])
  })
})

describe('DESIGN.md: the API section names the dto.ts types', () => {
  const api = listing('DESIGN.md')
  const named = [...api.matchAll(/→\s+`([A-Z]\w+)`/g)].map((m) => m[1] ?? '')
  const dto = read('apps/api/src/dto.ts')

  it('points at dto.ts and openapi.json for the fields', () => {
    expect(api).toContain('`apps/api/src/dto.ts`')
    expect(api).toContain('`apps/api/src/agentDocs/openapi.json`')
    expect(named).toEqual(
      expect.arrayContaining(['HealthResponse', 'PoolsResponse', 'PoolDetail', 'GapsResponse']),
    )
  })

  it.each(named)('%s is a type dto.ts exports', (name) => {
    expect(dto).toMatch(new RegExp(`^export (?:interface|type) ${name}\\b`, 'm'))
  })
})

/** DESIGN.md "Repository layout": each package path with the names of its "May import" cell. */
function mayImport(): Map<string, string[]> {
  const rows = read('DESIGN.md').matchAll(/^\| `((?:packages|apps)\/[\w-]+)` *\|(.*)\|\s*$/gm)
  return new Map(
    [...rows].map((m) => {
      const cells = (m[2] ?? '').split('|')
      const names = (cells.at(-1) ?? '').split(',').map((n) => n.replace(/`/g, '').trim())
      return [m[1] ?? '', names]
    }),
  )
}

const workspacePackages = ['packages', 'apps'].flatMap((dir) =>
  readdirSync(join(ROOT, dir))
    .map((name) => `${dir}/${name}`)
    .filter((path) => existsSync(join(ROOT, path, 'package.json'))),
)

describe('DESIGN.md: "May import" lists every dependency', () => {
  const allowed = mayImport()

  it('has a row for every workspace package', () => {
    expect(workspacePackages).toEqual(expect.arrayContaining(['packages/core', 'apps/api']))
    expect([...allowed.keys()].sort()).toEqual([...workspacePackages].sort())
  })

  it.each(workspacePackages)('%s: each package.json dependency is in its row', (path) => {
    const pkg = JSON.parse(read(`${path}/package.json`)) as {
      dependencies?: Record<string, string>
    }
    const names = allowed.get(path) ?? []
    const missing = Object.keys(pkg.dependencies ?? {}).filter((dep) => {
      const workspace = dep.match(/^@depthwatch\/(.+)$/)?.[1]
      if (workspace === undefined) return !names.includes(dep)
      return !names.includes(workspace) && !names.includes('every workspace package')
    })
    expect(missing).toEqual([])
  })
})

/**
 * Every document that states the pools search (`q`) gives core's rule
 * (packages/core/src/poolQuery.ts): a pasted pool id (`<dex>:<0x hex>`, also with `%3A` or as the
 * pool's link) lists the pools on that DEX whose address or v4 pool id starts with the hex; any
 * other text is terms split on separators, each matching a token or the pool, not a substring of
 * one field, and never the DEX, which `dex` filters; and `q` takes up to
 * `POOL_QUERY_MAX_LENGTH` characters.
 */
describe('the documents that state `q` give the search rule', () => {
  const stale = /`q` \((case-insensitive )?substring|q over token symbols|name or the DEX/

  it.each(['README.md', 'DESIGN.md', 'docs/design/web-v2.md', 'apps/api/src/agentDocs/AGENTS.md'])(
    '%s',
    (file) => {
      const text = read(file).replace(/\s+/g, ' ')
      expect(text.includes('`/`, `-`, `:` and `,`'), 'names the separators').toBe(true)
      expect(stale.exec(text)?.[0] ?? null).toBeNull()
      expect(text.includes('`<dex>:<0x hex>`'), 'states the pasted pool id').toBe(true)
      expect(text.includes('`%3A`'), 'accepts the id as a link carries it').toBe(true)
      expect(text.includes('starts with that hex'), 'matches the start of the key').toBe(true)
      expect(text.includes(`at most ${POOL_QUERY_MAX_LENGTH} characters`), 'states the cap').toBe(
        true,
      )
    },
  )

  it('openapi.json', () => {
    const spec = JSON.parse(read('apps/api/src/agentDocs/openapi.json')) as {
      paths: Record<
        string,
        {
          get: {
            parameters: { name?: string; description?: string; schema?: { maxLength?: number } }[]
          }
        }
      >
    }
    const q = spec.paths['/api/pools']?.get.parameters.find((p) => p.name === 'q')
    expect(q?.description).toContain('A pasted pool id, <dex>:<0x hex>')
    expect(q?.description).toContain('%3A')
    expect(q?.description).toContain('starts with that hex')
    expect(q?.description).toContain('split on spaces, /, -, : and commas')
    expect(q?.description).toContain('Terms never match the DEX')
    expect(q?.schema?.maxLength).toBe(POOL_QUERY_MAX_LENGTH)
  })
})
