/**
 * Wallet discovery: EIP-6963 (`eip6963:requestProvider` / `eip6963:announceProvider`), which
 * extension wallets and the in-app browsers of wallet apps answer, with `window.ethereum` as the
 * fallback when nothing announces itself. A discovery only listens for the wallets the browser
 * announces: it asks no wallet for anything and opens nothing; connecting is
 * `eth_requestAccounts`, later, when the reader picks a wallet. The pool page may start one
 * discovery before the panel opens, on the reader's intent (hovering, pressing or focusing a way
 * to the swap, or the trade row coming within one viewport of the screen, not with Save-Data on;
 * none while a panel is open), and the panel takes it when it opens (`pages/pool/tradeIntent.ts`);
 * otherwise the panel starts its own.
 */
import type { Address } from '@depthwatch/core'

/** The EIP-1193 surface the panel uses. */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown }): Promise<unknown>
  on?(event: string, listener: (...args: never[]) => void): void
  removeListener?(event: string, listener: (...args: never[]) => void): void
}

export interface WalletChoice {
  /** The EIP-6963 `uuid`, or `injected` for the `window.ethereum` fallback. */
  id: string
  name: string
  /** A `data:image/…` URI from the announcement, or null. */
  icon: string | null
  provider: Eip1193Provider
}

/** Base mainnet's chain id as EIP-1193 writes it. */
export const BASE_HEX = '0x2105'

/** `wallet_addEthereumChain` of Base, for a wallet that does not know it yet (4902). */
export const ADD_BASE = {
  chainId: BASE_HEX,
  chainName: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org'],
  blockExplorerUrls: ['https://basescan.org'],
}

/** The first account of an `eth_requestAccounts` or `accountsChanged` answer, lowercase, or null. */
export function firstAccount(accounts: unknown): Address | null {
  const first = Array.isArray(accounts) ? String(accounts[0] ?? '').toLowerCase() : ''
  return /^0x[0-9a-f]{40}$/.test(first) ? (first as Address) : null
}

const ANNOUNCE = 'eip6963:announceProvider'
const REQUEST = 'eip6963:requestProvider'

/** How long announcements are collected after the request, in ms. */
export const DISCOVERY_WAIT_MS = 300

export function isProvider(value: unknown): value is Eip1193Provider {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { request?: unknown }).request === 'function'
  )
}

/** An icon only as an inline image: a remote URL would be a request the page never makes. */
function safeIcon(icon: unknown): string | null {
  return typeof icon === 'string' && /^data:image\/(?:png|svg\+xml|webp|jpeg|gif)[;,]/.test(icon)
    ? icon
    : null
}

/** The choice an `eip6963:announceProvider` event's detail describes, or null when malformed. */
export function choiceFromAnnouncement(detail: unknown): WalletChoice | null {
  if (typeof detail !== 'object' || detail === null) return null
  const { info, provider } = detail as { info?: unknown; provider?: unknown }
  if (typeof info !== 'object' || info === null || !isProvider(provider)) return null
  const { uuid, name, icon } = info as { uuid?: unknown; name?: unknown; icon?: unknown }
  if (typeof uuid !== 'string' || uuid === '' || typeof name !== 'string') return null
  const label = name.trim().slice(0, 48)
  if (label === '') return null
  return { id: uuid, name: label, icon: safeIcon(icon), provider }
}

/**
 * The wallets found in this browser: every distinct EIP-6963 announcement received within
 * `waitMs` of the request, in order; else the injected `window.ethereum` as "Browser wallet";
 * else none.
 */
export function discoverWallets(
  target: Window = window,
  waitMs: number = DISCOVERY_WAIT_MS,
): Promise<WalletChoice[]> {
  return new Promise((resolve) => {
    const found = new Map<string, WalletChoice>()
    const onAnnounce = (event: Event) => {
      const choice = choiceFromAnnouncement((event as CustomEvent<unknown>).detail)
      if (choice && !found.has(choice.id)) found.set(choice.id, choice)
    }
    target.addEventListener(ANNOUNCE, onAnnounce)
    target.dispatchEvent(new Event(REQUEST))
    setTimeout(() => {
      target.removeEventListener(ANNOUNCE, onAnnounce)
      const choices = [...found.values()]
      const injected = (target as Window & { ethereum?: unknown }).ethereum
      if (choices.length === 0 && isProvider(injected))
        choices.push({ id: 'injected', name: 'Browser wallet', icon: null, provider: injected })
      resolve(choices)
    }, waitMs)
  })
}

/**
 * Coinbase Wallet's link that opens `pageUrl` in its in-app browser, for a phone without a wallet
 * in the current browser: `https://go.cb-w.com/dapp?cb_url=` and the page, URL-encoded. Coinbase's
 * developer documentation no longer has a page for this link (its old deep-link page redirects to
 * the wallet SDK's overview); the link was seen to answer as Coinbase Wallet's "Open browser in
 * CBW" page, which hands `cb_url` to the app, on 13 November 2026. Only an http(s) page is linked.
 */
export function coinbaseWalletLink(pageUrl: string): string | null {
  if (!/^https?:\/\//.test(pageUrl)) return null
  return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(pageUrl)}`
}
