/**
 * The swap panel's steps before the swap (`TradePanel` owns them): the wallets this browser
 * offers, or what to do without one, connecting, the wrong network, the pool's onchain check and
 * a pool that can't be traded. Presentational: every action is the panel's. Each step's heading
 * takes focus as it appears (`focus`).
 */
import type { ReactNode, RefObject } from 'react'
import { Button, buttonClass } from '../components/ui/Button.js'
import { CopyButton } from '../components/ui/CopyButton.js'
import type { Conn, Step } from './TradePanel.js'
import { coinbaseWalletLink, type WalletChoice } from './wallets.js'

/** Every step but `ready`, which is the swap itself. */
export function ConnectSteps({
  step,
  focus,
  another,
  touch,
  onConnect,
  onLook,
  onSwitch,
  onCheckAgain,
}: {
  step: Exclude<Step, { s: 'ready' }>
  focus: RefObject<HTMLHeadingElement | null>
  /** "Use another wallet". */
  another: ReactNode
  /** A touch screen (a phone or tablet), where wallets are apps rather than extensions. */
  touch: boolean
  onConnect: (choice: WalletChoice) => void
  onLook: () => void
  onSwitch: (conn: Conn) => void
  onCheckAgain: (conn: Conn) => void
}) {
  return (
    <>
      {step.s === 'wallets' ? (
        <>
          <h3 className="trade-h" tabIndex={-1} ref={focus}>
            Connect a wallet
          </h3>
          {step.note ? (
            <p className="trade-note" role="alert">
              {step.note}
            </p>
          ) : null}
          {step.choices === null ? (
            <p className="muted" role="status">
              Looking for wallets in this browser…
            </p>
          ) : step.choices.length === 0 ? (
            <NoWallet touch={touch} onLook={onLook} />
          ) : (
            <>
              <p className="muted">
                Pick a wallet. Depthwatch never sees your keys; you approve every step in the
                wallet.
              </p>
              <ul className="trade-wallets">
                {step.choices.map((choice) => (
                  <li key={choice.id}>
                    <Button className="trade-wallet" onClick={() => onConnect(choice)}>
                      {choice.icon ? <img src={choice.icon} alt="" width={20} height={20} /> : null}
                      {choice.name}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : step.s === 'connecting' ? (
        <>
          <h3 className="trade-h" tabIndex={-1} ref={focus}>
            Connecting
          </h3>
          <p role="status">Approve the connection in {step.choice.name}.</p>
          <p className="small">{another}</p>
        </>
      ) : step.s === 'network' ? (
        <>
          <h3 className="trade-h" tabIndex={-1} ref={focus}>
            Wrong network
          </h3>
          <p>
            {step.conn.choice.name} is on another network. Switch it to Base to trade in this pool.
          </p>
          {step.note ? (
            <p className="trade-note" role="alert">
              {step.note}
            </p>
          ) : null}
          <div>
            <Button
              variant="primary"
              loading={step.busy}
              disabled={step.busy}
              onClick={() => onSwitch(step.conn)}
            >
              Switch to Base
            </Button>
          </div>
          {step.busy ? null : <p className="small">{another}</p>}
        </>
      ) : step.s === 'checking' ? (
        <>
          <h3 className="trade-h" tabIndex={-1} ref={focus}>
            Checking the pool
          </h3>
          <p role="status">Checking this pool and its DEX contract onchain, through your wallet…</p>
        </>
      ) : (
        <>
          <h3 className="trade-h" tabIndex={-1} ref={focus}>
            Can’t trade this pool
          </h3>
          <p className="trade-note" role="alert">
            {step.text}
          </p>
          <div>
            <Button onClick={() => onCheckAgain(step.conn)}>Check again</Button>
          </div>
          <p className="small">{another}</p>
        </>
      )}
    </>
  )
}

/**
 * No wallet in this browser. On a touch screen, where wallets are apps, the page opens in
 * Coinbase Wallet's in-app browser or its link is copied for another wallet app's browser; on a
 * computer, a wallet extension.
 */
function NoWallet({ touch, onLook }: { touch: boolean; onLook: () => void }) {
  const page = typeof window === 'undefined' ? '' : window.location.href
  const app = coinbaseWalletLink(page)
  if (!touch)
    return (
      <>
        <p>
          No wallet was found in this browser. Install a wallet extension and reload this page, or
          open it in your wallet app’s own browser.
        </p>
        <div>
          <Button onClick={onLook}>Look again</Button>
        </div>
      </>
    )
  return (
    <>
      <p>
        No wallet was found in this browser. On a phone, open this page in your wallet app’s own
        browser: Coinbase Wallet opens it directly, and other wallet apps take the copied link.
      </p>
      <div className="trade-actions">
        {app ? (
          <a className={buttonClass('primary')} href={app} rel="noopener">
            Open in Coinbase Wallet
          </a>
        ) : null}
        <CopyButton text={page} label="Copy page link" />
      </div>
      <div>
        <Button onClick={onLook}>Look again</Button>
      </div>
    </>
  )
}
