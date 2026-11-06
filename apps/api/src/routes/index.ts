import { Hono } from 'hono'
import type { ApiContext } from '../context.js'
import { gapsRoutes } from './gaps.js'
import { healthRoutes } from './health.js'
import { mmRoutes } from './mm.js'
import { poolsRoutes } from './pools.js'
import { statsRoutes } from './stats.js'
import { stocksRoutes } from './stocks.js'
import { tokensRoutes } from './tokens.js'

/** Everything under `/api`. */
export function createApiRouter(ctx: ApiContext): Hono {
  const api = new Hono()
  api.route('/health', healthRoutes(ctx))
  api.route('/stats', statsRoutes(ctx))
  api.route('/pools', poolsRoutes(ctx))
  api.route('/gaps', gapsRoutes(ctx))
  api.route('/tokens', tokensRoutes(ctx))
  api.route('/stocks', stocksRoutes(ctx))
  api.route('/mm', mmRoutes(ctx))
  return api
}
