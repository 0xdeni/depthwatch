import { Hono } from 'hono'
import type { ApiContext } from '../context.js'
import type { ErrorResponse, TokenDetail } from '../dto.js'
import { INVALID_ADDRESS, parseAddress, parseQuery, tokenQuerySchema } from '../query.js'
import { toPoolSummary } from '../summary.js'
import { labelToken } from '../tokenLabels.js'

const TOKEN_NOT_FOUND: ErrorResponse = { error: 'token not found' }

/**
 * `GET /api/tokens/:address`: token info, derived USD price and the scored pools containing the
 * token (sorted like `/api/pools`, default deepest first), with the token's ±2 % depth summed over
 * all of them whatever the page. The address is lowercased first and matched exactly against
 * token0/token1 (the `token` filter), never against symbols; the token's `label` names it apart
 * from other tokens with its symbol, whether or not it has a scored pool itself.
 */
export function tokensRoutes(ctx: ApiContext): Hono {
  const app = new Hono()
  app.get('/:address', (c) => {
    const address = parseAddress(c.req.param('address'))
    if (!address) return c.json(INVALID_ADDRESS, 400)
    const parsed = parseQuery(tokenQuerySchema, c.req.query())
    if (!parsed.ok) return c.json(parsed.error, 400)
    const token = ctx.db.tokens.get(address)
    if (!token) return c.json(TOKEN_NOT_FOUND, 404)

    const q = parsed.data
    const price = ctx.db.prices.get(address)
    const scored = ctx.db.scores.topBy(q.sort, {
      dir: q.dir,
      token: address,
      limit: q.limit,
      offset: q.offset,
    })
    const shared = ctx.db.tokens.sharedSymbols()
    const body: TokenDetail = {
      token: labelToken(token, shared),
      usd: price?.usd ?? null,
      via: price?.via ?? [],
      priceUpdatedAt: price?.updatedAt ?? null,
      pools: scored.items.map((row) => toPoolSummary(row, shared)),
      total: scored.total,
      poolCount: ctx.db.pools.count({ token: address }),
      ...ctx.db.scores.tokenDepth(address),
    }
    return c.json(body)
  })
  return app
}
