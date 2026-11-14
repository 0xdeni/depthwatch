/**
 * The swap form while the reader types: one quote card whose lines never come and go (the last
 * quote stays, its figures dimmed, while the next loads), the amount's problem said by cause once
 * typing pauses, in a status tied to the field and never as an alert, the balance at 6 significant
 * digits, the value sent at snapshot prices and the rate, Max inside the field and the swap limit
 * beside its label, the amount within the limit offered with the refusal, the slippage note, the
 * ETH box on each side and Review's reason. Hermetic: the fake wallet of testing/fakeWallet.ts.
 */
import { join } from 'node:path'
import { TOKENS } from '@depthwatch/chain/addresses'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { read, SRC } from '../styles/cssRules.js'
import {
  callTo,
  connect,
  detail,
  enter,
  holdRequest,
  ON,
  pageText,
  renderPanel,
  UNISWAP,
  wallet,
} from '../testing/tradeHarness.js'
import { amountProblem, balanceText, capAmount, fieldText, slippageNote } from './AmountField.js'
import type { TradeEnv } from './flow.js'
import { SwapForm, type SwapFormProps } from './SwapForm.js'

afterEach(() => cleanup())

const field = () => screen.getByLabelText(/^You send/) as HTMLInputElement
const card = () => document.querySelector('.trade-quote') as HTMLElement
const text = (selector: string) =>
  (card().querySelector(selector)?.textContent ?? '').replace(/ /g, ' ')
/** The card's lines: each paragraph's role in it and every figure's label. */
const lines = () => [
  ...[...card().querySelectorAll('.tq-main > p')].map((p) => p.className),
  ...[...card().querySelectorAll('dt')].map((dt) => dt.textContent),
]
const type = (value: string) => fireEvent.change(field(), { target: { value } })

describe('the quote card holds still', () => {
  it('draws the same lines before an amount, while the price loads, with a quote and while it updates', async () => {
    const fake = wallet()
    const quoter = holdRequest(fake, callTo(UNISWAP.quoter.toLowerCase()))
    renderPanel(fake)
    await connect()
    const box = card()
    const shape = lines()
    expect(shape).toEqual([
      'tq-lead',
      'tq-out tq-dim',
      'tq-min',
      'tq-rate small muted',
      'Total cost, pool fee included',
      'of which pool fee',
      'of which price move',
      'Slippage tolerance',
      'Live price at',
    ])
    expect(box.textContent).toContain('Enter an amount to get a live price.')
    expect(text('.tq-rate')).toBe('Rate —')

    await enter('0.1')
    expect(box.textContent).toContain('384.0')
    expect(text('.tq-rate')).toBe('1 ETH = 3,840.23 USDC, fee included')
    quoter.arm()
    type('0.2')
    expect(await screen.findByText('Updating the price…')).toBeTruthy()
    // The last quote stays in the same card with the same lines; only its figures dim, never a
    // --text-2 line (dimmed, those would fall under 4.5:1).
    expect(card()).toBe(box)
    expect(box.className).toContain('is-updating')
    expect(box.getAttribute('aria-busy')).toBe('true')
    expect(box.textContent).toContain('384.0')
    expect(lines()).toEqual(shape)
    expect(box.querySelectorAll('.tq-dim').length).toBeGreaterThan(0)
    expect(box.querySelector('.tq-dim .tq-sub, .tq-dim dt, .tq-rate.tq-dim, dt.tq-dim')).toBeNull()
    quoter.release()
    expect(await screen.findByText(/^768\.0\sUSDC$/)).toBeTruthy()
    expect(box.className).not.toContain('is-updating')
    expect(box.getAttribute('aria-busy')).toBe('false')
    expect(lines()).toEqual(shape)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the first price loading in the same card, and a failed quote there too', async () => {
    const fake = wallet()
    const quoter = holdRequest(fake, callTo(UNISWAP.quoter.toLowerCase()))
    renderPanel(fake)
    await connect()
    const shape = lines()
    quoter.arm()
    type('0.1')
    expect(await screen.findByText('Getting a live price from the pool…')).toBeTruthy()
    expect(card().getAttribute('aria-busy')).toBe('true')
    expect(lines()).toEqual(shape)
    fake.state.failFee = true
    quoter.release()
    const error = await screen.findByText('The pool did not return a price. Try again in a moment.')
    expect(error.getAttribute('role')).toBe('status')
    expect(card().contains(error)).toBe(true)
    expect(lines()).toEqual(shape)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads the rate the other way round when one unit sent buys less than one', async () => {
    renderPanel(wallet())
    await connect()
    await enter('100', 'USDC')
    expect(text('.tq-rate')).toBe('1 ETH = 3,844.07 USDC, fee included')
  })

  it('says the network fee is not in the total cost', async () => {
    renderPanel(wallet())
    await connect()
    await enter('0.1')
    expect(pageText()).toContain('The network fee is extra.')
  })
})

describe('the amount field', () => {
  it('says why a text is not an amount, by cause, in a status the field points to', async () => {
    renderPanel(wallet())
    await connect()
    type('1,250')
    const said = await screen.findByText('Unclear: write 1.25 or 1250.')
    expect(said.getAttribute('role')).toBe('status')
    expect(field().getAttribute('aria-describedby')?.split(' ')[0]).toBe(said.id)
    expect(field().getAttribute('aria-invalid')).toBe('true')
    // The card's own sentence gives way to the field's.
    expect(card().textContent).not.toContain('Enter an amount')
    type('abc')
    expect(await screen.findByText('Enter a number, such as 0.5.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Sell USDC' }))
    type('0.1234567')
    expect(await screen.findByText('USDC allows at most 6 decimals.')).toBeTruthy()
    type('9000')
    expect(await screen.findByText('That is more than your balance.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says nothing, in the field or the card, while the reader is still typing', () => {
    const props = formProps({ amountText: '1,250', parsed: null, settled: false })
    const { rerender } = render(<SwapForm {...props} />)
    expect(pageText()).not.toContain('Unclear')
    expect(field().getAttribute('aria-invalid')).toBeNull()
    expect(card().textContent).toContain('Enter an amount to get a live price.')
    rerender(<SwapForm {...props} settled />)
    expect(pageText()).toContain('Unclear: write 1.25 or 1250.')
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(card().textContent).not.toContain('Enter an amount')
  })

  it('reads every cause of a refused amount apart', () => {
    expect(amountProblem('0.5', 18, 'ETH')).toBeNull()
    expect(amountProblem('', 18, 'ETH')).toBeNull()
    expect(amountProblem('0,5', 6, 'USDC')).toBeNull()
    expect(amountProblem('1,250.5', 6, 'USDC')).toBeNull()
    expect(amountProblem('0.0000001', 6, 'USDC')).toBe('USDC allows at most 6 decimals.')
    expect(amountProblem('0.001', 2, 'XY')).toBe('XY allows at most 2 decimals.')
    expect(amountProblem('12,500', 6, 'USDC')).toBe('Unclear: write 12.5 or 12500.')
    expect(amountProblem('1,000', 6, 'USDC')).toBe('Unclear: write 1 or 1000.')
    expect(amountProblem('1.2.3', 6, 'USDC')).toBe('Enter a number, such as 0.5.')
    expect(amountProblem('-1', 6, 'USDC')).toBe('Enter a number, such as 0.5.')
  })

  it('shows the balance at 6 significant digits, and the value sent, never one received', async () => {
    renderPanel(wallet({ ethBalance: 1_883_797_759_828_579_704n }))
    await connect()
    expect(
      await screen.findByText('Balance: 1.88379 ETH (Max keeps 0.0005 ETH for network fees)'),
    ).toBeTruthy()
    await enter('0.1')
    const sent = () => (document.querySelector('.trade-field-msg')?.textContent ?? '').trim()
    expect(sent().replace(/ /g, ' ')).toBe('≈ $384 at snapshot prices')
    // Valued at another token's snapshot price, the amount received would read as a loss the
    // total cost does not have.
    expect(card().textContent).not.toContain('≈')
    // Under $100, cents.
    await enter('0.005')
    expect(sent().replace(/ /g, ' ')).toBe('≈ $19.21 at snapshot prices')
    // Max fills every digit, less 0.0005 ETH.
    fireEvent.click(screen.getByRole('button', { name: 'Max' }))
    expect(field().value).toBe('1.883297759828579704')
  })

  it('rounds a balance down and keeps every whole digit', () => {
    expect(balanceText(1_883_797_759_828_579_704n, 18)).toBe('1.88379')
    expect(balanceText(10n ** 18n, 18)).toBe('1')
    expect(balanceText(123_456_789_987_654n, 6)).toBe('123,456,789')
    expect(balanceText(123_456_789n, 18)).toBe('0.000000000123456')
    expect(balanceText(0n, 6)).toBe('0')
  })

  it('puts Max inside the field and the swap limit beside its label', async () => {
    renderPanel(wallet())
    await connect()
    await screen.findByText(/Balance: 1 ETH/)
    const max = screen.getByRole('button', { name: 'Max' })
    expect(max.closest('.trade-input')).toBe(field().closest('.trade-input'))
    const limit = screen.getByText('Up to $1,000 per swap')
    expect(field().getAttribute('aria-describedby')?.split(' ')).toContain(limit.id)
  })
})

describe('the swap limit', () => {
  it('offers an amount within the limit with the refusal, and it can be reviewed', async () => {
    renderPanel(wallet())
    await connect()
    await screen.findByText(/Balance: 1 ETH/)
    type('0.5')
    expect(await screen.findByText(/Swaps are limited to \$1K each for now/)).toBeTruthy()
    expect(document.getElementById(reasonId())?.textContent).toBe(
      'The amount is above the swap limit.',
    )
    const offer = screen.getByRole('button', { name: /^Use [\d.]+\sETH instead$/ })
    const offered = /Use ([\d.]+)/.exec(offer.textContent ?? '')?.[1] ?? ''
    expect(Number(offered) * (detail.latest?.token0Usd ?? 0)).toBeLessThanOrEqual(990)
    fireEvent.click(offer)
    expect(field().value).toBe(offered)
    await screen.findByText(/and at least/)
    expect(screen.getByRole('button', { name: 'Review swap' })).toHaveProperty('disabled', false)
  })

  it('values the limit on both sides, 1 % under it, and never above the room', () => {
    const eth = { decimals: 18, usdPrice: 2000 }
    const usdc = { decimals: 6, usdPrice: 1 }
    // 2,000 USDC an ETH, raw out per raw in.
    const at2000 = { num: 2000n * 10n ** 6n, den: 10n ** 18n }
    // $1,000 at $2,000 an ETH, less 1 %: 0.495 ETH.
    expect(capAmount(1000, eth, { ...usdc, perSent: at2000 }, null)).toBe(495n * 10n ** 15n)
    // The pool's price 1.5 % above the snapshot's: what 0.495 ETH buys is worth $1,004.85, so the
    // amount received bounds it: 990 / 2,030 ETH, rounded down.
    const at2030 = { num: 2030n * 10n ** 6n, den: 10n ** 18n }
    expect(capAmount(1000, eth, { ...usdc, perSent: at2030 }, null)).toBe(
      (990n * 10n ** 18n) / 2030n,
    )
    expect(capAmount(1000, eth, { ...usdc, perSent: at2000 }, 10n ** 17n)).toBe(10n ** 17n)
    expect(capAmount(1000, usdc, { ...eth, usdPrice: null, perSent: null }, null)).toBe(
      990_000_000n,
    )
    // A priced amount received with no pool price to bound it: no amount is offered.
    expect(capAmount(1000, usdc, { ...eth, perSent: null }, null)).toBeNull()
    expect(
      capAmount(1000, { ...eth, usdPrice: null }, { ...usdc, usdPrice: 0, perSent: at2000 }, null),
    ).toBeNull()
    expect(fieldText(257_665_239_521_123_456n, 18)).toBe('0.257665')
  })
})

describe('slippage, the ETH box and Review', () => {
  it('says what the chosen slippage tolerance means, aloud once chosen', async () => {
    renderPanel(wallet())
    await connect()
    const note = () => document.querySelector('.trade-slip-note') as HTMLElement
    expect(note().getAttribute('aria-live')).toBe('polite')
    expect(note().textContent).toBe(slippageNote(50))
    expect(note().textContent?.replace(/ /g, ' ')).toBe(
      'At least the quote minus 0.5 %; a bigger price move stops the swap.',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Slippage tolerance 3 percent' }))
    expect(note().textContent).toMatch(/Wide: it gives bots more room to trade ahead of you\.$/)
    fireEvent.click(screen.getByRole('radio', { name: 'Slippage tolerance 0.1 percent' }))
    expect(note().textContent).toMatch(/Tight: a small price move can stop the swap\.$/)
  })

  it('says what the ETH box does on each side, ticked or not, beside its name', async () => {
    renderPanel(wallet())
    await connect()
    const box = screen.getByRole('checkbox', { name: 'Use ETH instead of WETH' })
    const note = () => document.getElementById(box.getAttribute('aria-describedby') ?? '')
    expect(note()?.textContent).toBe('You pay with ETH from your wallet, not WETH.')
    expect(box.closest('label')?.contains(note() ?? null)).toBe(false)
    fireEvent.click(box)
    expect(note()?.textContent).toBe('You pay with WETH from your wallet.')
    fireEvent.click(screen.getByRole('radio', { name: 'Sell USDC' }))
    expect(note()?.textContent).toBe('You get WETH in your wallet.')
    fireEvent.click(box)
    expect(note()?.textContent).toBe('You get ETH in your wallet, not WETH.')
  })

  it('tells a screen reader why Review is not available yet, by cause, and nothing once it is', async () => {
    const fake = wallet()
    const quoter = holdRequest(fake, callTo(UNISWAP.quoter.toLowerCase()))
    renderPanel(fake)
    await connect()
    const button = screen.getByRole('button', { name: 'Review swap' })
    const reason = () => document.getElementById(button.getAttribute('aria-describedby') ?? '')
    expect(reason()?.textContent).toBe('Enter an amount to review the swap.')
    await enter('0.1')
    expect(button.getAttribute('aria-describedby')).toBeNull()
    quoter.arm()
    type('0.2')
    await screen.findByText('Updating the price…')
    expect(reason()?.textContent).toBe('Getting a live price for this amount.')
    quoter.release()
    await screen.findByText(/^768\.0\sUSDC$/)
    type('5')
    expect(reason()?.textContent).toBe('The amount is more than your balance.')
  })
})

describe('the form’s styles', () => {
  const css = read(join(SRC, 'trade', 'trade.css'))
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at))
  }

  it('outlines the amount field with the controls’ edge, never the faint line', () => {
    expect(rule('.trade-input input')).toMatch(/box-shadow: inset 0 0 0 1\.5px var\(--ctl-edge\)/)
  })

  it('gives Max a 44 px target on a coarse pointer', () => {
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse).toMatch(/\.trade-max::after \{[^}]*height: 44px/)
    expect(coarse).toMatch(/\.trade-max::after \{[^}]*width: max\(44px, 100%\)/)
  })

  it('dims the last quote by opacity only, after 150 ms', () => {
    const dim = rule('.trade-quote.is-updating .tq-dim')
    expect(dim).toMatch(/opacity: 0\.6/)
    expect(dim).toMatch(/transition-delay: 150ms/)
    expect(dim).not.toMatch(/transform|height/)
  })

  it('keeps two lines for the balance where its note wraps, so its reading moves nothing', () => {
    expect(css).toMatch(
      /@media \(max-width: [\d.]+em\) \{\s*\.trade-bal \{\s*min-height: calc\(2 \* 1\.45em\)/,
    )
  })
})

/** The id of the sentence that says why Review is not available. */
function reasonId(): string {
  return screen.getByRole('button', { name: 'Review swap' }).getAttribute('aria-describedby') ?? ''
}

/** SwapForm's props for a WETH/USDC form with 1 ETH, none quoted yet. */
function formProps(over: Partial<SwapFormProps>): SwapFormProps {
  const env = {
    token0: TOKENS.WETH,
    token1: TOKENS.USDC,
    snapshot: { price: 3842.15, token0Usd: 3842.15, token1Usd: 1 },
    flagsAtLoad: ON,
  } as unknown as TradeEnv
  return {
    env,
    detail,
    side: { tokenIn: TOKENS.WETH, tokenOut: TOKENS.USDC, ethIn: true, ethOut: false },
    presets: [10, 50, 100, 300],
    sellFirst: true,
    onSellFirst: () => undefined,
    useEth: true,
    onUseEth: () => undefined,
    amountText: '',
    onAmountText: () => undefined,
    slippageBps: 50,
    onSlippage: () => undefined,
    balance: 10n ** 18n,
    parsed: null,
    settled: true,
    last: null,
    fresh: null,
    overBalance: false,
    canReview: false,
    note: null,
    reviewing: false,
    heading: null,
    onReview: () => undefined,
    ...over,
  }
}
