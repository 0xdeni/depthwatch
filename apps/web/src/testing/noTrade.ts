/**
 * Test helper for the stock surfaces (docs/design/stocks-api.md §3): no link or button offers a
 * buy, a trade or a swap, and none points at a swap interface (a DEX's own pool ids, such as
 * `uniswap-v3:0x…`, name a venue, not a swap). Page text may name trading (the
 * eligibility line says Depthwatch "does not offer, route or recommend trades"); a control may not.
 */
import { expect } from 'vitest'

export function expectNoTradeControls(root: ParentNode = document.body): void {
  const controls = [...root.querySelectorAll('a, button, [role="button"]')]
  expect(controls.length).toBeGreaterThan(0)
  for (const el of controls) {
    const name = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`
    expect(name, name).not.toMatch(/\b(buy|trade|trading|swap)\b/i)
    expect(el.getAttribute('href') ?? '', name).not.toMatch(
      /\b(swap|trade)\b|app\.uniswap\.org|aerodrome\.finance/i,
    )
  }
}
