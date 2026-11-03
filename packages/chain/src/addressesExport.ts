/**
 * `@depthwatch/chain/addresses`: the browser-safe part of the package. The Base addresses, the
 * trade routes and token allowlist (addresses.ts) and the trade ABIs (abi/trade.ts), with no viem
 * client, no transport and no `node:` import. The package barrel pulls `node:crypto` through
 * transport/key.ts, so a browser bundle imports this subpath instead; addressesExport.test.ts walks
 * its module graph.
 */
export * from './abi/trade.js'
export * from './addresses.js'
