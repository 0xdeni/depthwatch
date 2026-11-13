/**
 * The entry of the swap panel's lazy chunk (DESIGN.md, "Dashboard (apps/web)"): the panel and the
 * wallet discovery it starts with, loaded by one dynamic import. Keeping both behind one entry
 * keeps wallet code out of the boot chunks while the page warms the panel and the discovery on
 * intent (`tradeIntent.ts`). Only `tradeIntent.ts` imports this module, and only dynamically.
 */
export { default as TradePanel } from '../../trade/TradePanel.js'
export { discoverWallets } from '../../trade/wallets.js'
