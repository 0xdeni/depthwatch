/**
 * The swap panel's focus moves in the commit that draws a step: anything that runs after it in the
 * same commit, and so any test or screen reader that looks once the step is drawn, finds focus on
 * the step's heading, never on the page body in between. Focus itself does not scroll; the heading
 * is brought into view only as far as needed.
 */
import { cleanup, render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, expect, it } from 'vitest'
import { useStepFocus } from './useStepFocus.js'

afterEach(() => cleanup())

function Step({ name }: { name: string }) {
  const ref = useStepFocus(name)
  return (
    <h3 tabIndex={-1} ref={ref}>
      {name}
    </h3>
  )
}

/** Records what has focus when the commit reaches it, after the step. */
function Probe({ seen }: { seen: string[] }) {
  useLayoutEffect(() => {
    const active = document.activeElement
    seen.push(active?.tagName === 'H3' ? (active.textContent ?? '') : String(active?.tagName))
  })
  return null
}

it('moves focus to the step’s heading in the commit that draws it', () => {
  const seen: string[] = []
  const { rerender } = render(
    <>
      <Step name="Connect a wallet" />
      <Probe seen={seen} />
    </>,
  )
  rerender(
    <>
      <Step name="Your swap" />
      <Probe seen={seen} />
    </>,
  )
  expect(seen).toEqual(['Connect a wallet', 'Your swap'])
})

it('focuses without scrolling, then brings the heading into view only as far as needed', () => {
  const calls: string[] = []
  const focus = HTMLElement.prototype.focus
  const scroll = HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.focus = function (options?: FocusOptions) {
    calls.push(`focus ${JSON.stringify(options)}`)
    focus.call(this, options)
  }
  HTMLElement.prototype.scrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => {
    calls.push(`scroll ${JSON.stringify(arg)}`)
  }
  try {
    render(<Step name="Review the swap" />)
  } finally {
    HTMLElement.prototype.focus = focus
    HTMLElement.prototype.scrollIntoView = scroll
  }
  expect(calls).toEqual(['focus {"preventScroll":true}', 'scroll {"block":"nearest"}'])
  expect(document.activeElement?.textContent).toBe('Review the swap')
})
