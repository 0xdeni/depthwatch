/**
 * The trade switch as served now: `./data/flags.json`, next to the bundle, fetched with
 * `cache: 'no-store'` (and served `Cache-Control: no-store`, `public/_headers`) when the panel
 * connects and before every signature request, so that a switch turned off reaches tabs that are
 * already open. Read with core's `parseFlagsFile`: anything but
 * exactly `{ "trade": … }` is off.
 */
import { parseFlagsFile, type TradeFlags } from '@depthwatch/core'

/** Relative to `index.html`, like `STATIC_BUNDLE_URL`. */
export const TRADE_FLAGS_URL = './data/flags.json'

export async function fetchLiveFlags(fetcher: typeof fetch = fetch): Promise<TradeFlags | null> {
  const response = await fetcher(TRADE_FLAGS_URL, { cache: 'no-store' })
  if (!response.ok) return null
  return parseFlagsFile(await response.json())
}
