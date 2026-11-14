/**
 * The form's quote is only ever the one for what the form shows: after Back, a refused review or a
 * finished swap the earlier quote is dimmed and Review waits for a new one; a quote of the other
 * direction, or of WETH where ETH is now chosen, is never drawn in this one's units; a screen
 * reader hears a quote once it is in, never a keystroke's; and the amount offered with a refusal
 * above the swap limit is one the checks accept, valued on both sides at the pool's price.
 * Hermetic: the fake wallet of testing/fakeWallet.ts.
 */
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  callTo,
  connect,
  enter,
  type Fake,
  holdRequest,
  pageText,
  renderPanel,
  review,
  SLIP_POOL,
  sqrtOf,
  UNISWAP,
  V3_POOL,
  wallet,
} from '../testing/tradeHarness.js'

afterEach(() => cleanup())

const field = () => screen.getByLabelText(/^You send/) as HTMLInputElement
const card = () => document.querySelector('.trade-quote') as HTMLElement
const reviewButton = () => screen.getByRole('button', { name: 'Review swap' })
const type = (text: string) => fireEvent.change(field(), { target: { value: text } })
const isQuoter = callTo(UNISWAP.quoter.toLowerCase())
/** What the quote card's and the amount field's live regions say, as one text. */
const spoken = () =>
  [...document.querySelectorAll('.trade-quote [aria-live], .trade-form [role="status"]')]
    .map((node) => node.textContent ?? '')
    .join(' | ')

/**
 * Counts each commit that turned Review on or off from now: a frame in which it was on, however
 * short, is a change of its `disabled` attribute (or a button that came in without it).
 */
function watchReview() {
  const changes: string[] = []
  const isReview = (node: Node): node is HTMLButtonElement =>
    node instanceof HTMLButtonElement && (node.textContent ?? '').includes('Review swap')
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && isReview(record.target))
        changes.push(record.oldValue === null ? 'was on' : 'turned on')
      for (const node of record.addedNodes)
        if (node instanceof HTMLElement)
          for (const button of [node, ...node.querySelectorAll('button')])
            if (isReview(button) && !button.hasAttribute('disabled')) changes.push('came in on')
    }
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['disabled'],
    attributeOldValue: true,
  })
  return () => {
    for (const record of observer.takeRecords())
      if (record.type === 'attributes' && isReview(record.target))
        changes.push(record.oldValue === null ? 'was on' : 'turned on')
    observer.disconnect()
    return changes
  }
}

/** Holds the form's quoter calls from the `n`th one on (1 = the next), until `release()`. */
function holdQuotesFrom(fake: Fake) {
  const inner = fake.provider.request.bind(fake.provider)
  let seen = 0
  let from = Number.POSITIVE_INFINITY
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  fake.provider.request = async (args: { method: string; params?: unknown }) => {
    if (isQuoter(args) && ++seen >= from) await gate
    return inner(args)
  }
  return {
    from: (n: number) => {
      from = seen + n
    },
    reached: () => seen >= from,
    release: () => release(),
  }
}

describe('the quote after the review', () => {
  it('dims the earlier quote after Back and keeps Review off until a new one is in', async () => {
    const fake = wallet()
    const quoter = holdRequest(fake, isQuoter)
    renderPanel(fake)
    await connect()
    await enter('0.1')
    await review()
    quoter.arm()
    const watched = watchReview()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { name: 'Your swap' })
    expect(screen.getByText('Updating the price…')).toBeTruthy()
    expect(card().className).toContain('is-updating')
    expect(card().getAttribute('aria-busy')).toBe('true')
    expect(card().textContent).not.toContain('and at least')
    expect(reviewButton()).toHaveProperty('disabled', true)
    await waitFor(() => expect(quoter.reached()).toBe(true))
    // Not for a single commit either.
    expect(watched()).toEqual([])
    quoter.release()
    await screen.findByText(/and at least/)
    expect(reviewButton()).toHaveProperty('disabled', false)
  })

  it('never shows the earlier quote as current beside a refused review', async () => {
    const fake = wallet()
    const quotes = holdQuotesFrom(fake)
    renderPanel(fake)
    await connect()
    await enter('0.1')
    // The review's own quote goes through; the form's quote after it is held.
    quotes.from(2)
    fake.state.quoteFactor = 0.9
    fireEvent.click(reviewButton())
    const watched = watchReview()
    await screen.findByText(/This swap would cost [^/]* against the pool’s price/)
    await waitFor(() => expect(quotes.reached()).toBe(true))
    expect(card().className).toContain('is-updating')
    expect(card().textContent).not.toContain('and at least')
    expect(reviewButton()).toHaveProperty('disabled', true)
    // The refusal lands after a wait, outside any click: not a single commit with Review on.
    expect(watched()).toEqual([])
    quotes.release()
  })
})

describe('a quote of other inputs', () => {
  it('is never drawn after the direction changes, even when typing comes first', async () => {
    const fake = wallet()
    const quoter = holdRequest(fake, isQuoter)
    renderPanel(fake)
    await connect()
    await enter('0.1')
    quoter.arm()
    fireEvent.click(screen.getByRole('radio', { name: 'Sell USDC' }))
    type('100')
    expect(await screen.findByText('Getting a live price from the pool…')).toBeTruthy()
    expect(card().querySelector('.tq-fig')?.textContent).toBe('—')
    expect(card().querySelector('.tq-rate')?.textContent).toBe('Rate —')
    expect(card().textContent).not.toMatch(/about \$|260,401/)
    quoter.release()
    expect(await screen.findByText(/^0\.02601\sETH$/)).toBeTruthy()
  })

  it('is never drawn in ETH once it was quoted in WETH', async () => {
    const fake = wallet()
    const quoter = holdRequest(fake, isQuoter)
    renderPanel(fake)
    await connect()
    await enter('0.1')
    quoter.arm()
    fireEvent.click(screen.getByRole('checkbox', { name: /Use ETH/ }))
    expect(await screen.findByText('Getting a live price from the pool…')).toBeTruthy()
    expect(card().querySelector('.tq-fig')?.textContent).toBe('—')
    quoter.release()
    await screen.findByText(/and at least/)
  })
})

describe('what a screen reader hears', () => {
  it('nothing from a keystroke or a slippage tap until the next quote is in', async () => {
    const fake = wallet()
    const quotes = holdQuotesFrom(fake)
    renderPanel(fake)
    await connect()
    await enter('0.1')
    const quoted = spoken()
    expect(quoted.replace(/\u00a0/g, ' ')).toContain(
      'Live price: you get about 384.0 USDC, at least 382.102 USDC. Total cost 0.06 %, about $0.23.',
    )
    quotes.from(1)
    type('0.2')
    expect(await screen.findByText('Updating the price…')).toBeTruthy()
    expect(spoken()).toBe(quoted)
    fireEvent.click(screen.getByRole('radio', { name: 'Slippage tolerance 1 percent' }))
    expect(spoken()).toBe(quoted)
    quotes.release()
    await screen.findByText(/^768\.0\sUSDC$/)
    expect(spoken()).not.toBe(quoted)
    expect(spoken()).toContain('768.0')
  })
})

describe('the amount offered within the swap limit', () => {
  it('is accepted when the pool’s price moved since the snapshot, and is below the amount typed', async () => {
    // The pool's price and the quoter 1.5 % above the snapshot's 3,842.15: the amount received
    // is worth more than the amount sent at snapshot prices.
    const moved = 1.015
    const fake = wallet({
      pools: [
        { ...V3_POOL, sqrtPriceX96: sqrtOf(3842.15 * moved, 18, 6) },
        { ...SLIP_POOL, sqrtPriceX96: sqrtOf(3842.4 * moved, 18, 6) },
      ],
    })
    fake.state.quoteFactor = moved
    renderPanel(fake)
    await connect()
    await screen.findByText(/Balance: 1 ETH/)
    for (const typed of ['0.2575', '0.5']) {
      type(typed)
      await screen.findByText(/Swaps are limited/)
      const offer = await screen.findByRole('button', { name: /^Use .* instead$/ })
      const offered = /^Use ([\d.]+)\sETH instead$/.exec(offer.textContent ?? '')?.[1]
      expect(Number(offered)).toBeLessThan(Number(typed))
      offer.focus()
      fireEvent.click(offer)
      expect(field().value).toBe(offered)
      // The amount that changed has the focus, not the page.
      expect(document.activeElement).toBe(field())
      await screen.findByText(/and at least/)
      expect(pageText()).not.toContain('Swaps are limited')
      expect(reviewButton()).toHaveProperty('disabled', false)
    }
  })
})
