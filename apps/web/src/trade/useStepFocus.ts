/**
 * Moves focus to a step's heading when the step changes, so a keyboard or screen-reader user
 * lands on what the panel now asks (the heading carries `tabIndex={-1}`). It moves in the same
 * commit that draws the step (a layout effect): focus never rests on the page body in between,
 * where the element that had it was removed or disabled.
 */
import { useLayoutEffect, useRef } from 'react'

export function useStepFocus(key: string) {
  const ref = useRef<HTMLHeadingElement | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus again whenever the step changes
  useLayoutEffect(() => {
    ref.current?.focus()
  }, [key])
  return ref
}
