/**
 * The account's balance of what a side sends (ETH, or the token), read through the wallet. It
 * is null while it is read, when it could not be, and for any side other than the one it was
 * read for: switching direction or ETH/WETH never shows the last side's raw amount in this side's
 * decimals and unit, and Max waits for the right value. A new `tick` reads it again.
 */
import { useEffect, useState } from 'react'
import type { Side, TradeEnv } from './flow.js'
import { balanceOf } from './reads.js'

export function useBalanceIn(env: TradeEnv, side: Side, tick: number): bigint | null {
  const token = side.ethIn ? null : side.tokenIn.address
  const key = `${env.account}:${token ?? 'eth'}`
  const [read, setRead] = useState<{ key: string; value: bigint | null }>({ key: '', value: null })
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick reads it again after a swap
  useEffect(() => {
    let live = true
    void balanceOf(env.clients.plain, env.account, token)
      .catch(() => null)
      .then((value) => {
        if (live) setRead({ key, value })
      })
    return () => {
      live = false
    }
  }, [env, token, key, tick])
  return read.key === key ? read.value : null
}
