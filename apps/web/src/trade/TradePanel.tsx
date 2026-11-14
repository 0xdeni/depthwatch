/**
 * The swap panel: the lazy chunk behind "Swap in this pool" (pages/pool/TradeSection.tsx). It
 * finds the reader's wallets (EIP-6963, else `window.ethereum`), connects, asks the wallet to
 * switch to Base when it is elsewhere, reads the trade switch again (a tab opened before it went
 * off stops here) and checks the pool on chain through the wallet before any quote (`checkPool`).
 * Then `TradeSwap` takes the reader through amount, review, approval and swap; each connection is
 * one run (`run`), and a new run (another wallet, account or network) or leaving the page ends
 * the last one's swap before its next wallet prompt (`TradeEnv.active`); the last transaction the
 * wallet took in each run that has ended stays in view (`SentNote`), above the next form. Every
 * step has a heading that takes focus when it appears, and every state is a sentence. While the
 * first look for wallets runs, the panel shows the one loading line the page showed while the
 * panel loaded, as tall as the page kept it (`restHeight`). Once connected it shares its `env`,
 * what the reader confirmed on the review and "Stop waiting" with the later steps
 * (`PanelContext`); only the current run's approval is noted for its receipt. Stopping ends the
 * run, so its swap asks the wallet for nothing more; a request the wallet still shows and the
 * reader confirms later takes the place of the "stopped waiting" note, as sent.
 * With no wallet on a touch screen it offers Coinbase Wallet's in-app browser and the page's link;
 * on a computer, a wallet extension.
 * The swap is in this pool only: the panel never ranks pools or suggests another one.
 */
import { TRADE_TOKENS, type TradeVenue } from '@depthwatch/chain/addresses'
import type { Address, TokenInfo, TradeFlags } from '@depthwatch/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../api/context.js'
import type { PoolDetail } from '../api/types.js'
import { shortAddress } from '../lib/format.js'
import { useMediaQuery } from '../lib/useMediaQuery.js'
import { isUserRejection, switchFor, type TradeEnv } from './flow.js'
import { fetchLiveFlags } from './liveFlags.js'
import { checkPool, TradeStop, walletClients } from './reads.js'
import { referencePools } from './references.js'
import { isContractAccount, sendPathOf } from './send.js'
import { ConnectSteps } from './TradeConnect.js'
import {
  type Confirmed,
  PanelContext,
  type PanelShared,
  SentNote,
  type SentTx,
} from './TradeReview.js'
import { WAIT_HINT_MS } from './TradeSteps.js'
import { TradeSwap } from './TradeSwap.js'
import {
  CONNECT_CANCELLED,
  errorMessage,
  SWITCH_CANCELLED,
  SWITCHED_OFF,
  stopText,
} from './text.js'
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
  /** How long a wallet request may show nothing before the step offers "Stop waiting", ms. */
  waitHintMs: number
}

const DEFAULT_DEPS: TradeDeps = {
  discover: () => discoverWallets(),
  fetchLiveFlags: () => fetchLiveFlags(),
  pollMs: 2_000,
  quoteDelayMs: 400,
  waitHintMs: WAIT_HINT_MS,
}

/** The reader stopped waiting for the wallet in this run: the fresh form says what that means. */
const STOPPED =
  'You stopped waiting. If your wallet still shows the request, reject it there: a request you confirm later is still sent, and it will show up here.'

export interface Conn {
  choice: WalletChoice
  account: Address
}

export type Step =
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
  /** The page's height for the panel while it loaded (px): the first look's line keeps it. */
  restHeight?: number
}

/** A transaction a run handed to the wallet; `stopped`: the reader had stopped waiting for it. */
type RunTx = SentTx & { run: number; stopped: boolean }

export default function TradePanel({
  detail,
  venue,
  flagsAtLoad,
  deps,
  restHeight = 0,
}: TradePanelProps) {
  const api = useApi()
  const [all] = useState<TradeDeps>(() => ({ ...DEFAULT_DEPS, ...deps }))
  const [step, setStep] = useState<Step>({ s: 'wallets', choices: null, note: null })
  // The last transaction each run's swap handed to the wallet, until that run shows its outcome;
  // a run that has ended never does, so its transaction stays in view.
  const [sent, setSent] = useState<RunTx[]>([])
  // The run whose wallet request the reader stopped waiting for (`from`) and the fresh run that
  // says so (`to`); every run stopped so far; what the reader confirmed on the current review.
  const [stopped, setStopped] = useState<{ from: number; to: number } | null>(null)
  const stoppedRuns = useRef(new Set<number>())
  const confirmed = useRef<Confirmed | null>(null)
  // Only the first look shows the page's loading line; later looks say they look for wallets.
  const [looked, setLooked] = useState(false)
  const touch = useMediaQuery('(pointer: coarse)')
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
    setLooked(true)
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
        ? CONNECT_CANCELLED
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
        ? SWITCH_CANCELLED
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

  // "Stop waiting": this run ends (its swap asks the wallet for nothing more) and a fresh form
  // starts on the same connection, without checking the pool again.
  const stopWaiting = useCallback(() => {
    const prev = current.current
    if (prev.s !== 'ready') return
    const id = ++run.current
    stoppedRuns.current.add(prev.run)
    setStopped({ from: prev.run, to: id })
    setStep({ ...prev, env: { ...prev.env, active: () => run.current === id }, run: id })
  }, [])
  // What run `id`'s swap tells the panel: each transaction the wallet takes, then null once the
  // run shows its outcome. A run that has ended still reports a request confirmed late.
  const onSentFor = (id: number) => (tx: SentTx | null) => {
    const live = run.current === id
    // The approval's hash, for the receipt of the swap it was sent for: this run's own only.
    const memo = confirmed.current
    if (live && tx?.what === 'approval' && tx.hash && memo) memo.approvalHash = tx.hash
    // A new request of the fresh run reached the wallet: the note about the one left waiting is done.
    if (live && tx) setStopped((prev) => (prev?.to === id ? null : prev))
    const late = stoppedRuns.current.has(id)
    setSent((prev) => {
      const others = prev.filter((t) => t.run !== id)
      return tx ? [...others, { ...tx, run: id, stopped: late }] : others
    })
  }
  const readyEnv = step.s === 'ready' ? step.env : null
  const shared = useMemo<PanelShared | null>(
    () => (readyEnv ? { env: readyEnv, confirmed, stopWaiting, waitHintMs: all.waitHintMs } : null),
    [readyEnv, stopWaiting, all.waitHintMs],
  )

  const firstLook = step.s === 'wallets' && step.choices === null && !looked
  const stepKey =
    step.s === 'wallets'
      ? `wallets:${step.choices === null}:${firstLook}:${step.note}`
      : step.s === 'network'
        ? `network:${step.busy}:${step.note}`
        : step.s
  // One of the two is drawn: the step's heading, or the first look's loading line.
  const focus = useStepFocus(stepKey)
  const focusLine = useStepFocus<HTMLParagraphElement>(stepKey)
  const another = (
    <button
      type="button"
      className="quiet-link trade-linkbtn touch-hit"
      onClick={() => void look()}
    >
      Use another wallet
    </button>
  )
  // Transactions of runs that have ended, oldest first; the current run shows its own steps.
  const earlier = sent
    .filter((t) => !(step.s === 'ready' && t.run === step.run))
    .map((t) => <SentNote key={t.run} what={t.what} hash={t.hash} stopped={t.stopped} />)

  if (step.s === 'ready') {
    const id = step.run
    // Until the request the reader stopped waiting for turns up as sent, in this same place.
    const waitingNote =
      stopped?.to === id && !sent.some((t) => t.run === stopped.from) ? (
        <p className="trade-note" role="status">
          {STOPPED}
        </p>
      ) : null
    return (
      <PanelContext.Provider value={shared}>
        <div className="trade">
          <p className="trade-conn small">
            Connected: <span className="addr">{shortAddress(step.conn.account)}</span> on Base,
            through {step.conn.choice.name}. {another}
          </p>
          {earlier}
          {waitingNote}
          <TradeSwap
            key={`${step.conn.account}:${id}`}
            env={step.env}
            detail={detail}
            quoteDelayMs={all.quoteDelayMs}
            onSent={onSentFor(id)}
          />
        </div>
      </PanelContext.Provider>
    )
  }

  // The first look for wallets: the line the page showed while the panel loaded, as tall, nothing
  // more, so opening the panel shows one loading state rather than three and the page holds still.
  if (firstLook)
    return (
      <div className="trade">
        {earlier}
        <p
          className="muted"
          role="status"
          tabIndex={-1}
          ref={focusLine}
          style={restHeight > 0 ? { minHeight: restHeight } : undefined}
        >
          Loading the swap panel…
        </p>
      </div>
    )

  return (
    <div className="trade">
      {earlier}
      <ConnectSteps
        step={step}
        focus={focus}
        another={another}
        touch={touch}
        onConnect={(choice) => void connect(choice)}
        onLook={() => void look()}
        onSwitch={(conn) => void switchToBase(conn)}
        onCheckAgain={(conn) => void prepare(conn)}
      />
    </div>
  )
}
