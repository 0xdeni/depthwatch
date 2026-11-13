# Running Depthwatch on a server

A server runs one command, `depthwatch start`: one process that serves the website and the API
and keeps the data fresh on a schedule. This page lists what that process needs from its host and
how to follow it once it runs. [ARCHITECTURE.md](ARCHITECTURE.md#running-as-a-service) explains the
schedule and the budget arithmetic behind the defaults.

## What runs

```sh
pnpm install --frozen-lockfile
pnpm build                  # the dashboard (apps/web/dist), which start serves
pnpm depthwatch start       # website + API + the pipeline, until SIGTERM
```

- The server listens at once on `0.0.0.0`, port `DEPTHWATCH_PORT`, else the `PORT` a hosting
  platform sets, else 8787. It answers from the database as it is, empty at first; `GET
  /api/health` is the health check.
- The database must be writable by the process. `start` writes a probe row before it listens
  and exits 1 with `database is not writable: <path>` otherwise (a file restored as root and
  run as another user, a mount that refused the chown), so the host's restart policy or
  `docker ps` shows the problem instead of a healthy site whose every pass fails.
- The pipeline runs a pass every 30 minutes: snapshot and score every pass, volume every hour,
  LP positions every 6 hours, factory-log discovery for up to 15 minutes a pass, and once a day
  the retention prune ([Disk](#disk)). On an empty
  database the first pass seeds the pools of the reference tokens (and of any
  `DEPTHWATCH_SEED_TOKENS`) first, so the site shows data within minutes; a DEX whose factory
  reads fail is seeded again at the next pass, the others' pools already showing; full discovery from the factories' deployment blocks then completes over the
  following passes, in about 14 hours (about 126,000 requests at a head of 53.6 M, 5 November
  2026; [docs/ARCHITECTURE.md](ARCHITECTURE.md#budget-at-the-defaults)). A mandate registered on a pool whose LP positions are
  not indexed yet makes positions run in the next pass, whatever the cadence; its scorecard gets
  no sample before then (an attribution failure in the logs, never a false breach).
- A failing step is logged and tried again at its next slot; the site keeps serving. A volume or
  positions run that found no tracked pool yet (a failed first snapshot) is due again at the next
  pass.
- SIGTERM (or Ctrl-C) stops the step in flight, which stores nothing more (no partial snapshot
  enters the history), closes the database and exits 0 within 8 seconds. A host's stop timeout
  of 10 seconds (Docker's default) is enough.
- A restart resumes where the last run stopped: every step keeps its cursors in the database.

The same process ships as a Docker image ([Docker](#docker)). Either way, put a reverse proxy
with TLS in front ([A reverse proxy with TLS](#a-reverse-proxy-with-tls)) and back the database
up through SQLite ([Backups](#backups)).

## Docker

The `Dockerfile` at the repository root builds the server as an image: the dependencies are
installed and the dashboard is built inside the build, and the container runs `depthwatch start`
as the unprivileged `node` user with the database at `/data/depthwatch.db` (the image sets
`DEPTHWATCH_DB`). [deploy/compose.yaml](../deploy/compose.yaml) says the same as these commands:

```sh
docker build -t depthwatch .
docker run -d --name depthwatch --restart unless-stopped --stop-timeout 10 \
  --env-file .env -e DEPTHWATCH_DB=/data/depthwatch.db \
  -p 127.0.0.1:8787:8787 -v depthwatch-data:/data depthwatch
# or, with Compose, from the repository root:
docker compose -f deploy/compose.yaml up -d --build
```

- `--env-file .env` hands the container the [settings](#settings) below (`DEPTHWATCH_RPC_URL` at
  least); Docker reads the file, which never enters the image. `DEPTHWATCH_DB` stays at
  `/data/depthwatch.db` whatever the file says (`-e` wins over the file; Compose sets it under
  `environment`), and the entrypoint refuses a relative `DEPTHWATCH_DB` (exit code 2), which
  would point inside the image. The port inside the container is 8787 unless the file sets
  `DEPTHWATCH_PORT`, in which case `-p` (`ports:`) must map that port; a platform's `PORT` is
  honoured when the file does not set `DEPTHWATCH_PORT` (`.env.example` leaves it unset).
- `-p 127.0.0.1:8787:8787` publishes the port on the host's loopback only, for the reverse proxy
  of the next section. Docker publishes ports through its own iptables chain, which the host's
  firewall does not filter, so a port published without the address (on every interface) would
  expose the API, and the admin token's plain-HTTP routes, to the internet whatever `ufw` or
  `firewalld` allow. A proxy that runs as another container joins the Compose network instead
  and reaches `depthwatch:8787` directly, with no published port at all.
- `-v depthwatch-data:/data` keeps the database in a named volume that outlives the container.
  The entrypoint starts as root only to `chown` `/data` to the `node` user, then runs as that
  user for good (`setpriv` with no new privileges and an empty capability bounding set, so a
  compromised process cannot regain root through a setuid binary), so a bind mount
  (`-v /srv/depthwatch:/data`) should be a directory dedicated to Depthwatch: its files change
  owner. Under `--user node` (`user:` in Compose) the entrypoint skips the chown: the directory
  and its files must already belong to `node`, or `start` refuses the database.
- `--restart unless-stopped` brings the server back after a crash or a reboot. `--stop-timeout 10`
  (`stop_grace_period: 10s`, Docker's default) gives `docker stop` 10 seconds before SIGKILL,
  more than the 8 seconds of `DEPTHWATCH_SHUTDOWN_GRACE` the server takes at most to end the step
  in flight, close the database and exit 0.
- The image's health check asks `GET /api/health?maxAge=3600` every 30 seconds (after a
  5-minute start period, which covers the first pass on an empty database; three failures in a
  row mark the container `unhealthy` in `docker ps`, and an orchestrator restarts it). It fails
  when the process is down, the database cannot be read, or the newest snapshot is more than an
  hour old (two default passes), so a stalled pipeline shows up as `unhealthy`; the response's
  `snapshotAgeSeconds` and the `done` lines in the logs say how far behind it is. An operator who
  raises `DEPTHWATCH_SNAPSHOT_INTERVAL` above 30 minutes overrides the check (`healthcheck:` in
  Compose) with a `maxAge` of about twice the interval.
- The container's `depthwatch` entrypoint takes the other commands too, for the ones that only
  touch the database: `docker compose exec -u node depthwatch depthwatch mm list` (`docker exec
  -u node depthwatch depthwatch mm list` without Compose). `docker exec` defaults to root; `-u
  node` runs the command as the server's own user, so it never needs the root start-up path and
  creates no root-owned file in `/data`. Do not run the live commands (`snapshot`, `volume`,
  `mm sample`, …) beside `start`: it runs them on its schedule, and every extra run adds snapshots
  and samples between passes (a row for a block already stored is skipped), each one more sample
  in streaks, uptime and persistence. `discover --seed` is the one live command that is safe
  beside `start`: it writes pools only, no snapshots or samples, and the snapshot step writes back
  only each pool's fee, so a seed that lands during a snapshot keeps its write.

## A reverse proxy with TLS

Expose the server only through a reverse proxy that terminates TLS (Caddy, nginx, a platform's
load balancer). `DEPTHWATCH_ADMIN_TOKEN` is a bearer token: `POST /api/mm` and `DELETE
/api/mm/:id` send it in the `Authorization` header, which plain HTTP shows to everyone on the
path. The image's commands above publish the port on `127.0.0.1` for that reason: the proxy on
the host reaches `http://127.0.0.1:8787`, nothing else does. Set `DEPTHWATCH_PUBLIC_URL` to the
proxy's address so the links the server prints are the public ones. The token must be at least 32
characters (`openssl rand -hex 32`); `depthwatch` refuses a shorter one as a usage error (exit
code 2) before it starts. Rate limits belong in the proxy too: the server has none. It logs one
`request` line per request (method, path without the query string, status, milliseconds) and an
`admin request refused` warning for every `401` on the write routes, with the reason (`missing
token` or `wrong token`) and the peer address, which behind the proxy is the proxy's own; the
proxy's access log has the client.

## Settings

Everything is an environment variable (a `./.env` file in the working directory works too, see
[.env.example](../.env.example)). For Alchemy's free tier and Base's public RPC:

```sh
DEPTHWATCH_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<key>   # every read but eth_getLogs
DEPTHWATCH_LOGS_RPC_URL=https://mainnet.base.org                 # eth_getLogs only
DEPTHWATCH_DB=/var/lib/depthwatch/depthwatch.db                  # on a disk that survives restarts
DEPTHWATCH_PUBLIC_URL=https://depthwatch.example                 # the site's public address
```

The API key stays in the URL and the URL is never logged: error messages keep only its origin.
Keep `DEPTHWATCH_LOG_CHUNK` at its default of 2,000 blocks, what Base's public RPC accepts (its
`eth_getLogs` page, read on 5 November 2026, still says to keep ranges under 2,000 blocks); since
Denim's 200 ms blocks that is 400 s of chain a request.

The schedule, with its defaults (durations take `90s`, `30m`, `6h`, `1d`; a plain number is
seconds):

| Variable                        | Default | What it sets                                                          |
| ------------------------------- | ------- | --------------------------------------------------------------------- |
| `DEPTHWATCH_SNAPSHOT_INTERVAL`  | `30m`   | Time between passes; each pass snapshots and scores.                  |
| `DEPTHWATCH_VOLUME_INTERVAL`    | `1h`    | Time between volume runs.                                             |
| `DEPTHWATCH_POSITIONS_INTERVAL` | `6h`    | Time between LP position runs; `off` disables them.                   |
| `DEPTHWATCH_POSITIONS_BUDGET`   | `10m`   | Longest a positions run starts new work.                              |
| `DEPTHWATCH_DISCOVER_BUDGET`    | `15m`   | Longest factory-log discovery runs per pass; `off` keeps to the seed. |
| `DEPTHWATCH_SHUTDOWN_GRACE`     | `8s`    | How long SIGTERM waits for the step in flight.                        |

Each has a flag of the same name for `start` (`--snapshot-interval 1h`), except the grace period.
`DEPTHWATCH_TOP_POOLS` (default 200) is the other lever: snapshot cost grows with the pools
tracked. `DEPTHWATCH_KEEP_DAYS` (default 30) bounds the disk ([Disk](#disk)).

## The logs endpoint

`eth_getLogs` (discovery, volume, positions) goes to `DEPTHWATCH_LOGS_RPC_URL`, everything else to
`DEPTHWATCH_RPC_URL`. Since Denim's activation at block 53,556,127 (5 November 2026, 18:00:01 UTC)
Base makes a block every 200 ms instead of every 2 s
([research/base-contracts.md §2.13](research/base-contracts.md#213-block-schedule-denims-200-ms-blocks-2026-11-05)):
18,000 blocks an hour, 432,000 a day. A whole 24 h volume window of 200 ms blocks is 432,000 to
450,000 blocks per event source (216 to 225 requests each at 2,000-block chunks); a later pass
reads the hour that held the previous head and the blocks since, at most about 36,000 blocks per
source for `start`'s hourly run (18 requests at 2,000) and about 19,500 for a 5-minute `run` (10).
Alchemy's free tier serves log ranges of 10 blocks only: keeping volume current there takes at
least 43,200 requests per source a day, about 130,000 for the three sources, some 9.7 M compute
units a day at 75 per `eth_getLogs`, so the tier's 30 M units a month would last about three days.
The logs go elsewhere:
- **Base's public RPC**, `https://mainnet.base.org`, needs no sign-up and has no monthly quota. It
  accepts 2,000-block spans and allows about 5 requests a second per IP address, so the server
  needs its own outbound IP: on hosts whose traffic leaves from shared addresses, neighbours use up
  that limit and every request is answered HTTP 429. Base's documentation describes the public
  endpoint as not meant for production.
- **Tenderly's public gateway**, `https://gateway.tenderly.co/public/base`, needs no key either. It
  serves at most 1,001 blocks (`toBlock` − `fromBlock` = 1,000) and 20,000 results per
  `eth_getLogs` (its documentation says 3,000), and 1 GB of answers a day per IP address, then
  HTTP 429 with JSON-RPC error -32005 (<https://docs.tenderly.co/node-rpc/overview.md>, "Public
  endpoint limits"). Its documentation calls public endpoints rate-limited and points production
  use to a dedicated node (<https://docs.tenderly.co/platform/supported-networks.md>). It refuses
  a range over either limit with -32602 `invalid params` and the reason in the error's `data`,
  which the reader reads: a span is split to 1,000 blocks, too many results halved. Set
  `DEPTHWATCH_LOG_CHUNK=1000` for Base's 200 ms blocks, and 250 for a scan of busy windows of the
  2 s blocks before Denim: the busiest 400 blocks of 28-29 October 2026 (800 s of 2 s blocks) held
  12,916 swaps of about 0.9 KB each, more than the 10 MiB answer viem accepts (a larger answer is
  halved too, at the cost of the request). 1,000 blocks of 200 ms are 200 s of chain, a quarter of
  that window's time: at that window's swap rate about 3,200 swaps, some 3 MB (inferred, not
  measured on 200 ms blocks). Until 6 November 2026 18:00 UTC a 24 h window still starts in 2 s
  blocks, where a busy 1,000-block chunk can pass either cap and is halved. The Refresh site
  workflow uses 1,000 ([A free static copy](#a-free-static-copy)).
- **If the server's address gets HTTP 429** all the time (`eth_getLogs backoff reason=rate-limit`
  warnings that never stop), use a keyed endpoint that accepts at least 2,000-block ranges, or set
  `DEPTHWATCH_LOG_CHUNK` to the largest range it accepts (a provider capped at 1,000 blocks:
  `DEPTHWATCH_LOG_CHUNK=1000`, or less where busy windows pass its result or answer-size cap, as on
  Tenderly's gateway above). The first full discovery can still be run against the public RPC.

## Following it

Logs go to stderr, one line per event, which a host's log viewer shows as they come. Every step
ends with one `done` line: its duration, its result and the requests it sent, with Alchemy's
compute units estimated:

```
INFO  [snapshot] done ms=19021 … pools=580 tracked=200 snapshots=200 … requests=528 main=528 logs=0 alchemyCu=13718
INFO  [volume] done ms=9120 … requests=9 main=3 logs=6 alchemyCu=48
```

These lines predate Denim (they were added on 27 October 2026): the same hours are now ten times
the blocks, so a volume pass sends up to ten times the `eth_getLogs`.

The first line of each UTC day totals the day before and projects a 30-day month at that rate:

```
INFO  daily total day=2026-10-25 requests=26300 main=25820 logs=480 alchemyCu=665000 alchemyCuMonthPace=19950000 alchemyFreeTierPct=67
```

`alchemyFreeTierPct` above 100 means the month will run out: set `DEPTHWATCH_SNAPSHOT_INTERVAL=1h`
or lower `DEPTHWATCH_TOP_POOLS`. Errors are `ERROR` lines naming the step; a logs endpoint that
cannot serve the chunk size says how to fix it.

## Data

The database is one SQLite file in WAL mode, with `-wal` and `-shm` files beside it while it is
open. Keep the directory on persistent disk (the `/data` volume of the image). Deleting the
database starts over from the seed.

### Disk

Snapshots are the bulk of the file: about 1.4 KB per pool per pass, so 200 tracked pools every
30 minutes add about 13 MB a day (every 5 minutes with `run`, about 80 MB). Once a day, at the
end of a pass, the server deletes snapshots and hourly volume older than `DEPTHWATCH_KEEP_DAYS`
(default 30 days; snapshots keep at least 8, the dashboard's 7-day windows plus a day), scorecard
samples older than 35 days and alerts older than 90 (each mandate's newest delivered alert is
kept), then checkpoints the WAL; the same runs on
demand as `depthwatch prune` (`docker compose exec -u node depthwatch depthwatch prune`,
database only, safe beside `start`). At the defaults the file settles around 400 MB for 200
pools (`run` at 5 minutes: around 2.5 GB), plus the WAL's size between checkpoints. SQLite reuses
the freed pages rather than shrinking the file; `VACUUM` (with the server stopped, or `VACUUM
INTO` a copy as in [Backups](#backups)) compacts it when that matters.

### Backups

While the server runs, its latest writes sit in `depthwatch.db-wal` and `depthwatch.db-shm`
beside the file, so copying the `.db` file of a running server, or the three files one after the
other, gives an inconsistent copy. Take a hot backup through SQLite instead, which writes a
consistent snapshot while the server keeps going; the target file must not exist yet:

```sh
# On the host, with the sqlite3 CLI and the directory at hand (a bind mount or a bare install):
sqlite3 /srv/depthwatch/depthwatch.db ".backup /srv/backups/depthwatch-$(date +%F).db"
# In the container, with Node's own SQLite (the image has no sqlite3 CLI), then copied out:
docker compose exec -u node depthwatch node -e "
  const { DatabaseSync } = require('node:sqlite')
  new DatabaseSync('/data/depthwatch.db', { readOnly: true }).exec(\"VACUUM INTO '/data/backup.db'\")
"
docker compose cp depthwatch:/data/backup.db "./depthwatch-$(date +%F).db"
docker compose exec -u node depthwatch rm /data/backup.db
```

Node prints a warning that its SQLite module is experimental; the copy is complete. A plain copy
of the three files is sound only while the server is stopped. A backup restores by replacing the
`.db` file while the server is stopped, with no `-wal` or `-shm` file beside it. The restored
file must be writable by the user the server runs as: the image's entrypoint hands `/data` to
`node` when the container starts as root; under `--user node`, or on a bare install, `chown` a
file copied as root yourself, or `start` exits with `database is not writable`.

## A free static copy

Without a server, `.github/workflows/refresh-site.yml` publishes a static copy of the dashboard to
Cloudflare Pages about every three hours, at no cost: a GitHub runner restores the database from
the Actions cache, runs `discover --seed`, `snapshot`, `volume`, `score` and `prune`, saves the
database back, exports the bundle and uploads the static build. The copy has every page and the
agent documents, but no API (`/api/…` routes answer 404, and there is no scorecard registration)
and no data newer than its last run; each page says when it was read and, because the workflow
exports with `--updates several-times-a-day`, that the site is updated several times a day (its
freshness dot turns Tan once the data is more than 8 hours old). It suits a public site while no
server runs. This repository's copy has been at <https://depthwatch.pages.dev> since
29 October 2026; the workflow is scheduled at minute 23 of every third hour (UTC).
1. **Cloudflare.** Create a free account. Note the Account ID (Workers & Pages, right-hand
   column) and create an API token: My Profile, API Tokens, Create Token, Create Custom Token,
   with the permission Account, Cloudflare Pages, Edit.
2. **GitHub.** In the repository, Settings, Secrets and variables, Actions, add three repository
   secrets: `DEPTHWATCH_RPC_URL` (a Base mainnet endpoint, for example Alchemy's with its key),
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. `DEPTHWATCH_LOGS_RPC_URL` is optional: the
   `volume` step sends `eth_getLogs` to it first, then to Tenderly's public gateway
   ([The logs endpoint](#the-logs-endpoint)).
3. **First run.** Actions, Refresh site, Run workflow (on `main`). The first run seeds the pools of
   the reference tokens and of the tokenized stocks, creates the Pages project `depthwatch` and
   publishes it. Its publish step prints the site's address (`It will be available at
   https://depthwatch.pages.dev/`, with a suffix when that name is taken). The `Take a peek over
   at https://<id>.depthwatch.pages.dev` line of every run is that run's own deployment, which
   never changes: share the address without the `<id>.` part. This repository's first run, on 29 October 2026, took about 28 minutes in all.
   The seed took 24 of them: 644 pools from 4,060 candidate pairs of the 15 reference tokens, about
   14,600 requests to date them, with Alchemy's free tier throttling the runner's bursts (2,360
   rate-limit backoffs, each retried). The same seed took 631 s on 28 October 2026
   ([Measured on Base](../README.md#measured-on-base-2026-10-28)). The snapshot of the 200 tracked
   pools took 63 seconds, the build and upload about 15 seconds. Later runs are expected to take a
   few minutes: pools already stored keep their creation block, so the seed costs only the factory
   reads.

**Tokenized stocks.** Every run's seed also asks each DEX for the pools of the ten tokenized stocks
of base.org/stocks with the reference tokens, never of two stocks: 6,200 calls, about 13 multicalls
more ([Seeded discovery](ARCHITECTURE.md#seeded-discovery-factory-views-and-archive-state)). The
first run once the stocks change is on `main` finds their pools and dates each once, a binary
search of about 26 requests a pool; later runs pay only the factory reads. Every snapshot then
reads the ten stocks at its block, one multicall of 60 calls on `DEPTHWATCH_RPC_URL` (the
Chainlink feeds are read onchain, from no data vendor), and tracks every stock pool ranked at
$10,000 or more besides the 200. The copy's Stocks pages and stock pool pages show them with the
eligibility line (Coinbase tokenized stocks are only available to persons in eligible jurisdictions
outside of the U.S.), which the footer of the Stocks pages and of a stock's token page repeats; no
stock enters the swap panel. No new
secret or variable is needed. The readings are never pruned: ten rows a run, about 30,000 a year
([stocks.md §4](design/stocks.md#4-pipeline-appscli)).

Each run snapshots the 200 tracked pools and the stock pools (about 14,000 Alchemy compute units
for the 200, so about 3.4 M a month at eight runs a day) and keeps 8 days of history
(`DEPTHWATCH_KEEP_DAYS=8`). The `volume` step sends
`eth_getLogs` to the optional secret `DEPTHWATCH_LOGS_RPC_URL` first, at 2,000-block chunks for at
most 300 s, then to Tenderly's public gateway at 1,000-block chunks (250 before 5 November 2026) for
at most 420 s. The database persists between runs, so a run reads the three hours since the last one
and the part of the hour before them that held the last run's head: 54,000 to 72,000 blocks per
event source since Denim, 54 to 72 requests each at 1,000-block chunks. The first run after the
change that finds blocks by time (5 November 2026) reads a whole 24 h window once when the saved
database holds coverage from after Denim's activation ([Upgrading](#upgrading)): at most 450 requests per source at 1,000 (432 to 450 once the window is
all 200 ms blocks), about 1,350 for the three. At the pace measured below (45,000 blocks per source
at 400-block chunks, some 340 requests for three sources, in 78 s) that is about 310 s, inside the
420 s; this is inferred, not measured. Should it not fit, every run reads the whole window again,
since a killed pass stores nothing, until one succeeds. Each try is a fresh process, killed with
everything it started once its time is up; a killed pass stores nothing. If both fail, the step
fails alone: the copy is still published, and the score keeps the last complete 24 h window until it
is a day old. On 29 October 2026 the step sent its logs to Base's public RPC, which refused the
runner's first `eth_getLogs` (JSON-RPC error -32011, `request limit reached`) and all eight retries,
so the first copy was published with no 24 h volume and an empty gaps feed. That RPC allows 5
`eth_getLogs` a second per IP address and runners share addresses, so the workflow no longer tries
it. The gateway needs no key. Measured from outside GitHub on 29 October 2026, on 2 s blocks before
Denim, it served a first volume pass for 200 pools (25 h of blocks, 45,000) in 78 s at 400-block
chunks, at the CLI's own pace (6 requests rate-limited and retried), and 12 h for 552 pools in 255
requests at 250-block chunks, none refused, with the measuring script spacing requests at least 1 s
apart. At the CLI's own pace the 250-block pass is untested, as is any pass over 200 ms blocks at
1,000-block chunks, and from a runner the gateway is untested. Its documentation calls public
endpoints rate-limited and not for production: if the step fails often, set
`DEPTHWATCH_LOGS_RPC_URL` to a keyed endpoint, such as Ankr's Freemium plan (3,000-block ranges,
<https://www.ankr.com/docs/rpc-service/service-plans/>) or Infura (10,000 results per request,
<https://docs.infura.io/reference/base/json-rpc-methods/eth_getlogs>). A run that cannot restore a
saved database stops without publishing or saving, so a passing cache error never replaces the
history; only when no saved database exists (the first run, or every entry evicted after 7 days
unread) does a run seed again and start the history over. A run that ends with no pools at all
publishes nothing.

In a public repository, as this one is, GitHub disables a scheduled workflow after 60 days without
repository activity, such as a push: the copy then stays at its last run, and 7 days later its
database is evicted. Actions, Refresh site, Enable workflow starts it again. The `pages.dev`
address is the free one. A domain of your own is registered and paid for separately; add it in the
Pages project (Custom domains) before creating any DNS record: a subdomain then needs a CNAME
record to the `pages.dev` address at its DNS host, and an apex domain needs its nameservers on
Cloudflare.

**The site's address in link previews.** A link to the copy, pasted into a chat, a wallet's browser
or a social post, unfolds into a card with a title, a description and a picture (`og.png`), read
from tags the static build writes into `index.html`. Those tags need absolute addresses, so the
build takes the site's address from `VITE_SITE_URL` and uses <https://depthwatch.pages.dev/> when
it is unset, which is what the workflows publish to today; nothing needs setting. When the site
moves to a domain of its own, set `VITE_SITE_URL=https://<your domain>/` in the environment of the
"Build the static site" step of the Refresh site, Trade switch and Trade preview workflows (or
change `DEFAULT_SITE_URL` in `apps/web/plugins/siteMeta.ts`). The server build carries no such
tags: it does not know the address it will be served from.

Repository secrets reach workflow runs started from this repository's own branches, never a pull
request from a fork; only people with write access can start those, and this workflow publishes
only from `main`.

The build ships `apps/web/public/_headers`, the response headers Cloudflare Pages applies: no
page may be framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), no type sniffing, and a
Content-Security-Policy that runs only the site's own scripts and the inline script of
`index.html` by its hash and lets pages fetch from the site itself only. Every build fails when
that hash and the inline script differ, or when the file opens a URL pattern in more than one
block: Pages was seen to serve only the last of them ([Trade preview (the live
test)](#trade-preview-the-live-test)). The same file sets caching: the build's scripts and styles
under `/assets/`, whose names change with their content, may be kept a year (`immutable`); the
fonts under `/fonts/`, whose names stay, a month; every other file is checked with Pages on each
visit, so a new copy shows at once; and `data/flags.json` is never cached. Pages joins the values
of one header from every rule that matches a path, so each path gets its `Cache-Control` from one
rule only (`apps/web/plugins/securityHeaders.test.ts` checks it). `depthwatch serve` does not send these headers, and the
server build leaves the file out. A Pages feature that adds a script to the pages, such as
Cloudflare Web Analytics, would be blocked by this policy: leave it off, or add its host to the
policy.

## Trade switch

The static copy's swap panel is off unless the repository variable `DEPTHWATCH_TRADE` turns it
on. `depthwatch export` writes the switch twice: into the bundle (`features.trade`) and next to
it as `data/flags.json`, which the site serves with `Cache-Control: no-store`. A page reads the
first when it loads and fetches the second again when its swap panel connects and just before
every signature request, and offers a swap only when both are on for the pool's DEX, so switching
off also stops pages already open.
A missing or unreadable switch counts as off.

| `DEPTHWATCH_TRADE`                | Switch                                           |
| --------------------------------- | ------------------------------------------------ |
| unset, empty or `off`             | Off (the default)                                |
| `uniswap-v3`                      | On for Uniswap v3 pools                          |
| `uniswap-v3,aerodrome-slipstream` | On for Uniswap v3 and Aerodrome Slipstream pools |

Any other value is refused, including `aero-slipstream` while its routes are on hold in
`packages/chain/src/addresses.ts`. A refused value fails closed: `depthwatch export` writes the
switch off and exits with code 3, the workflow publishes the site with trading off, and then the
run fails, so a mistyped `off` still switches off and the failure is still seen. The limits,
$1,000 per swap and at most 3 % slippage, are set in the code, not by the variable.

On 8 November 2026 the production site's switch was turned on for Uniswap v3 and Aerodrome
Slipstream: `DEPTHWATCH_TRADE` was set to `uniswap-v3,aerodrome-slipstream` and a Trade switch run
published it, after which <https://depthwatch.pages.dev/data/flags.json> served `"enabled":true`
with both venues, `"maxUsd":1000` and `"maxSlippageBps":300`. The live test before it covered the
smart-wallet path only: the extension-wallet half of the third condition of
[Before switching on](#before-switching-on) was not run live and rests on the fork test
([The live test](#the-live-test)). That file, not this page, says what the site serves now.

### Before switching on

Trading ships switched off. Until all three of these hold, the only values to use are unset (the
default) or `off`, apart from a live test on the production site as the third allows:
- The wording is still switch-agnostic, so switching on needs no release of its own. README.md,
  AGENTS.md, DESIGN.md, the non-goals of docs/ROADMAP.md, the scope of SECURITY.md and
  docs/ARCHITECTURE.md describe the swap panel as optional and off unless switched on, and none
  says the dashboard talks only to `/api`; the API's agent documents say only the API is
  read-only; and the dashboard footer says the panel is on and non-custodial when the switch the
  page loaded with is on for a venue whose route is not on hold, and read-only otherwise (a page
  already open keeps its footer until it reloads). `apps/cli/src/tradeSwitch.test.ts` and
  `apps/web/src/components/shell/Footer.test.tsx` check this.
- The fork test has passed for every venue to be listed: each venue and direction, ETH in and
  out, against a local fork of Base, never in CI; it runs outside the repository.
- The live test has passed: small swaps on Base mainnet from a Cloudflare Pages preview with
  trading on (production off), in an extension wallet and a smart wallet, each checked on
  Basescan (the router, the exact approval, the Builder Code at the end of the input or of the
  user operation); the steps and the checklist are in
  [Trade preview (the live test)](#trade-preview-the-live-test). A wallet whose browser blocks the
  preview address, as the Base App's did, makes its swaps on the production site instead, with the
  same checks: Trade switch turns the switch on there for the venues under test, for the length of
  the test only, and off again right after it ([The live test](#the-live-test)). While it is on,
  anyone can use the production site's swap panel, within the limits set in the code.

Flipping the variable needs no code release, so nothing in the code enforces this list: whoever
changes the variable checks it.

### The live test

The live test ran on 5 November 2026, from 00:19 to 00:22 UTC (blocks 53,524,299 to 53,524,395,
2 s blocks before Denim), with the Base App: a smart wallet, an EIP-7702 account that sends
ERC-4337 user operations through EntryPoint v0.6 (`0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789`),
so each transaction below is a bundle (`handleOps`) sent to the EntryPoint with the account's user
operation inside it. It ran on the production site, <https://depthwatch.pages.dev>, with the
switch on for about an hour, not on the preview: the Base App's in-app browser blocked the preview
address ([Trade preview (the live test)](#trade-preview-the-live-test)). Each venue got one round
trip of 0.001 ETH (about $2.4) in one WETH/USDC pool: ETH in, then the USDC received back to ETH
through the ERC-20 approve path, an approval of exactly that USDC before the swap.

| #   | Venue                | Transaction               | What it did                                                                   |
| --- | -------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| 1   | Uniswap v3           | [0xbe1188f2…2739][live-1] | 0.001 ETH in, 2.425229 USDC out (minimum 2.423016)                            |
| 2   | Uniswap v3           | [0x3b791828…d352][live-2] | Approval of exactly 2.425229 USDC to SwapRouter02                             |
| 3   | Uniswap v3           | [0xd08031fe…dc2f][live-3] | 2.425229 USDC in, 0.000998786820554117 ETH out (minimum 0.000997788053190322) |
| 4   | Aerodrome Slipstream | [0x486e1ce1…21cc][live-4] | 0.001 ETH in, 2.427474 USDC out (minimum 2.425046)                            |
| 5   | Aerodrome Slipstream | [0xbdfaf67c…00fd][live-5] | Approval of exactly 2.427474 USDC to the gauges-v3 router                     |
| 6   | Aerodrome Slipstream | [0xce2529cd…c00d][live-6] | 2.427474 USDC in, 0.000999467168059571 ETH out (minimum 0.000998500383434827) |

[live-1]: https://basescan.org/tx/0xbe1188f2c926e60a91368f8ddfc0c70e42a79bce3695268b7544f090228c2739
[live-2]: https://basescan.org/tx/0x3b7918280838420a98cb29bdb295bf2c6c33a987bb123067006a7ab0ad03d352
[live-3]: https://basescan.org/tx/0xd08031fe197a52fe05ab5400c88cf6491a7d7ad1fa2982639ca08c0c25d8dc2f
[live-4]: https://basescan.org/tx/0x486e1ce14bc72e8c9a124e5bcd6c60b0cda3e26e6bca8751e17d0364c1c021cc
[live-5]: https://basescan.org/tx/0xbdfaf67cfd0adfe023bf003c6277d392d4a3d910c2388d008b778dd0d0e400fd
[live-6]: https://basescan.org/tx/0xce2529cd55ee896b1f805ac1610b5711cf668bca6fcbcb8460f0a3adc271c00d

The Uniswap v3 pool is WETH/USDC at 0.05 %
([`0xd0b53d92…a798f224`](https://basescan.org/address/0xd0b53d9277642d899df5c87a3966a349a798f224)),
traded through SwapRouter02: swap 1 calls `multicall(deadline, [exactInputSingle, refundETH])`,
and swap 3 has the WETH paid to the router, which `unwrapWETH9` then pays to the account as ETH.
The Aerodrome Slipstream pool is WETH/USDC at tick spacing 50
([`0x3fe04a59…eb59392a`](https://basescan.org/address/0x3fe04a59ebd38cf06080a6f60a98d124eb59392a)),
traded through the router of the gauges-v3 deployment: swap 6 calls `multicall` with
`exactInputSingle` to the router and `unwrapWETH9` to the account. Approval 2 came in a bundle
that also held another account's user operation. Every transaction and user operation succeeded.
What was checked:
- **Router.** Every swap went to the router that `TRADE_ROUTES` gives the pool's venue and
  deployment (README, [Swap panel](../README.md#the-dashboard)).
- **Approvals.** Both name that router as spender for exactly the swap's input amount, and the
  allowance was 0 again after the swap.
- **Amounts.** Each ETH-in swap received exactly what the venue's quoter quoted one block before
  its inclusion. Each minimum is 0.1 % under the quote the review showed (the 0.1 % slippage
  preset was chosen). The account's ETH and USDC balances moved as expected.
- **Builder Code.** The `callData` of each of the six user operations ends with one ERC-8021
  suffix carrying two codes, `bc_j6obesn8` and `bc_mnip`:
  `0x62635f6a366f6265736e382c62635f6d6e6970130080218021802180218021802180218021`, that is the
  codes `bc_j6obesn8,bc_mnip`, their length (`0x13`, 19), the schema (`00`) and the marker. The panel
  hands its suffix to a smart wallet through the `dataSuffix` capability of `wallet_sendCalls`,
  and the Base App merged it with its own code (`bc_mnip`) into one suffix, so Depthwatch's
  29-byte suffix does not appear verbatim in them. A search for the transactions attributed to
  `bc_j6obesn8` must therefore decode the ERC-8021 suffix at the end of each user operation's
  `callData` (or of a transaction's input) and look for the code among its codes: matching the
  29 bytes misses every transaction of a wallet that merges. The panel's read-back
  (`apps/web/src/trade/readBack.ts`) decodes such a suffix, and the swap's Details report the code
  when it is one of the suffix's codes.

Not covered live: an extension wallet, a plain account to which the panel sends
`eth_sendTransaction` with the suffix at the end of the transaction's own input. That path rests on
the fork test of each venue, direction and ETH in and out. No pool but these two was traded, and
no swap went to the routers of Aerodrome Slipstream's `initial` and `gauge-caps` deployments.

### Changing the switch

To change it from a phone, in a browser signed in to GitHub (these steps have not yet been tried
on a phone):
1. In the repository: Settings, Secrets and variables, Actions, the Variables tab.
2. To switch off, delete `DEPTHWATCH_TRADE`, which needs no typing, or set it to `off`. To switch
   on, once everything in [Before switching on](#before-switching-on) holds, set it to the
   venues, for example `uniswap-v3`.
3. Actions, Trade switch, Run workflow on `main`. The run downloads the published bundle, changes
   only the switch, builds and publishes, and turns green only once
   <https://depthwatch.pages.dev/data/flags.json> serves the new value (`"enabled":false` when
   off). It uses the two Cloudflare secrets and no RPC endpoint. How long it takes has not been
   measured.
4. If the run fails, its log says why. A refused value has been published as off. A failure in
   Check the published switch comes after the publish, so the new switch may already be served:
   open <https://depthwatch.pages.dev/data/flags.json> before running again. A failure in any
   earlier step published nothing. Correct the variable and run it again, or run Refresh site.

Without step 3, the next Refresh site run, within about three hours, publishes the new value: both
workflows read the same variable. Trade switch shares Refresh site's concurrency group, so it waits
for a refresh in progress and then downloads that run's copy. If there is any doubt about what the
site serves, run Refresh site instead, which rebuilds the bundle from the saved database rather
than from the published copy. Should GitHub Actions be down, Cloudflare's dashboard can roll the
Pages project back to an earlier deployment (Workers & Pages, the project, Deployments); this has
not been tried.

### Trade preview (the live test)

The Trade preview workflow (`.github/workflows/trade-preview.yml`) publishes the static copy to a
Cloudflare Pages preview of the same project, <https://trade-preview.depthwatch.pages.dev>, with
the trade switch taken from the run's `venues` input: `off`, `uniswap-v3`, `aerodrome-slipstream`
or `uniswap-v3,aerodrome-slipstream`. It never reads the repository variable `DEPTHWATCH_TRADE`.
Like Trade switch, it downloads the published `data/bundle.json`, changes only the switch, builds
and uploads, but always with `--branch trade-preview`: the production site,
<https://depthwatch.pages.dev>, is untouched, and Refresh site and Trade switch publish only
`--branch main`, so they never change the preview. Wrangler publishes the production site when the
branch it is given is the project's production branch, so before uploading the run reads that
branch through Cloudflare's API and stops unless it is `main`; after uploading, it fails if
Cloudflare made anything but a preview deployment, or if
<https://depthwatch.pages.dev/data/flags.json> does not serve `"enabled":false`, whatever the
input: it is a test for while the production switch is off. A refused value publishes nothing.
It has its own concurrency group, so it does not wait for Refresh site, and two previews never
publish at once.

The preview adds `X-Robots-Tag: noindex, nofollow` on every path: the build step inserts it into
the one `/*` block of the built `_headers`, right after that line, and leaves every other line as
built, so every other header, the Content-Security-Policy included, is the production site's. The
step fails, publishing nothing, unless the file has exactly one line `/*`. On its first run (4
November 2026) the workflow appended a second `/*` block instead, and Pages did not join the two:
the preview served that block's `X-Robots-Tag` but neither the Content-Security-Policy nor the
`X-Frame-Options` of the first, which the production site serves from the same file. Cloudflare
documents that the headers of different rules matching a path are joined; that a block replaces an
earlier one with the same pattern was seen on Pages, not documented. So the static build fails when
`_headers` opens a URL pattern twice, and after each upload the run checks the headers the preview
serves: `/` and `/data/flags.json` must be served the Content-Security-Policy and `X-Frame-Options`
of the built `/*` block, exactly, and an `X-Robots-Tag` with `noindex`, or the run fails.

Each deployment also has an address of its own, `https://<id>.depthwatch.pages.dev` (in the run's
summary and in the public log of its publish step), which keeps the switch it was built with until
the deployment is deleted. So once the preview serves the run's build (its `index.html` and
`data/flags.json`), the run deletes every earlier `trade-preview` deployment through Cloudflare's
API and fails if one is left; its own deployment, which the preview address points to, stays.

Steps 1, 2 and 4 work from a phone, in a browser signed in to GitHub; the extension-wallet half of
step 3 needs a computer:
1. Actions, Trade preview, Run workflow on `main`; under "Trade switch of the preview; off
   switches it off again", pick the venues to test, for example `uniswap-v3`, and Run workflow.
2. The run turns green once <https://trade-preview.depthwatch.pages.dev> serves its build, its
   switch and its security headers, the earlier deployments are deleted and the production site
   still serves the switch off. Its summary gives the preview's address, the switch, the run's own
   deployment address and the number of earlier deployments deleted.
3. Open <https://trade-preview.depthwatch.pages.dev> in each wallet's browser and go through the
   checklist below. A wallet whose browser blocks the preview, as the Base App's did, is tested on
   the production site instead ([Before switching on](#before-switching-on)).
4. Right after the test, run Trade preview again with `off`: while the preview is on, anyone with
   its address can use its swap panel, within the limits set in the code. That run serves the
   switch off and deletes the deployment that had it on; its summary says none is left.
5. If the run fails, its log says why, and the step that failed says what was published:
   - **Check settings** to **Build the static site** (the secrets, the published bundle, a refused
     value, a bundle with no pools, the build, a built `_headers` without exactly one line `/*`):
     nothing was published. Correct it and run again.
   - **Check the production branch**: nothing was published. If the log names a branch other than
     `main`, set the project's production branch back to `main`: a Direct Upload project changes
     it only through Cloudflare's API (a `PATCH` of the project with
     `{"production_branch": "main"}`, as Cloudflare's Direct Upload page shows), from a computer.
   - **Publish to the preview**: the upload may or may not have reached Cloudflare; read the
     production check below, then run again.
   - **Check it is a preview**: if Cloudflare made a production deployment, the production site
     may serve this build with trading on. Run Trade switch at once with `DEPTHWATCH_TRADE` unset,
     until <https://depthwatch.pages.dev/data/flags.json> serves `"enabled":false`, then set the
     production branch back to `main` as above. For any other failure here, see the next item.
   - **Check the preview's switch**: if the log says the preview is serving this build without its
     security headers, a failed run leaves the preview deployed: it serves this build and its
     switch without the headers the log names, and nothing was deleted. Switch it off at once by
     running Trade preview again with `off`. If that run fails the same way, the preview serves the
     switch off, still without those headers, and the earlier deployments keep the switch they were
     built with: delete them by hand, as in the next item, and run nothing but `off` until the
     cause is found. Otherwise the run could not show that the preview address serves this build
     (Pages may not serve the alias for this project, or gave another, which the log names), and
     nothing was deleted. The run's own deployment address, in its summary, serves the build;
     a run with `off` then fails the same way, so delete the deployments by hand, as in the next
     item.
   - **Delete the earlier previews**: an earlier deployment is still there, with the switch it
     was built with. Delete it in Cloudflare's dashboard (Workers & Pages, the project,
     Deployments) or, from a computer, with
     `wrangler pages deployment delete <id> --project-name depthwatch`, which asks first. Keep the
     latest `trade-preview` deployment, which the preview address points to; `--force` would
     delete that one too.
   - **Check the production switch is off**: open <https://depthwatch.pages.dev/data/flags.json>.
     If it does not serve `"enabled":false` while `DEPTHWATCH_TRADE` is unset or `off`, run Trade
     switch now and check that the project's production branch is `main`. While the variable
     switches production on, as it has since 8 November 2026 ([Trade switch](#trade-switch)), this
     step fails every run by design, after the preview was published and the earlier previews
     deleted; for a run that turns green, such as the live test of a further venue, switch
     production off first.

The live test, for each venue to be listed, with small amounts, from a browser-extension wallet
and from a smart wallet (Base App):
- a swap with ETH in and a swap with ETH out, the two directions of one pool;
- an ERC-20 approve path: a swap whose input is an ERC-20 the wallet has not approved for the
  router, so the panel asks for an approval first (the ETH-out swap is one when its token has no
  allowance).

Each transaction is checked on Basescan:
- **Router.** The swap goes to the router that `TRADE_ROUTES` (`packages/chain/src/addresses.ts`)
  gives the pool's venue and factory: the transaction's `To` for an extension wallet. For a smart
  wallet the transaction is a bundle (`handleOps`) sent to the EntryPoint, with the user operation
  inside it: on the transaction's page, More details, Input Data, Decode Input Data; in `ops`, the
  fourth field of the user operation, after `sender`, `nonce` and `initCode`, is its `callData`:
  the account's own call (such as `execute`), which holds the router's address (without `0x`).
- **Approval.** The approval names that router as spender for exactly the swap's input amount.
- **Builder Code.** The transaction's input, or for a smart wallet the `callData` of its user
  operation, ends with `0x62635f6a366f6265736e380b0080218021802180218021802180218021`, the ERC-8021
  suffix of `bc_j6obesn8` (`apps/web/src/trade/builderCode.ts`): its last 58 hex digits. The
  approval carries it too. A wallet with a code of its own may merge the two into one suffix, as
  the Base App did: those 58 hex digits are then absent, and the codes of the suffix at the end
  include `bc_j6obesn8` ([The live test](#the-live-test)).

Seen on the first run (4 November 2026): Pages serves the alias `trade-preview.depthwatch.pages.dev`
for this project, as Cloudflare documents for every branch of a Direct Upload project, and
Cloudflare's API gives `main` as the project's `result.production_branch` (the upload went ahead,
which it does only then). The preview served `X-Robots-Tag: noindex, nofollow`, and
`Cache-Control: no-store` on `/data/flags.json`, but the appended `/*` block replaced the first one
instead of joining it, so neither the Content-Security-Policy nor `X-Frame-Options` was served
(`Referrer-Policy` and `X-Content-Type-Options: nosniff`, which Pages sends by default, were). The
run now inserts the header into the one `/*` block, and the served headers are checked after each
upload. Still unverified: the other answers the run's checks read, from the `environment` and
`alias` wrangler records for the deployment to the listing and deletion of deployments (their
pages, and the refusal to delete the deployment an alias points to); whether a preview serves
`index.html` as built (the production site did on 4 November 2026); how long a run takes; how
Basescan shows a user operation; and these steps on a phone. Cloudflare can also limit previews to
the account (the project's Settings, General, Enable access policy); whether that covers the alias
and works in a wallet's browser is unverified too.

Seen during the live test (5 November 2026): the Base App's in-app browser blocked
<https://trade-preview.depthwatch.pages.dev> with "This site has been blocked and flagged as
potentially dangerous", while it opened <https://depthwatch.pages.dev> with a warning. Neither
address was on MetaMask's eth-phishing-detect list, which holds over 14,000 `*.pages.dev` entries,
or flagged by Google Safe Browsing at the time. That wallet's swaps were made on the production
site instead ([The live test](#the-live-test)).

## Upgrading

A new build migrates the database when it first opens it, and an older build then refuses the
file (`database schema version 8 is newer than this build (7); upgrade depthwatch`) before any
step runs. Take a backup ([Backups](#backups)) before upgrading if you may need to roll back:
rolling back means restoring that backup.

The upgrade that stores tokenized stocks (schema version 8): the migration adds the `stocks` and
`stock_readings` tables and a stock pool's reference to each snapshot
([docs/design/stocks.md](design/stocks.md) §5). It rewrites no stored row: snapshots stored before
it carry no reference.

The upgrade that finds blocks by time (5 November 2026, Denim's 200 ms blocks; no schema change):
- Earlier builds counted 2 s blocks (1,800 an hour) back from the head, so from Denim's block
  53,556,127 on their volume passes read too few blocks: the hours they stored after it are
  short. The first volume pass of this build ignores a pool's coverage that ends at or after that
  block (the database has no `volume:windows` mark yet) and reads its whole 24 h window again:
  432,000 to 450,000 blocks per event source once the window is all 200 ms blocks, 216 to 225
  requests each at the default 2,000-block chunks. Later passes are back to their usual size.

The upgrade that indexes Aero's venues (schema version 7, which stores the fee each snapshot
used):
- `start` covers every DEX by default, now six. A server started with an explicit `--dex` list
  sees nothing new until `aero-v2` and `aero-slipstream` are added to it.
- The two new DEXes have no seed cursor, so the next pass seeds their pools of the reference
  tokens (and of `DEPTHWATCH_SEED_TOKENS`) before anything else; factory-log discovery then scans
  their factories from their first block over the following passes.
- The first volume pass after their pools are tracked reads 24 h for the two event sources they
  share with Uniswap v3 and Aerodrome v2 once (the new pools have no volume yet); later passes
  are back to their usual size.
- A snapshot that fails a pool with `swap hook changed`, `initial fee enabled` or `fee module
  changed` found an Aero contract set up differently from the reviewed one, and publishes nothing
  for that pool rather than depth modelled on the old setup. Its log line (`pool configuration
  changed; not snapshotted`) names the remedy in `fix`:
  - `swap hook changed`, `initial fee enabled`: review the change against
    [docs/research/base-contracts.md](research/base-contracts.md), then run `depthwatch discover
    --seed` (with Compose, through `docker compose exec -u node depthwatch`). It reads the hook of
    every stored Aero Slipstream pool again, seeded pair or not, and stores a pool off the
    reviewed setup as hooked: the next snapshots publish its price without depth (`hooked`), and
    a pool whose initial fee was turned off is modelled again.
  - `fee module changed`: an Aero v2 factory points at another fee module. The reviewed module is
    pinned in code (`aeroV2.volatileFeeModule` / `stableFeeModule` in
    `packages/chain/src/addresses.ts`, recorded in docs/research/base-contracts.md), so review the
    new module and run a build that pins it. `discover --seed` does not help: seeding and log
    discovery of `aero-v2` fail the same way until then, while the other DEXes run on.
