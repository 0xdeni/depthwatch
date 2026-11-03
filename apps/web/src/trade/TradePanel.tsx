/**
 * The swap panel: the lazy chunk behind "Swap in this pool" (pages/pool/TradeSection.tsx). It
 * finds the reader's wallets (EIP-6963, else `window.ethereum`), connects, asks the wallet to
 * switch to Base when it is elsewhere, reads the trade switch again (a tab opened before it went
 * off stops here) and checks the pool on chain through the wallet before any quote (`checkPool`).
 * Then `TradeSwap` takes the reader through amount, review, approval and swap; each connection is
 * one run (`run`), and a new run (another wallet, account or network) or leaving the page ends
 * the last one's swap before its next wallet prompt (`TradeEnv.active`); a transaction the wallet
 * took in a run that has ended stays in view (`SentNote`). Every step has a heading that takes
 * focus when it appears, and every state is a sentence.
 * The swap is in this pool only: the panel never ranks pools or suggests another one.
 */
import { TRADE_TOKENS, type TradeVenue } from '@depthwatch/chain/addresses'
import type { Address, TokenInfo, TradeFlags } from '@depthwatch/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useApi } from '../api/context.js'
import type { PoolDetail } from '../api/types.js'
import { Button } from '../components/ui/Button.js'
import { shortAddress } from '../lib/format.js'
import { isUserRejection, switchFor, type TradeEnv } from './flow.js'
import { fetchLiveFlags } from './liveFlags.js'
import { checkPool, TradeStop, walletClients } from './reads.js'
import { referencePools } from './references.js'
import { isContractAccount, sendPathOf } from './send.js'
import { SentNote, type SentTx } from './TradeReview.js'
import { TradeSwap } from './TradeSwap.js'
import { CANCELLED, errorMessage, SWITCHED_OFF, stopText } from './text.js'
import { useStepFocus } from './useStepFocus.js'
import { ADD_BASE, BASE_HEX, discoverWallets, firstAccount, type WalletChoice } from './wallets.js'
import './trade.css'

/** What the panel reaches outside itself; tests pass fakes. */
export interface TradeDeps {
  discover: () => Promise<WalletChoice[]>
  fetchLiveFlags: () => Promise<TradeFlags | null>
  /** Polling of receipts and call bundles, ms. */
  pollMs: number
  /** Quiet time after typing before a live quote, ms. */
  quoteDelayMs: number
}

const DEFAULT_DEPS: TradeDeps = {
  discover: () => discoverWallets(),
  fetchLiveFlags: () => fetchLiveFlags(),
  pollMs: 2_000,
  quoteDelayMs: 400,
}

interface Conn {
  choice: WalletChoice
  account: Address
}

type Step =
  | { s: 'wallets'; choices: WalletChoice[] | null; note: string | null }
  | { s: 'connecting'; choice: WalletChoice }
  | { s: 'network'; conn: Conn; note: string | null; busy: boolean }
  | { s: 'checking'; conn: Conn }
  | { s: 'blocked'; conn: Conn; text: string }
  | { s: 'ready'; conn: Conn; env: TradeEnv; run: number }

const codeOf = (error: unknown) => (error as { code?: unknown } | null)?.code

/**
 * The compiled-in entry of an allowlisted token (symbol and decimals included): the bundle names
 * the pool's tokens, but what is typed, sent and shown is read with the allowlist's decimals.
 */
function listed(token: { address: string }): TokenInfo {
  const found = TRADE_TOKENS.find((t) => t.address === token.address.toLowerCase())
  if (!found) throw new TradeStop('token-not-allowed')
  return found
}

export interface TradePanelProps {
  detail: PoolDetail
  venue: TradeVenue
  /** The bundle's switch at load: on for `venue`, or the panel would not be shown. */
  flagsAtLoad: TradeFlags
  deps?: Partial<TradeDeps>
}

export default function TradePanel({ detail, venue, flagsAtLoad, deps }: TradePanelProps) {
  const api = useApi()
  const [all] = useState<TradeDeps>(() => ({ ...DEFAULT_DEPS, ...deps }))
  const [step, setStep] = useState<Step>({ s: 'wallets', choices: null, note: null })
  // The last transaction a run's swap handed to the wallet, until that run shows its outcome.
  const [sent, setSent] = useState<(SentTx & { run: number }) | null>(null)
  const run = useRef(0)
  const current = useRef(step)
  current.current = step
  const choices = useRef<WalletChoice[] | null>(null)
  const { pool, latest } = detail

  const look = useCallback(async () => {
    run.current++
    setStep({ s: 'wallets', choices: null, note: null })
    const found = await all.discover()
    choices.current = found
    setStep((prev) => (prev.s === 'wallets' ? { ...prev, choices: found } : prev))
  }, [all])

  useEffect(() => {
    void look()
  }, [look])
  // Leaving the page ends the current run: a swap in progress asks the wallet for nothing more.
  useEffect(
    () => () => {
      run.current++
    },
    [],
  )

  const prepare = useCallback(
    async (conn: Conn) => {
      const id = ++run.current
      const live = () => run.current === id
      try {
        const chain = await conn.choice.provider.request({ method: 'eth_chainId' })
        if (!live()) return
        if (String(chain).toLowerCase() !== BASE_HEX) {
          setStep({ s: 'network', conn, note: null, busy: false })
          return
        }
        setStep({ s: 'checking', conn })
        // The switch as served now: a tab loaded before it went off stops before any quote.
        const on = await switchFor(flagsAtLoad, all.fetchLiveFlags, venue)
        if (!live()) return
        if (on === null) {
          setStep({ s: 'blocked', conn, text: SWITCHED_OFF })
          return
        }
        const clients = walletClients(conn.choice.provider)
        const [checked, path, contract, references] = await Promise.all([
          checkPool(clients.plain, {
            address: (pool.address ?? '').toLowerCase() as Address,
            dex: pool.dex,
            token0: pool.token0.address.toLowerCase() as Address,
            token1: pool.token1.address.toLowerCase() as Address,
          }),
          sendPathOf(conn.choice.provider, conn.account),
          isContractAccount(clients.plain, conn.account),
          api
            .pools({ q: pool.token0.address, limit: 200 })
            .then((page) => referencePools(page.items, detail))
            .catch(() => []),
        ])
        if (!live()) return
        const env: TradeEnv = {
          provider: conn.choice.provider,
          clients,
          account: conn.account,
          path,
          suffixMayBeLost: path === 'eoa' && contract,
          active: live,
          checked,
          venue,
          token0: listed(pool.token0),
          token1: listed(pool.token1),
          snapshot: {
            price: latest?.price ?? null,
            token0Usd: latest?.token0Usd ?? null,
            token1Usd: latest?.token1Usd ?? null,
          },
          references,
          flagsAtLoad,
          fetchLiveFlags: all.fetchLiveFlags,
          pollMs: all.pollMs,
        }
        setStep({ s: 'ready', conn, env, run: id })
      } catch (error) {
        if (!live()) return
        const text =
          error instanceof TradeStop
            ? stopText(error.reason)
            : `The pool could not be checked through your wallet: ${errorMessage(error)}`
        setStep({ s: 'blocked', conn, text })
      }
    },
    [all, api, detail, flagsAtLoad, latest, pool, venue],
  )

  const connect = async (choice: WalletChoice) => {
    const id = ++run.current
    setStep({ s: 'connecting', choice })
    try {
      const account = firstAccount(await choice.provider.request({ method: 'eth_requestAccounts' }))
      if (run.current !== id) return
      if (account === null) {
        setStep({ s: 'wallets', choices: choices.current, note: 'The wallet shared no account.' })
        return
      }
      await prepare({ choice, account })
    } catch (error) {
      if (run.current !== id) return
      const note = isUserRejection(error)
        ? CANCELLED
        : `The wallet did not connect: ${errorMessage(error)}`
      setStep({ s: 'wallets', choices: choices.current, note })
    }
  }

  const switchToBase = async (conn: Conn) => {
    setStep({ s: 'network', conn, note: null, busy: true })
    const { provider } = conn.choice
    try {
      try {
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: BASE_HEX }],
        })
      } catch (error) {
        if (codeOf(error) !== 4902) throw error
        await provider.request({ method: 'wallet_addEthereumChain', params: [ADD_BASE] })
      }
      await prepare(conn)
    } catch (error) {
      const note = isUserRejection(error)
        ? CANCELLED
        : `The wallet did not switch: ${errorMessage(error)}`
      setStep({ s: 'network', conn, note, busy: false })
    }
  }

  const conn = step.s === 'wallets' || step.s === 'connecting' ? null : step.conn
  // The wallet's own changes: another network, another account, or none.
  useEffect(() => {
    if (!conn) return
    const { provider } = conn.choice
    const onChain = (chain: unknown) => {
      // Back on Base: check again, unless already trading there (a repeated event).
      if (String(chain).toLowerCase() === BASE_HEX) {
        if (current.current.s !== 'ready') void prepare(conn)
      } else {
        run.current++
        setStep({ s: 'network', conn, note: null, busy: false })
      }
    }
    const onAccounts = (accounts: unknown) => {
      const next = firstAccount(accounts)
      if (next === conn.account) return
      if (next === null) {
        run.current++
        setStep({ s: 'wallets', choices: choices.current, note: 'The wallet disconnected.' })
      } else void prepare({ choice: conn.choice, account: next })
    }
    provider.on?.('chainChanged', onChain)
    provider.on?.('accountsChanged', onAccounts)
    return () => {
      provider.removeListener?.('chainChanged', onChain)
      provider.removeListener?.('accountsChanged', onAccounts)
    }
  }, [conn, prepare])

  const focus = useStepFocus(
    step.s === 'wallets'
      ? `wallets:${step.choices === null}:${step.note}`
      : step.s === 'network'
        ? `network:${step.busy}:${step.note}`
        : step.s,
  )
  const another = (
    <button type="button" className="quiet-link trade-linkbtn" onClick={() => void look()}>
      Use another wallet
    </button>
  )
  const earlier =
    sent && !(step.s === 'ready' && step.run === sent.run) ? <SentNote {...sent} /> : null

  if (step.s === 'ready') {
    const id = step.run
    return (
      <div className="trade">
        {earlier}
        <p className="trade-conn small">
          Connected: <span className="addr">{shortAddress(step.conn.account)}</span> on Base,
          through {step.conn.choice.name}. {another}
        </p>
        <TradeSwap
          key={step.conn.account}
          env={step.env}
          detail={detail}
          quoteDelayMs={all.quoteDelayMs}
          onSent={(tx) =>
            setSent((prev) => (tx ? { ...tx, run: id } : prev?.run === id ? null : prev))
          }
        />
      </div>
    )
  }

  return (
    <div className="trade">
      {earlier}
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
            <>
              <p>
                No wallet was found in this browser. Install a wallet extension, or open this page
                in the Base App or your wallet’s own browser.
              </p>
              <div>
                <Button onClick={() => void look()}>Look again</Button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                Pick a wallet. Depthwatch never sees your keys; you approve every step in the
                wallet.
              </p>
              <ul className="trade-wallets">
                {step.choices.map((choice) => (
                  <li key={choice.id}>
                    <Button className="trade-wallet" onClick={() => void connect(choice)}>
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
              onClick={() => void switchToBase(step.conn)}
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
            <Button onClick={() => void prepare(step.conn)}>Check again</Button>
          </div>
          <p className="small">{another}</p>
        </>
      )}
    </div>
  )
}
