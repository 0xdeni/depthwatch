/**
 * The panel's amounts and sentences: what the reader types becomes raw units exactly or not at
 * all, what they send is written with every digit, what they receive at least is rounded down,
 * never up; refusals, the price-move note, the network fee, the receipt's comparison with the
 * minimum and the cancel messages say what happened in plain words.
 */
import { describe, expect, it } from 'vitest'
import {
  APPROVAL_CANCELLED,
  approvalUsedText,
  bpsPercent,
  CANCELLED,
  DATA_FEE,
  exactAmount,
  failedStepText,
  floorAmount,
  inputAmount,
  lostTrackText,
  movedText,
  networkFeeText,
  overMinimumText,
  parseAmount,
  priceMovedText,
  refusalText,
  SWAP_CANCELLED,
  wholeUsd,
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
  it('words a gap to another live pool as the pool’s own price, not the amount’s', () => {
    const text = refusalText({
      kind: 'refuse',
      reason: 'live-deviation-above-max',
      value: 315,
      limit: 200,
    }).replace(/\u00a0/g, ' ')
    expect(text).toBe(
      'This pool’s price differs by 3.15 % from another live pool of the same pair; the limit is 2 %. Its price may be off right now, so it can’t be traded here. Try again later.',
    )
    expect(text).not.toMatch(/price you would get|smaller amount/)
  })

  it('words a gap to the snapshot as the pool’s live price against its snapshot price', () => {
    const text = refusalText({
      kind: 'refuse',
      reason: 'snapshot-deviation-above-max',
      value: 1_204,
      limit: 1_000,
    }).replace(/\u00a0/g, ' ')
    expect(text).toBe(
      'The pool’s live price is too far from its price in the latest snapshot (12.04 %); the limit is 10 %.',
    )
  })

  it('words the size cap in whole dollars', () => {
    expect(
      refusalText({ kind: 'refuse', reason: 'size-above-max', value: 3842.4, limit: 1000 }),
    ).toBe(
      'Swaps are limited to $1,000 each for now; this one is about $3,842. Try a smaller amount.',
    )
    expect(wholeUsd(12_345.5)).toBe('$12,346')
  })

  it('says a swap just over the size cap is over it, not "about" the cap itself', () => {
    for (const value of [1000.01, 1000.49]) {
      const text = refusalText({ kind: 'refuse', reason: 'size-above-max', value, limit: 1000 })
      expect(text, String(value)).toBe(
        'Swaps are limited to $1,000 each for now; this one is just over that. Try a smaller amount.',
      )
    }
    expect(
      refusalText({ kind: 'refuse', reason: 'size-above-max', value: 1004.99, limit: 1000 }),
    ).toContain('this one is about $1,005.')
  })

  it('words the impact limit as a cost with the fee included, and blames the fee only when it alone reaches the limit', () => {
    const decision = {
      kind: 'refuse',
      reason: 'price-impact-above-max',
      value: 612,
      limit: 500,
    } as const
    const plain = refusalText(decision).replace(/\u00a0/g, ' ')
    expect(plain).toBe(
      'This swap would cost 6.12 % against the pool’s price, its fee included; the limit is 5 %. Try a smaller amount.',
    )
    // A smaller amount brings the cost down towards the fee alone: under the 5 % limit, it helps,
    // even when the fee is most of the cost (1 %, 4 %, 4.99 %).
    for (const fee of [100, 400, 499])
      expect(refusalText(decision, fee), String(fee)).toBe(refusalText(decision))
    // A fee of 5 % or more keeps every amount over the limit.
    for (const fee of [500, 800]) {
      const text = refusalText({ ...decision, value: fee + 112 }, fee).replace(/\u00a0/g, ' ')
      expect(text, String(fee)).toContain(
        `The pool’s own fee alone is ${fee / 100} %, so a smaller amount would not bring it under the limit.`,
      )
      expect(text, String(fee)).not.toContain('Try a smaller amount')
    }
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

describe('the review and its steps', () => {
  it('says the price moved with the new and the reviewed minimum, and how much less', () => {
    const text = movedText(20_001_500n, 19_977_000n, 6, 'USDC').replace(/\u00a0/g, ' ')
    expect(text).toBe(
      'The price moved since you reviewed: you now receive at least 19.977 USDC (was 20.0015, 0.12 % less).',
    )
    expect(priceMovedText(null)).toBe('')
    expect(priceMovedText({ amount: '100 USDC' })).toBe(
      'Your approval of 100 USDC went through and still covers this swap.',
    )
  })

  it('writes the network fee in dollars, in ETH without a price, or leaves it to the wallet', () => {
    const wei = 120_000n * 5_000_000n // 120,000 gas at 0.005 gwei: 0.0000006 ETH
    const shown = [
      networkFeeText({ kind: 'reading' }),
      networkFeeText({ kind: 'estimate', wei, ethUsd: 3842 }),
      networkFeeText({ kind: 'estimate', wei: wei * 10_000n, ethUsd: 3842 }),
      networkFeeText({ kind: 'estimate', wei, ethUsd: null }).replace(/\u00a0/g, ' '),
      networkFeeText({ kind: 'wallet' }),
    ]
    expect(shown).toEqual([
      'Estimating\u2026',
      'Under $0.01',
      'About $23.05',
      'About 0.0000006 ETH',
      'In your wallet',
    ])
    // Each fits one line of the review's two columns on a phone, so the review holds still when
    // the estimate arrives; the data fee is said once, under the figures.
    for (const text of shown) expect(text.length, text).toBeLessThanOrEqual(19)
    expect(DATA_FEE).toBe(
      'Base also charges a small fee for the transaction\u2019s data; your wallet shows the total before you confirm.',
    )
  })

  it('says what an approval left on the receipt from the allowance read after the swap', () => {
    const usdc = { symbol: 'USDC', decimals: 6 }
    const text = (left: bigint | 'reading' | null) =>
      approvalUsedText('100 USDC', left, usdc).replace(/ /g, ' ')
    // Used up: only then does the receipt say the contract can't take more.
    expect(text(0n)).toBe(
      'Your approval of exactly 100 USDC was used by this swap, so the DEX contract can’t take more.',
    )
    // The wallet let the reader raise the amount: what is left, and how to remove it.
    expect(text(25_000_000n)).toBe(
      'The DEX contract can still use 25 USDC of yours from an approval; you can remove it in your wallet.',
    )
    expect(text(2n ** 256n - 1n)).toBe(
      'The DEX contract can still use any amount of your USDC from an approval; you can remove it in your wallet.',
    )
    // While it is read, or when it cannot be: only what Depthwatch asked for.
    for (const left of ['reading', null] as const) {
      expect(text(left)).toBe(
        'Depthwatch asked your wallet to approve exactly 100 USDC for this swap.',
      )
      expect(text(left)).not.toMatch(/can’t take more|used by this swap/)
    }
  })

  it('compares what was received with the reviewed minimum, rounded down', () => {
    expect(overMinimumText(20_123_456n, 20_000_000n)?.replace(/\u00a0/g, ' ')).toBe(
      '0.61 % more than your minimum',
    )
    expect(overMinimumText(20_000_000n, 20_000_000n)).toBe('exactly your minimum')
    expect(overMinimumText(20_000_001n, 20_000_000n)).toBe('just over your minimum')
    expect(overMinimumText(19_999_999n, 20_000_000n)).toBeNull()
  })

  it('says which request the reader cancelled, and what was sent', () => {
    const rejected = { approved: false, rejected: true, lost: false, hash: null }
    expect(failedStepText(new Error('x'), 'approval', rejected)).toBe(APPROVAL_CANCELLED)
    expect(APPROVAL_CANCELLED).toBe(
      'You cancelled the approval in your wallet, so nothing was sent.',
    )
    expect(failedStepText(new Error('x'), 'swap', rejected)).toBe(CANCELLED)
    expect(CANCELLED).toBe('You cancelled the swap in your wallet, so nothing was sent.')
    expect(failedStepText(new Error('x'), 'swap', { ...rejected, approved: true })).toBe(
      SWAP_CANCELLED,
    )
  })
})
