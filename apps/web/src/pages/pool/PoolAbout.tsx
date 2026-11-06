/**
 * "about this pool" (L3, ia-v3 §4.3 section 6, docs/design/visual-v4.md §5.7): every identifier and
 * piece of metadata in a panel after the sections sheet, as a two-column definition list from
 * 840 px and the "About this pool" disclosure on phones. On-chain ids are mono;
 * addresses link to Basescan and can be copied. A Uniswap v4 pool lives in the singleton
 * PoolManager and is keyed by a bytes32 id, which has no explorer page, so it is text.
 */
import { hasDynamicFee, NATIVE_ETH, type PoolKind } from '@depthwatch/core'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useDataNow } from '../../api/context.js'
import type { PoolDetail, PoolMetaDto } from '../../api/types.js'
import { CopyButton } from '../../components/ui/CopyButton.js'
import { Glossary } from '../../components/ui/Glossary.js'
import { AboutSection } from '../../components/ui/Section.js'
import {
  ago,
  DASH,
  dexLabel,
  fee,
  group,
  NB,
  price,
  ratio,
  score,
  tokenHref,
  tokenText,
} from '../../lib/format.js'
import { VALUATION_LABEL } from '../../lib/stockText.js'

const KIND: Readonly<Record<PoolKind, string>> = {
  concentrated: 'concentrated liquidity',
  'constant-product': 'constant product',
  'stable-swap': 'stable swap',
}

/** A mono on-chain id, shortened, linking to Basescan when it is an address. */
export function ChainId({ id, href }: { id: string; href?: string }) {
  const short = `${id.slice(0, 10)}…${id.slice(-6)}`
  return href ? (
    <a className="addr plink" href={href} target="_blank" rel="noreferrer" title={id}>
      {short}
    </a>
  ) : (
    <span className="addr" title={id}>
      {short}
    </span>
  )
}

const basescan = (address: string) => `https://basescan.org/address/${address}`

/**
 * The hooks contract of a v4 pool, or an Aero Slipstream pool's swap hook when it is not the
 * reviewed one; null for none (null, or the zero address v4 stores).
 */
export function hooksOf(pool: PoolMetaDto): string | null {
  return pool.hooks && pool.hooks !== NATIVE_ETH ? pool.hooks : null
}

function Row({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * The fee as last read: the latest snapshot's, or, for a pool never snapshotted (or whose snapshot
 * predates the stored fee), the reading at discovery. A dynamic fee says which.
 */
function feeRow(pool: PoolDetail['pool'], latest: PoolDetail['latest']): string {
  const snapshotFee = latest?.feePips ?? null
  const shown = fee(snapshotFee ?? pool.feePips)
  if (!hasDynamicFee(pool)) return shown
  return `${shown}, dynamic (read at ${snapshotFee === null ? 'discovery' : 'the latest snapshot'})`
}

export function PoolAbout({ detail }: { detail: PoolDetail }) {
  const now = useDataNow()
  const { pool, latest, gap } = detail
  const hooks = hooksOf(pool)
  const key = pool.address ?? pool.poolId
  return (
    <AboutSection id="s-about" title="about this pool" disclosureLabel="About this pool">
      <dl className="about">
        <Row term="DEX">
          {dexLabel(pool.dex)}, {KIND[pool.kind]}
          {pool.stable ? ', stable pair' : ''}
        </Row>
        <Row term="Fee">{feeRow(pool, latest)}</Row>
        <Row
          term={
            <Glossary
              definition="The price step between the ranges an LP can choose."
              anchor="concentration"
            >
              Tick spacing
            </Glossary>
          }
        >
          {pool.tickSpacing ?? DASH}
        </Row>
        {key ? (
          <Row term={pool.address ? 'Contract' : 'Pool id'}>
            <ChainId id={key} href={pool.address ? basescan(pool.address) : undefined} />
            <CopyButton
              iconOnly
              text={key}
              label={pool.address ? 'Copy address' : 'Copy pool id'}
            />
          </Row>
        ) : null}
        {hooks ? (
          <Row term="Hooks">
            <ChainId id={hooks} href={basescan(hooks)} />
          </Row>
        ) : null}
        <Row term="Tokens">
          <Link className="tlink" to={tokenHref(pool.token0.address)}>
            {tokenText(pool.token0)}
          </Link>
          and
          <Link className="tlink" to={tokenHref(pool.token1.address)}>
            {tokenText(pool.token1)}
          </Link>
        </Row>
        <Row term="Tracked">
          {detail.tracked ? 'Yes, snapshotted' : 'Not tracked: discovered but not snapshotted'}
        </Row>
        <Row term="Created at block">
          <span className="addr">{group(pool.createdAtBlock)}</span>
        </Row>
        <Row term="Latest snapshot">
          {latest ? (
            <>
              {ago(latest.timestamp, now)}, block{' '}
              <span className="addr">{group(latest.blockNumber)}</span>
            </>
          ) : (
            'None yet'
          )}
        </Row>
        <Row term="Scored">{detail.scoredAt ? ago(detail.scoredAt, now) : 'Not scored yet'}</Row>
        <Row term="Prices used">
          {latest
            ? `${tokenText(pool.token0)} ${usdPrice(latest.token0Usd)}, ${tokenText(pool.token1)} ${usdPrice(latest.token1Usd)}`
            : DASH}
          {latest?.reference ? <span className="about-note">{VALUATION_LABEL}</span> : null}
        </Row>
        <Row
          term={
            <Glossary
              definition={`How much more a pool trades each day than its ±2${NB}% depth: 0 at 1×, 50 at 10×, 100 at 100×.`}
              anchor="gaps"
            >
              Gap score
            </Glossary>
          }
        >
          {gap?.gapScore == null
            ? DASH
            : `${score(gap.gapScore)}, turnover ${ratio(gap.turnoverRatio)}`}
        </Row>
      </dl>
    </AboutSection>
  )
}

function usdPrice(v: number | null): string {
  return v === null ? 'unpriced' : `$${price(v)}`
}
