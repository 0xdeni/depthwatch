/**
 * The client of the app while it boots (ST1, docs/design/visual-v3.md §5.12): the shell and the
 * route's skeleton render at once, and every call waits for the real client (the HTTP client
 * once `/api/health` answered, the mock when it did not, or the static bundle's). Answers land in
 * the same query cache the booted app keeps, so nothing is fetched twice.
 */
import type { ApiClient } from './types.js'

/** No loading UI for answers under 300 ms (M10): the shell renders only after this long. */
export const BOOT_SHELL_MS = 300

export function createPendingClient(ready: Promise<ApiClient>): ApiClient {
  return {
    health: () => ready.then((c) => c.health()),
    stats: () => ready.then((c) => c.stats()),
    pools: (query) => ready.then((c) => c.pools(query)),
    pool: (id) => ready.then((c) => c.pool(id)),
    history: (id, window) => ready.then((c) => c.history(id, window)),
    gaps: (query) => ready.then((c) => c.gaps(query)),
    token: (address, query) => ready.then((c) => c.token(address, query)),
    scorecards: (query) => ready.then((c) => c.scorecards(query)),
    scorecard: (id) => ready.then((c) => c.scorecard(id)),
    scorecardSamples: (id, query) => ready.then((c) => c.scorecardSamples(id, query)),
    badge: (id) => ready.then((c) => c.badge(id)),
    stocks: () => ready.then((c) => c.stocks()),
    stock: (address) => ready.then((c) => c.stock(address)),
  }
}
