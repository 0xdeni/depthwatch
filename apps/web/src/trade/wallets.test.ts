/**
 * Wallet discovery: EIP-6963 announcements answer `eip6963:requestProvider`, each wallet once, in
 * order, with a malformed one or a remote icon dropped; `window.ethereum` stands in only when
 * nothing announces itself.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { choiceFromAnnouncement, discoverWallets, type Eip1193Provider } from './wallets.js'

const provider = (): Eip1193Provider => ({ request: async () => null })

function announceOnRequest(details: unknown[]) {
  const onRequest = () => {
    for (const detail of details)
      window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
  }
  window.addEventListener('eip6963:requestProvider', onRequest)
  return () => window.removeEventListener('eip6963:requestProvider', onRequest)
}

const info = (uuid: string, name: string, icon = 'data:image/svg+xml;base64,PHN2Zy8+') => ({
  uuid,
  name,
  icon,
  rdns: `io.${name.toLowerCase()}`,
})

afterEach(() => {
  delete (window as { ethereum?: unknown }).ethereum
})

describe('discoverWallets', () => {
  it('collects every announced wallet once, in order', async () => {
    const a = provider()
    const b = provider()
    const stop = announceOnRequest([
      { info: info('1', 'Alpha'), provider: a },
      { info: info('2', 'Beta', 'https://example.invalid/icon.png'), provider: b },
      { info: info('1', 'Alpha again'), provider: a },
      { info: { uuid: '3' }, provider: b },
      { info: info('4', 'No provider'), provider: {} },
    ])
    const found = await discoverWallets(window, 5)
    stop()
    expect(found.map((w) => [w.id, w.name, w.icon])).toEqual([
      ['1', 'Alpha', 'data:image/svg+xml;base64,PHN2Zy8+'],
      ['2', 'Beta', null],
    ])
  })

  it('falls back to window.ethereum when nothing announces itself', async () => {
    const injected = provider()
    ;(window as { ethereum?: unknown }).ethereum = injected
    const found = await discoverWallets(window, 5)
    expect(found).toEqual([
      { id: 'injected', name: 'Browser wallet', icon: null, provider: injected },
    ])
  })

  it('finds none in a browser without a wallet', async () => {
    expect(await discoverWallets(window, 5)).toEqual([])
  })
})

describe('choiceFromAnnouncement', () => {
  it('trims and bounds the name, and refuses an empty one', () => {
    expect(
      choiceFromAnnouncement({ info: info('x', `  ${'W'.repeat(80)}  `), provider: provider() })
        ?.name,
    ).toHaveLength(48)
    expect(choiceFromAnnouncement({ info: info('x', '   '), provider: provider() })).toBeNull()
    expect(choiceFromAnnouncement(null)).toBeNull()
  })
})
