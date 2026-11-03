import type { TradeFlags } from '@depthwatch/core'
import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'
import { SNAPSHOT_CLOCK } from '../lib/format.js'
import type { StaticSnapshot } from './static.js'
import type { ApiClient } from './types.js'

export interface ApiContextValue {
  client: ApiClient
  /** True when data comes from the in-repo mock (`VITE_MOCK=1`, or the dev server with no API). */
  mock: boolean
  /**
   * True when the data is the synthetic demo world (`source: 'demo'` from `/api/health` or the
   * static bundle): the demo banner shows and the footer names the synthetic world as the source.
   */
  demo?: boolean
  /**
   * Unix seconds of the data's own clock, for "… ago" texts. The synthetic demo world is frozen
   * at one moment, so its ages are taken against that moment instead of the browser clock (else a
   * fresh demo reads "updated 60d ago"). Undefined means the wall clock (live data).
   */
  dataNow?: number
  /**
   * True in the static build (`VITE_STATIC=1`): the data is a bundle served next to the site and
   * there is no server, so nothing can be fetched from `/api` (e.g. embeddable badge URLs).
   */
  staticBuild?: boolean
  /**
   * Set when the static build shows a `live` bundle: a snapshot of Base mainnet that never
   * updates. The top line and the freshness slot give its absolute time, the footer names the
   * snapshot, and every relative time reads as an absolute UTC time (`SNAPSHOT_CLOCK`).
   */
  snapshot?: StaticSnapshot
  /**
   * True while the app boots on the pending client (`api/pending.ts`): which data the page will
   * show is not known yet, and the header's freshness slot reads "Connecting…".
   */
  connecting?: boolean
  /**
   * The trade switch as the static bundle carried it at load (`features.trade`, read with core's
   * `parseTradeFlags`): null when absent or malformed, undefined outside the static build. Only a
   * block that is on shows the swap panel; the panel reads `data/flags.json` again before every
   * signature request (`trade/liveFlags.ts`).
   */
  trade?: TradeFlags | null
}

const ApiContext = createContext<ApiContextValue | null>(null)

export function ApiProvider({
  client,
  mock,
  demo = false,
  dataNow,
  staticBuild = false,
  snapshot,
  connecting = false,
  trade,
  children,
}: ApiContextValue & { children: ReactNode }) {
  return (
    <ApiContext.Provider
      value={{ client, mock, demo, dataNow, staticBuild, snapshot, connecting, trade }}
    >
      {children}
    </ApiContext.Provider>
  )
}

export function useApiContext(): ApiContextValue {
  const value = useContext(ApiContext)
  if (!value) throw new Error('useApiContext must be used inside <ApiProvider>')
  return value
}

export function useApi(): ApiClient {
  return useApiContext().client
}

export function useIsMock(): boolean {
  return useApiContext().mock
}

export function useIsDemo(): boolean {
  return useApiContext().demo === true
}

export function useIsStatic(): boolean {
  return useApiContext().staticBuild === true
}

/** The published live snapshot of the static build, or undefined (server, mock or demo data). */
export function useSnapshot(): StaticSnapshot | undefined {
  return useContext(ApiContext)?.snapshot
}

/** The trade switch read at load, or null (off, absent, malformed, or not a static build). */
export function useTradeFlagsAtLoad(): TradeFlags | null {
  return useContext(ApiContext)?.trade ?? null
}

export function useIsConnecting(): boolean {
  return useContext(ApiContext)?.connecting === true
}

/**
 * "Now" for relative times, in unix seconds: `SNAPSHOT_CLOCK` for a published live snapshot (its
 * times read as absolute), the demo world's frozen clock when there is one, else the wall clock.
 * Outside an `ApiProvider` (isolated component tests) it is the wall clock.
 */
export function useDataNow(): number {
  const ctx = useContext(ApiContext)
  if (ctx?.snapshot) return SNAPSHOT_CLOCK
  return ctx?.dataNow ?? Date.now() / 1000
}
