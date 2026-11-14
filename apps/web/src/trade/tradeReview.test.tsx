/**
 * The review's action row sticks to the bottom of the screen, so Swap is on screen as the review
 * opens; focus is never left under it (base.css, Focus A2). Browsers count a control under a
 * sticky row as in view and do not scroll it, so the review scrolls such a control above the row.
 * jsdom has no layout: the row's and the control's boxes are given here. Hermetic.
 */
import { cleanup, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { connect, enter, renderPanel, review, wallet } from '../testing/tradeHarness.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const box = (el: HTMLElement, top: number, bottom: number) => {
  el.getBoundingClientRect = () => ({ top, bottom }) as DOMRect
}

it('scrolls a control the stuck action row covers above it, and leaves the others where they are', async () => {
  renderPanel(wallet())
  await connect()
  await enter('100', 'USDC')
  await review()
  const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined)
  const row = document.querySelector<HTMLElement>('.review-act')
  if (!row) throw new Error('no action row')
  // At 390 x 844: the row from 772 to 844, "Contracts and addresses" from 757 to 801 under it.
  box(row, 772, 844)
  const covered = screen.getByRole('button', { name: 'Contracts and addresses' })
  box(covered, 757, 801)
  covered.focus()
  expect(scrollBy).toHaveBeenCalledTimes(1)
  expect(scrollBy).toHaveBeenCalledWith({ top: 801 - 772 + 8, behavior: 'instant' })
  scrollBy.mockClear()
  // A control above the row, and the row's own buttons, stay where they are.
  const heading = screen.getByRole('heading', { name: 'Review the swap' })
  box(heading, 120, 150)
  heading.focus()
  screen.getByRole('button', { name: 'Approve and swap' }).focus()
  screen.getByRole('button', { name: 'Back' }).focus()
  expect(scrollBy).not.toHaveBeenCalled()
})
