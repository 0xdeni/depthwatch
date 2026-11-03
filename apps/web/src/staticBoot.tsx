/**
 * Startup of the static build (`VITE_STATIC=1`, docs/design/web-v2.md §4): load the exported
 * bundle from `./data/bundle.json`, then render the app on a `HashRouter` with the static client.
 * The demo banner shows when the bundle is the synthetic demo world (`source: 'demo'`), and
 * relative times are then taken against the bundle's `generatedAt` instead of the browser clock.
 * A `live` bundle is a snapshot of Base mainnet that never updates: the top line says so with its
 * UTC time and the exporter's note, and every time on the page is absolute (`snapshotOf`).
 * A bundle that takes longer than 300 ms gets the shell and the route's skeleton meanwhile, on a
 * pending client (ST1); a bundle that fails replaces the page with the reason.
 */
import { parseTradeFlags } from '@depthwatch/core'
import { StrictMode } from 'react'
import type { Root } from 'react-dom/client'
import { App } from './App.js'
import { errorText } from './api/errors.js'
import { BOOT_SHELL_MS, createPendingClient } from './api/pending.js'
import {
  createStaticClient,
  loadStaticBundle,
  STATIC_BUNDLE_URL,
  snapshotOf,
} from './api/static.js'
import type { StaticBundle } from './api/types.js'
import { RootErrorBoundary } from './components/ErrorBoundary.js'

/** Shown when the bundle cannot be fetched or is not a v1 bundle. */
export function BundleError({ error }: { error: unknown }) {
  return (
    <div className="container">
      <div className="state state-error" role="alert">
        <span>
          Could not load the data bundle ({STATIC_BUNDLE_URL}): {errorText(error)}. This static copy
          of Depthwatch reads it from next to index.html, so open the site over http(s), not from
          the file system.
        </span>
      </div>
    </div>
  )
}

export async function startStatic(
  root: Root,
  load: () => Promise<StaticBundle> = () => loadStaticBundle(),
  shellAfter: number = BOOT_SHELL_MS,
): Promise<void> {
  const ready = load()
  const shell = setTimeout(() => {
    const client = ready.then(createStaticClient)
    // Only the page's own queries read it; a failed bundle is reported below, not by them.
    client.catch(() => undefined)
    root.render(
      <StrictMode>
        <RootErrorBoundary>
          <App client={createPendingClient(client)} mock={false} staticBuild connecting />
        </RootErrorBoundary>
      </StrictMode>,
    )
  }, shellAfter)
  let bundle: StaticBundle
  try {
    bundle = await ready
  } catch (error) {
    clearTimeout(shell)
    root.render(<BundleError error={error} />)
    return
  }
  clearTimeout(shell)
  const demo = bundle.source === 'demo'
  root.render(
    <StrictMode>
      <RootErrorBoundary>
        <App
          client={createStaticClient(bundle)}
          mock={false}
          demo={demo}
          // The demo world is frozen at export time: ages are taken against it, so a published
          // demo never reads "updated 60d ago". A live bundle is a dated snapshot instead: its
          // times are absolute, since how long after the export the page is read is unknown.
          dataNow={demo ? bundle.generatedAt : undefined}
          snapshot={snapshotOf(bundle)}
          // The trade switch at load, failing closed: a missing or malformed block is off.
          trade={parseTradeFlags(bundle.features?.trade)}
          staticBuild
        />
      </RootErrorBoundary>
    </StrictMode>,
  )
}
