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
  following passes, in about half a day. A mandate registered on a pool whose LP positions are
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
Keep `DEPTHWATCH_LOG_CHUNK` at its default of 2,000 blocks, what Base's public RPC accepts.

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
`DEPTHWATCH_RPC_URL`. Alchemy's free tier serves log ranges of 10 blocks only, and keeping volume
current there would cost more than its monthly units, so the logs go elsewhere:
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
  `DEPTHWATCH_LOG_CHUNK=250`: the busiest 400 blocks of 28-29 October 2026 held 12,916 swaps of
  about 0.9 KB each, more than the 10 MiB answer viem accepts (a larger answer is halved too, at
  the cost of the request). The Refresh site workflow uses it
  ([A free static copy](#a-free-static-copy)).
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
and no data newer than its last run; each page says when it was read. It suits a public site
while no server runs. This repository's copy has been at <https://depthwatch.pages.dev> since
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
   the reference tokens, creates the Pages project `depthwatch` and publishes it. Its publish step
   prints the site's address (`It will be available at https://depthwatch.pages.dev/`, with a
   suffix when that name is taken). The `Take a peek over at https://<id>.depthwatch.pages.dev`
   line of every run is that run's own deployment, which never changes: share the address without
   the `<id>.` part. This repository's first run, on 29 October 2026, took about 28 minutes in all.
   The seed took 24 of them: 644 pools from 4,060 candidate pairs of the 15 reference tokens, about
   14,600 requests to date them, with Alchemy's free tier throttling the runner's bursts (2,360
   rate-limit backoffs, each retried). The same seed took 631 s on 28 October 2026
   ([Measured on Base](../README.md#measured-on-base-2026-10-28)). The snapshot of the 200 tracked
   pools took 63 seconds, the build and upload about 15 seconds. Later runs are expected to take a
   few minutes: pools already stored keep their creation block, so the seed costs only the factory
   reads.

Each run snapshots the 200 tracked pools (about 14,000 Alchemy compute units, so about 3.4 M a month
at eight runs a day) and keeps 8 days of history (`DEPTHWATCH_KEEP_DAYS=8`). The `volume` step sends
`eth_getLogs` to the optional secret `DEPTHWATCH_LOGS_RPC_URL` first, at 2,000-block chunks for at
most 300 s, then to Tenderly's public gateway at 250-block chunks for at most 420 s. Each try is a
fresh process, killed with everything it started once its time is up; a killed pass stores
nothing. If both fail, the step fails alone: the copy is still published, and the score keeps
the last complete 24 h window until it is a day old. On 29 October 2026 the step sent its logs to
Base's public RPC, which refused the runner's first `eth_getLogs` (JSON-RPC error -32011,
`request limit reached`) and all eight retries, so the first copy was published with no 24 h volume
and an empty gaps feed. That RPC allows 5 `eth_getLogs` a second per IP address and runners share
addresses, so the workflow no longer tries it. The gateway needs no key. Measured from outside
GitHub on 29 October 2026, it served a first volume pass for 200 pools (25 h of blocks) in 78 s at
400-block chunks, at the CLI's own pace (6 requests rate-limited and retried), and 12 h for 552
pools in 255 requests at 250-block chunks, none refused, with the measuring script spacing requests
at least 1 s apart. At the CLI's own pace the 250-block pass is untested, and from a runner the
gateway is untested. Its documentation calls public endpoints rate-limited and not for production:
if the step fails often, set `DEPTHWATCH_LOGS_RPC_URL` to a keyed endpoint, such as Ankr's Freemium
plan (3,000-block ranges, <https://www.ankr.com/docs/rpc-service/service-plans/>) or Infura (10,000
results per request, <https://docs.infura.io/reference/base/json-rpc-methods/eth_getlogs>). A run
that cannot restore a saved database stops without publishing or saving, so a passing cache error
never replaces the history; only when no saved database exists (the first run, or every entry
evicted after 7 days unread) does a run seed again and start the history over. A run that ends with
no pools at all publishes nothing.

In a public repository, as this one is, GitHub disables a scheduled workflow after 60 days without
repository activity, such as a push: the copy then stays at its last run, and 7 days later its
database is evicted. Actions, Refresh site, Enable workflow starts it again. The `pages.dev`
address is the free one. A domain of your own is registered and paid for separately; add it in the
Pages project (Custom domains) before creating any DNS record: a subdomain then needs a CNAME
record to the `pages.dev` address at its DNS host, and an apex domain needs its nameservers on
Cloudflare.
Repository secrets reach workflow runs started from this repository's own branches, never a pull
request from a fork; only people with write access can start those, and this workflow publishes
only from `main`.

The build ships `apps/web/public/_headers`, the response headers Cloudflare Pages applies: no
page may be framed (`X-Frame-Options: DENY`, `frame-ancestors 'none'`), no type sniffing, and a
Content-Security-Policy that runs only the site's own scripts and the inline script of
`index.html` by its hash and lets pages fetch from the site itself only. Every build fails when
that hash and the inline script differ. `depthwatch serve` does not send these headers, and the
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

### Before switching on

Trading ships switched off. Until all three of these hold, the only values to use are unset (the
default) or `off`:
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
  [Trade preview (the live test)](#trade-preview-the-live-test).

Flipping the variable needs no code release, so nothing in the code enforces this list: whoever
changes the variable checks it.

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
The preview adds `X-Robots-Tag: noindex, nofollow` on every path; every other header, the
Content-Security-Policy included, is the production site's. It has its own concurrency group, so
it does not wait for Refresh site, and two previews never publish at once.

Each deployment also has an address of its own, `https://<id>.depthwatch.pages.dev` (in the run's
summary and in the public log of its publish step), which keeps the switch it was built with until
the deployment is deleted. So once the preview serves the run's build (its `index.html` and
`data/flags.json`), the run deletes every earlier `trade-preview` deployment through Cloudflare's
API and fails if one is left; its own deployment, which the preview address points to, stays.

Steps 1, 2 and 4 work from a phone, in a browser signed in to GitHub; the extension-wallet half of
step 3 needs a computer:
1. Actions, Trade preview, Run workflow on `main`; under "Trade switch of the preview; off
   switches it off again", pick the venues to test, for example `uniswap-v3`, and Run workflow.
2. The run turns green once <https://trade-preview.depthwatch.pages.dev> serves its build and
   switch, the earlier deployments are deleted and the production site still serves the switch
   off. Its summary gives the preview's address, the switch, the run's own deployment address and
   the number of earlier deployments deleted.
3. Open <https://trade-preview.depthwatch.pages.dev> in each wallet's browser and go through the
   checklist below.
4. Right after the test, run Trade preview again with `off`: while the preview is on, anyone with
   its address can use its swap panel, within the limits set in the code. That run serves the
   switch off and deletes the deployment that had it on; its summary says none is left.
5. If the run fails, its log says why, and the step that failed says what was published:
   - **Check settings** to **Build the static site** (the secrets, the published bundle, a refused
     value, a bundle with no pools, the build): nothing was published. Correct it and run again.
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
   - **Check the preview's switch**: the run could not show that the preview address serves this
     build (Pages may not serve the alias for this project, or gave another, which the log names),
     and nothing was deleted. The run's own deployment address, in its summary, serves the build;
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
     switch now and check that the project's production branch is `main`.

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
  approval carries it too.

Unverified until a first run: whether Pages serves the alias `trade-preview.depthwatch.pages.dev`
for this project (Cloudflare documents an alias for every branch of a Direct Upload project;
without one the run fails at Check the preview's switch); the answers the run's checks read, none
of which has yet come from Cloudflare itself: the project's `result.production_branch`, the
`environment` and `alias` wrangler records for the deployment, and the listing and deletion of
deployments (their pages, and the refusal to delete the deployment an alias points to); whether a
preview serves `index.html` as built (the production site did on 4 November 2026); the header
served: Cloudflare documents that `_headers` overrides what it ordinarily sends, so the preview
should send `X-Robots-Tag: noindex, nofollow` in place of the `noindex` it adds to previews, but
that has not been seen; how long a run takes; how Basescan shows a user operation; and these steps
on a phone. Cloudflare can also limit previews to the account (the project's Settings, General,
Enable access policy); whether that covers the alias and works in a wallet's browser is unverified
too.

## Upgrading

A new build migrates the database when it first opens it, and an older build then refuses the
file (`database schema version 7 is newer than this build (6); upgrade depthwatch`) before any
step runs. Take a backup ([Backups](#backups)) before upgrading if you may need to roll back:
rolling back means restoring that backup.

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
