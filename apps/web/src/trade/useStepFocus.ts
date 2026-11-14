/**
 * Moves focus to a step's heading when the step changes, so a keyboard or screen-reader user
 * lands on what the panel now asks (the heading carries `tabIndex={-1}`). It moves in the same
 * commit that draws the step (a layout effect): focus never rests on the page body in between,
 * where the element that had it was removed or disabled. Focus does not scroll by itself; the
 * heading is then brought into view only as far as needed (`block: 'nearest'`), so a step that is
 * already on screen stays where it is and a phone does not jump to its top.
 */
import { useLayoutEffect, useRef } from 'react'

export function useStepFocus<T extends HTMLElement = HTMLHeadingElement>(key: string) {
  const ref = useRef<T | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus again whenever the step changes
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView?.({ block: 'nearest' })
  }, [key])
  return ref
}
