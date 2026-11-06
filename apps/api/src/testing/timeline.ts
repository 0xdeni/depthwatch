/**
 * Time helpers shared by the seed builders: evenly spaced series, a deterministic wobble so
 * series are not flat, and a block number per timestamp (one block per two seconds: the spacing
 * Base kept until Denim, block 53,556,127, five a second since; the seed's clock, `SEED_BLOCK` at
 * `SEED_NOW` in 2023, is not Base's own block numbering).
 */
import { SEED_BLOCK } from './constants.js'

/** Ascending timestamps every `stepSeconds` over `spanSeconds`, ending at `now`. */
export function series(now: number, spanSeconds: number, stepSeconds: number): number[] {
  const out: number[] = []
  for (let ts = now - spanSeconds; ts <= now; ts += stepSeconds) out.push(ts)
  return out
}

/** Small deterministic wobble so series are not flat: ±4 % around 1. */
export function wobble(index: number): number {
  return 1 + 0.04 * Math.sin(index * 1.7)
}

/** The block the seed stamps a timestamp with: `SEED_BLOCK` at `now`, one block per 2 s before. */
export function blockAt(now: number, timestamp: number): bigint {
  return SEED_BLOCK - BigInt(Math.floor((now - timestamp) / 2))
}
