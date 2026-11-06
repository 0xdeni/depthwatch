/**
 * The footer (docs/design/visual-v4.md §5.1): the ink block in both themes. From 1024 px one row of
 * three columns: the wordmark at 28 px; the promise, the independence line in plain text and the data
 * source named once (D7), then the tokenized stocks' eligibility line (`FOOTER_STOCKS`), in
 * `--on-ink-2`; the links Methodology, API and GitHub as 44 px targets (44 × 44 on a coarse
 * pointer). Phones stack them in that order.
 *
 * The promise follows the trade switch the page loaded with (`tradeSwitchOn`): the panel's own
 * promise (non-custodial, no fee) while the switch is on for a venue whose route is not on hold,
 * read-only otherwise, so switching the panel on needs no new release of this text. A page already
 * open keeps its promise until it reloads.
 */
import { Link } from 'react-router-dom'
import { ELIGIBILITY_LINE } from '../../lib/stockText.js'
import { Wordmark } from './Logo.js'

export const REPO_URL = 'https://github.com/0xdeni/depthwatch'

/**
 * The API documentation the build ships next to index.html (AGENTS.md, from apps/api's agent
 * documents): `/AGENTS.md` on a server, `./AGENTS.md` beside a static copy.
 */
export const API_DOCS_HREF = `${import.meta.env.BASE_URL}AGENTS.md`

/** `snapshot`: the static build of a `live` bundle, a dated copy that does not update. */
export type DataSourceKind = 'demo' | 'mock' | 'live' | 'snapshot'

const DATA_LINE: Readonly<Record<DataSourceKind, string>> = {
  demo: 'Data: a synthetic demo world',
  mock: 'Data: the in-repo mock',
  live: 'Data: Base mainnet',
  snapshot: 'Data: a Base mainnet snapshot',
}

/** The promise while the swap panel is off. */
export const FOOTER_PROMISE =
  'Open source and read-only. No token, no custody. It indexes Uniswap, Aerodrome and Aero pools on Base mainnet. Independent: not affiliated with or endorsed by Base.'

/** The promise while the trade switch is on for a venue whose route is not on hold. */
export const FOOTER_PROMISE_TRADE =
  'Open source. No token, no custody, no fee added to swaps. It indexes Uniswap, Aerodrome and Aero pools on Base mainnet. The swap panel is on and non-custodial: a swap goes from your own wallet straight to the pool’s router. Independent: not affiliated with or endorsed by Base.'

/**
 * The site-wide stock line (docs/design/stocks-api.md §3), a paragraph of its own after the
 * promise: it covers every list that can show a stock pool (Home, Pools, Gaps) and the token pages.
 */
export const FOOTER_STOCKS = ELIGIBILITY_LINE

export function Footer({ source, trade = false }: { source: DataSourceKind; trade?: boolean }) {
  return (
    <footer className="foot">
      <div className="wrap foot-inner">
        <Link className="brand" to="/" aria-label="Depthwatch home">
          <Wordmark size={28} />
        </Link>
        <div className="foot-text">
          <p className="foot-say">
            {trade ? FOOTER_PROMISE_TRADE : FOOTER_PROMISE}{' '}
            <span className="foot-data">{DATA_LINE[source]}</span>.
          </p>
          <p className="foot-say foot-stocks">{FOOTER_STOCKS}</p>
        </div>
        <ul className="foot-links">
          <li>
            <Link className="touch-hit" to="/methodology">
              Methodology
            </Link>
          </li>
          <li>
            <a className="touch-hit" href={API_DOCS_HREF}>
              API
            </a>
          </li>
          <li>
            <a className="touch-hit" href={REPO_URL} rel="noopener">
              GitHub
            </a>
          </li>
        </ul>
      </div>
    </footer>
  )
}
