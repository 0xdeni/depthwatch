/**
 * A page that fails to draw (ST3 at page level, docs/design/visual-v4.md §5.12). Inside <main>,
 * `RouteErrorBoundary` replaces only the route with one sentence and a way on, so the app bar,
 * the nav and the footer stay usable, and the next navigation draws again. Around the whole app,
 * `RootErrorBoundary` catches what fails outside the routes: there is no router left, so its page
 * offers Reload. React reports the error itself (console), so nothing is logged here.
 */
import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Wordmark } from './shell/Logo.js'
import { Button } from './ui/Button.js'

/** The sentence both fallbacks open with. */
export const DRAW_FAILED = 'This page could not be drawn.'

interface BoundaryProps {
  fallback: ReactNode
  /** A new value after a failure draws the children again (the route's location key). */
  resetKey?: unknown
  children: ReactNode
}

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidUpdate(prev: BoundaryProps, prevState: { failed: boolean }): void {
    // Only a failure already on screen resets: one that came with the new key stays.
    if (prevState.failed && this.state.failed && prev.resetKey !== this.props.resetKey)
      this.setState({ failed: false })
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** The route's own failure: the sentence, then Pools as the way on. */
function RouteError() {
  return (
    <div className="wrap page-error" role="alert">
      <h1 className="display">{DRAW_FAILED}</h1>
      <p className="answer">
        Reload, or go to{' '}
        <Link className="ulink" to="/pools">
          Pools
        </Link>
        .
      </p>
    </div>
  )
}

export function RouteErrorBoundary({
  resetKey,
  children,
}: {
  resetKey: string
  children: ReactNode
}) {
  return (
    <Boundary fallback={<RouteError />} resetKey={resetKey}>
      {children}
    </Boundary>
  )
}

/**
 * One part of a page that fails to load or draw (the lazy swap panel): its own fallback in place,
 * the rest of the page untouched.
 */
export function PartErrorBoundary({
  fallback,
  children,
}: {
  fallback: ReactNode
  children: ReactNode
}) {
  return <Boundary fallback={fallback}>{children}</Boundary>
}

/** The whole app failed: the wordmark, the sentence and Reload, with no router or provider. */
function AppError() {
  return (
    <>
      <header className="appbar">
        <div className="wrap appbar-inner">
          <span className="brand">
            <Wordmark />
          </span>
        </div>
      </header>
      <main className="wrap page-error">
        <div role="alert">
          <h1 className="display">{DRAW_FAILED}</h1>
          <p className="answer">Reload to draw it again.</p>
        </div>
        <div className="actions">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </main>
    </>
  )
}

export function RootErrorBoundary({ children }: { children: ReactNode }) {
  return <Boundary fallback={<AppError />}>{children}</Boundary>
}
