import type { TradeFlags } from '@depthwatch/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom'
import { ApiProvider } from './api/context.js'
import { ApiError } from './api/errors.js'
import type { StaticSnapshot } from './api/static.js'
import type { ApiClient } from './api/types.js'
import { Layout } from './components/Layout.js'
import { Gaps } from './pages/Gaps.js'
import { Home } from './pages/Home.js'
import { Methodology } from './pages/Methodology.js'
import { NotFound } from './pages/NotFound.js'
import { PoolDetail } from './pages/PoolDetail.js'
import { Pools } from './pages/Pools.js'
import { Scorecard } from './pages/Scorecard.js'
import { Scorecards } from './pages/Scorecards.js'
import { Token } from './pages/Token.js'

/**
 * One retry for failures that may pass on a second try (network, 5xx). An API 4xx answer (a pool,
 * token or mandate that does not exist, a rejected parameter) is final, so its state shows at once.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
  return failureCount < 1
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: false,
      },
    },
  })
}

export interface ProvidersProps {
  client: ApiClient
  mock: boolean
  /** The data is the synthetic demo world (`source: 'demo'` from the API or the bundle). */
  demo?: boolean
  /** The demo world's clock (unix seconds) for "… ago" texts; undefined = wall clock. */
  dataNow?: number
  /** The static build: data from a bundle, no server behind the page. */
  staticBuild?: boolean
  /** A static build of a `live` bundle: a snapshot that never updates (`api/context.tsx`). */
  snapshot?: StaticSnapshot
  /** Booting on the pending client (`api/pending.ts`): the header reads "Connecting…". */
  connecting?: boolean
  /** The static bundle's trade switch at load (`api/context.tsx`). */
  trade?: TradeFlags | null
  queryClient?: QueryClient
  children: ReactNode
}

export function Providers({
  client,
  mock,
  demo = false,
  dataNow,
  staticBuild = false,
  snapshot,
  connecting = false,
  trade,
  queryClient,
  children,
}: ProvidersProps) {
  const [qc] = useState(() => queryClient ?? createQueryClient())
  return (
    <QueryClientProvider client={qc}>
      <ApiProvider
        client={client}
        mock={mock}
        demo={demo}
        dataNow={dataNow}
        staticBuild={staticBuild}
        snapshot={snapshot}
        connecting={connecting}
        trade={trade}
      >
        {children}
      </ApiProvider>
    </QueryClientProvider>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/pools" element={<Pools />} />
        <Route path="/pools/:id" element={<PoolDetail />} />
        <Route path="/gaps" element={<Gaps />} />
        <Route path="/tokens/:address" element={<Token />} />
        <Route path="/mm" element={<Scorecards />} />
        <Route path="/mm/:id" element={<Scorecard />} />
        <Route path="/methodology" element={<Methodology />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export interface AppProps {
  client: ApiClient
  mock: boolean
  demo?: boolean
  dataNow?: number
  /**
   * The static build (`VITE_STATIC=1`): routes live in the URL hash (`#/pools`), so the site works
   * from any directory of any static host without rewrites.
   */
  staticBuild?: boolean
  /** The static build shows a `live` bundle: a snapshot of Base mainnet that never updates. */
  snapshot?: StaticSnapshot
  /**
   * The API (or the static bundle) has not answered yet: the shell and the route's skeleton
   * render on a pending client, and re-rendering with the real client keeps the query cache.
   */
  connecting?: boolean
  /**
   * The static bundle's trade switch (`features.trade` through core's `parseTradeFlags`): null
   * when absent or malformed. Only the static build passes it.
   */
  trade?: TradeFlags | null
}

export function App({
  client,
  mock,
  demo = false,
  dataNow,
  staticBuild = false,
  snapshot,
  connecting = false,
  trade,
}: AppProps) {
  const Router = staticBuild ? HashRouter : BrowserRouter
  return (
    <Providers
      client={client}
      mock={mock}
      demo={demo}
      dataNow={dataNow}
      staticBuild={staticBuild}
      snapshot={snapshot}
      connecting={connecting}
      trade={trade}
    >
      <Router>
        <AppRoutes />
      </Router>
    </Providers>
  )
}
