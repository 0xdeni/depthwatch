/**
 * Swap checks for the dashboard's single-pool exact-input swap (docs/METRICS.md, "Swap checks"):
 * minimum output, slippage, deadline, price impact, deviation from reference prices, the USD size
 * cap and the one decision that combines them; and the readers of the trade switch (flags.ts).
 * Pure: no I/O, no clock.
 */

export * from './decision.js'
export * from './flags.js'
export * from './limits.js'
export * from './prices.js'
export * from './size.js'
