/**
 * The panel's amounts: what the reader types becomes raw units exactly or not at all, what they
 * send is written with every digit, what they receive at least is rounded down, never up.
 */
import { describe, expect, it } from 'vitest'
import {
  bpsPercent,
  exactAmount,
  floorAmount,
  inputAmount,
  lostTrackText,
  parseAmount,
  refusalText,
} from './text.js'

describe('parseAmount', () => {
  it('reads decimals into raw units exactly', () => {
    expect(parseAmount('100', 6)).toBe(100_000_000n)
    expect(parseAmount('1,250.5', 6)).toBe(1_250_500_000n)
    expect(parseAmount('.5', 18)).toBe(500_000_000_000_000_000n)
    expect(parseAmount('0.000001', 6)).toBe(1n)
    expect(parseAmount(' 2. ', 6)).toBe(2_000_000n)
  })

  it('refuses what is not a plain decimal, or has more decimals than the token', () => {
    for (const text of ['', '.', '-1', '1e3', '0x10', '1.2.3', 'abc', '0.0000001'])
      expect(parseAmount(text, 6), text).toBeNull()
  })

  it('reads a comma as a thousands separator only where it cannot be a decimal comma', () => {
    expect(parseAmount('1,250,000', 6)).toBe(1_250_000_000_000n)
    expect(parseAmount('12,500.75', 6)).toBe(12_500_750_000n)
    // "1,250" could be either, so it is refused rather than read 1,000x too large or too small.
    for (const text of ['1,2,3', '1,250', '12,500', '1.250,5'])
      expect(parseAmount(text, 18), text).toBeNull()
    for (const text of ['1,25.0', '01,250.5', '1,2500.5', '1,,250.5'])
      expect(parseAmount(text, 6), text).toBeNull()
  })

  it('reads the decimal comma of a comma-decimal keypad, which has no dot', () => {
    expect(parseAmount('0,5', 18)).toBe(500_000_000_000_000_000n)
    expect(parseAmount('0,05', 18)).toBe(50_000_000_000_000_000n)
    expect(parseAmount('12,25', 6)).toBe(12_250_000n)
    // A thousands group cannot start with 0, so this is a decimal.
    expect(parseAmount('0,125', 6)).toBe(125_000n)
    expect(parseAmount(',5', 6)).toBe(500_000n)
    expect(parseAmount('0,0000001', 6)).toBeNull()
  })
})

describe('writing amounts', () => {
  it('writes every digit of what is sent, grouped', () => {
    expect(exactAmount(1_250_500_000n, 6)).toBe('1,250.5')
    expect(exactAmount(1n, 18)).toBe('0.000000000000000001')
    expect(exactAmount(0n, 6)).toBe('0')
    expect(inputAmount(999_500_000_000_000_000n, 18)).toBe('0.9995')
  })

  it('rounds the minimum down to 6 significant digits', () => {
    expect(floorAmount(382_102_239n, 6)).toBe('382.102')
    expect(floorAmount(25_884_999_999_999_999n, 18)).toBe('0.0258849')
    expect(floorAmount(999_999_999n, 6)).toBe('999.999')
    expect(floorAmount(12n, 6)).toBe('0.000012')
  })

  it('writes basis points as a percentage', () => {
    const shown = [bpsPercent(50), bpsPercent(10), bpsPercent(300), bpsPercent(125)]
    expect(shown.map((text) => text.replace('\u00a0', ' '))).toEqual([
      '0.5 %',
      '0.1 %',
      '3 %',
      '1.25 %',
    ])
  })
})

describe('refusalText', () => {
  it('words a gap to another live pool as the cost of this amount, with what to try', () => {
    const text = refusalText({
      kind: 'refuse',
      reason: 'live-deviation-above-max',
      value: 315,
      limit: 200,
    }).replace(/\u00a0/g, ' ')
    expect(text).toBe(
      'At this amount, the price you would get, with the pool fee and price impact, differs by 3.15 % from another live pool of the same pair; the limit is 2 %. Try a smaller amount.',
    )
  })

  it('words the size cap and the impact limit with their figures', () => {
    expect(
      refusalText({ kind: 'refuse', reason: 'size-above-max', value: 3842, limit: 1000 }),
    ).toBe('Swaps are limited to $1K each for now; this one is about $3.84K. Try a smaller amount.')
    expect(
      refusalText({ kind: 'refuse', reason: 'price-impact-above-max', value: 612, limit: 500 }),
    ).toContain('(6.12\u00a0%)')
  })

  it('says a swap just over the size cap is over it, not "about" the cap itself', () => {
    for (const value of [1000.01, 1000.5, 1004.99]) {
      const text = refusalText({ kind: 'refuse', reason: 'size-above-max', value, limit: 1000 })
      expect(text, String(value)).toBe(
        'Swaps are limited to $1K each for now; this one is just over that. Try a smaller amount.',
      )
    }
    expect(
      refusalText({ kind: 'refuse', reason: 'size-above-max', value: 1006, limit: 1000 }),
    ).toContain('this one is about $1.01K.')
  })
})

describe('lostTrackText', () => {
  it('never says "not sent", and writes one period after the error', () => {
    expect(lostTrackText('swap', 'An internal error was received.', true)).toBe(
      'Depthwatch lost track of the swap: An internal error was received. Check it on Basescan.',
    )
    const bundle = lostTrackText('approval', 'Request exceeds defined limit.', false)
    expect(bundle).toBe(
      'Your wallet took the approval, but Depthwatch lost track of it: Request exceeds defined limit. It may still go through; check your wallet’s activity before you try again.',
    )
    expect(bundle).not.toMatch(/not sent|\.\./)
  })
})
