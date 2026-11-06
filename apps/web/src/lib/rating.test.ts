import { describe, expect, it } from 'vitest'
import { NB } from './format.js'
import { NOT_RATED, unratedDetail, unratedShort } from './rating.js'

const REASONS = ['thin', 'one-sided', 'unpriced', 'hooked', 'transfers-paused'] as const

describe('why a pool has no grade, in plain words', () => {
  it('names the reason in the words the chip uses', () => {
    expect(NOT_RATED).toBe('Not rated')
    expect(unratedShort('thin')).toBe('Too thin to rate')
    expect(unratedShort('one-sided')).toBe('Too thin on one side')
    expect(unratedShort('unpriced')).toBe('No USD price')
    expect(unratedShort('hooked')).toBe('Hooked pool')
    expect(unratedShort('transfers-paused')).toBe('Transfers paused')
    expect(unratedShort(null)).toBe('Not rated yet')
  })

  it('explains each reason in one line that starts with the short one', () => {
    expect(unratedDetail('thin')).toBe(`Too thin to rate: neither side holds $5K within 2${NB}%.`)
    expect(unratedDetail('one-sided')).toBe(
      `Too thin on one side: the thinner side holds under $5K within 2${NB}%.`,
    )
    expect(unratedDetail('unpriced')).toBe(
      'No USD price: a token in this pool has no price in dollars.',
    )
    expect(unratedDetail('hooked')).toBe(
      'Hooked pool: it runs a swap hook Depthwatch does not model; depth is not computed.',
    )
    expect(unratedDetail('transfers-paused')).toBe(
      'Transfers paused: the stock’s transfers are paused, so this pool’s depth cannot be used.',
    )
    expect(unratedDetail(null)).toBe('Not rated yet: the score is being refreshed.')
    for (const reason of REASONS) {
      expect(unratedDetail(reason).startsWith(unratedShort(reason))).toBe(true)
    }
  })

  it('keeps each line within the 15 words of a section takeaway (CP10)', () => {
    for (const reason of [...REASONS, null]) {
      expect(unratedDetail(reason).split(/\s+/).length).toBeLessThanOrEqual(15)
    }
  })
})
