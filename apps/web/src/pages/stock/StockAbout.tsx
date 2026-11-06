/**
 * "about this stock" (L3, after Pool's about panel, docs/design/visual-v4.md §5.7): the token and
 * its feed as identifiers, in a panel after the sections sheet; a two-column definition list from
 * 840 px and the "About this stock" disclosure on phones. Addresses are mono, link to Basescan and
 * can be copied. The multiplier is published as read and never applied to Chainlink's answer,
 * which is USD per token already (docs/METRICS.md, "The reading").
 */
import type { ReactNode } from 'react'
import type { StockDetail } from '../../api/stockTypes.js'
import { CopyButton } from '../../components/ui/CopyButton.js'
import { AboutSection } from '../../components/ui/Section.js'
import { ago, DASH, fee, full, group, hours } from '../../lib/format.js'
import { featuresText, multiplierText, STATUS_WORD } from '../../lib/stockText.js'
import { ChainId } from '../pool/PoolAbout.js'

const basescan = (address: string) => `https://basescan.org/address/${address}`

function Row({ term, children }: { term: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function StockAbout({ detail, now }: { detail: StockDetail; now: number }) {
  const { stock, reading } = detail
  const { token, feed } = stock
  const oracle =
    reading?.oraclePaused == null
      ? DASH
      : reading.oraclePaused
        ? 'Paused (a corporate action)'
        : 'Not paused'
  return (
    <AboutSection id="s-about" title="about this stock" disclosureLabel="About this stock">
      <dl className="about">
        <Row term="Token">
          <ChainId id={token.address} href={basescan(token.address)} />
          <CopyButton iconOnly text={token.address} label="Copy address" />
        </Row>
        <Row term="Name">
          {token.name}, {token.decimals} decimals
        </Row>
        <Row term="Multiplier">{multiplierText(reading?.tokenMultiplierWad ?? null) ?? DASH}</Row>
        <Row term="Paused features">{featuresText(reading?.pausedFeatures ?? null) ?? DASH}</Row>
        {feed ? (
          <>
            <Row term="Feed">
              Coinbase {stock.ticker}, <ChainId id={feed.address} href={basescan(feed.address)} />
              <CopyButton iconOnly text={feed.address} label="Copy feed address" />
            </Row>
            <Row term="Feed terms">
              {feed.decimals} decimals, a {hours(feed.heartbeatSeconds / 3_600)} heartbeat, a{' '}
              {fee(feed.deviationThresholdBps * 100)} deviation threshold, {feed.hours} hours
            </Row>
          </>
        ) : (
          <Row term="Feed">None recorded</Row>
        )}
        <Row term="Latest round">
          {reading?.feedUpdatedAt == null ? (
            DASH
          ) : (
            <>
              {full(reading.feedUpdatedAt)}
              {reading.feedRoundId === null ? null : (
                <>
                  , round <span className="addr">{reading.feedRoundId}</span>
                </>
              )}
            </>
          )}
        </Row>
        <Row term="Oracle registry">{oracle}</Row>
        <Row term="Reading">
          {reading === null ? (
            'None yet'
          ) : (
            <>
              {STATUS_WORD[reading.referenceStatus]}, {ago(reading.timestamp, now)}, block{' '}
              <span className="addr">{group(reading.blockNumber)}</span>
            </>
          )}
        </Row>
        {reading?.error ? <Row term="Reading error">{reading.error}</Row> : null}
      </dl>
    </AboutSection>
  )
}
