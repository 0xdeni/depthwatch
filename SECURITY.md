# Security

Depthwatch indexes public chain data and serves numbers: it holds no keys, no funds and no user
accounts. A security issue is still anything that lets an input make the API, the dashboard, the
CLI or the database do something other than that; for example a pool id or query parameter that
reaches SQL unescaped, a path that `depthwatch serve` should not serve, an RPC response that
crashes or hangs the indexer, or a vulnerable dependency in the lockfile.

The static site's optional swap panel is in scope too, whether it is switched on or off. It is off
unless the site's operator switches it on ([docs/DEPLOY.md](docs/DEPLOY.md#trade-switch)); when on,
it lets a visitor swap in the pool they are viewing, from the visitor's own wallet, which signs
every transaction. Depthwatch never holds the visitor's keys or funds, but it builds what the
wallet is asked to sign, so an issue there includes anything that could make the panel:
- **Calldata:** send to a contract other than the route's router in `TRADE_ROUTES`
  (`packages/chain/src/addresses.ts`), swap a token outside `TRADE_TOKENS`, leave the output with
  anyone but the visitor at the end of the transaction, or accept a minimum output, a deadline or a
  price that the [swap checks](docs/METRICS.md#swap-checks) refuse.
- **Approvals:** ask for an allowance larger than the swap's input, or for a spender other than
  that router.
- **The Builder Code suffix:** drop, alter or append twice the ERC-8021 suffix
  (`apps/web/src/trade/builderCode.ts`), or let it change what the transaction does.
- **The switch:** show the swap while the bundle's `features.trade` is off for the pool's venue,
  or ask for a signature while it or `data/flags.json` is off, or for a venue whose route is on
  hold.
- **The security headers:** get around `apps/web/public/_headers`, the static site's
  Content-Security-Policy and framing rules, for example to run a script the site did not ship or
  to show the panel inside another site's frame.

## Reporting a vulnerability

Please do not open a public issue or pull request for a security problem: details posted there are
visible before a fix exists.

Report it privately through GitHub's vulnerability reporting form for this repository, the
"Report a vulnerability" button on the Security tab:

https://github.com/0xdeni/depthwatch/security/advisories/new

If that page says private reporting is not enabled, open an issue that says only that you have a
security report and would like a private channel, with no details; a maintainer replies with one.

Include what any bug report needs (the command or request, the pool id and block number where
relevant, what happened and what you expected), the impact as you understand it and, if you have
one, a fixture or test that reproduces it offline.

## What to expect

A maintainer acknowledges the report, works out the fix with you where that helps, and credits you
in the release that ships it unless you ask otherwise. Depthwatch is pre-1.0 and under active
development (see [README.md](README.md)).
