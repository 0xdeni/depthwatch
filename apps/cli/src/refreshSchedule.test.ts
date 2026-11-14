/**
 * The schedule of Refresh site (docs/DEPLOY.md, "A free static copy"). GitHub starts scheduled
 * runs late or skips them, so the workflow asks every hour and its first job, `due`, lets a
 * scheduled run refresh only when the last refresh that published started at least 150 minutes
 * ago and no other refresh is running or waiting. A run by hand always refreshes; a check that
 * cannot read GitHub's API, or fails, refreshes too. Only the refresh job joins the concurrency
 * group it shares with Trade switch, so a check that is not due never replaces a run waiting in
 * it. The check's script runs here as the workflow runs it, against a server on 127.0.0.1 that
 * answers as GitHub's REST API does, or fails as it might.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  blockUnder,
  cronsOf,
  jobIds,
  jobOf,
  nodeScripts,
  nonBlank,
  read,
  stepOf,
  workflow,
} from './testing/workflowText.js'

const REFRESH = workflow('refresh-site.yml')
const SWITCH = workflow('trade-switch.yml')
const DUE = jobOf(REFRESH, 'due')
const JOB = jobOf(REFRESH, 'refresh')
const STEP = stepOf(REFRESH, 'Check the last refresh')
const PUBLISH = 'Publish to Cloudflare Pages'
const CHECK = nodeScripts(STEP)[0]?.script ?? ''
const settings = (lines: string[]) => nonBlank(lines).filter((line) => !line.startsWith('#'))

describe('the schedule of Refresh site', () => {
  it('asks every hour at minute 23, and runs by hand', () => {
    expect(cronsOf(REFRESH)).toEqual(['23 * * * *'])
    const triggers = blockUnder(REFRESH, 'on:').filter((line) => /^ {2}\S/.test(line))
    expect(triggers).toEqual(['  schedule:', '  workflow_dispatch:'])
  })

  it('decides first, in a cheap job that only reads the runs, with no secret', () => {
    expect(jobIds(REFRESH)).toEqual(['due', 'refresh'])
    expect(DUE).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m)
    expect(DUE).toContain('timeout-minutes: 5')
    expect(settings(blockUnder(DUE, 'permissions:'))).toEqual(['actions: read'])
    expect(settings(blockUnder(DUE, 'outputs:'))).toEqual([`due: $\{{ steps.check.outputs.due }}`])
    expect(DUE).not.toContain('uses:')
    expect(DUE).not.toContain('secrets.')
    expect(settings(blockUnder(STEP, 'env:'))).toEqual([`GITHUB_TOKEN: $\{{ github.token }}`])
    expect(nodeScripts(STEP)).toEqual([{ script: CHECK, args: '' }])
  })

  it('refreshes only from main, when due or when the check gave no answer, unless cancelled', () => {
    expect(JOB).toMatch(/^ {4}name: refresh$/m)
    expect(JOB).toMatch(/^ {4}needs: due$/m)
    expect(JOB).toMatch(
      /^ {4}if: github\.ref == 'refs\/heads\/main' && !cancelled\(\) && needs\.due\.outputs\.due != 'false'$/m,
    )
    // Unchanged: the run's permissions, and secrets in the refresh only.
    expect(settings(blockUnder(REFRESH, 'permissions:'))).toEqual([
      'contents: read',
      'actions: read',
    ])
    const secrets = REFRESH.split('\n').filter((line) => line.includes('secrets.'))
    expect(secrets.length).toBeGreaterThan(0)
    for (const line of secrets) expect(JOB, line).toContain(line)
  })

  it('puts only the refresh in the group it shares with Trade switch, not the check', () => {
    // GitHub keeps one run waiting per group and cancels the one already waiting when another
    // joins: a check that joined and was not due would cancel a waiting switch and publish nothing.
    expect(REFRESH).not.toMatch(/^concurrency:/m)
    expect(DUE).not.toContain('concurrency:')
    const group = ['group: refresh-site', 'cancel-in-progress: false']
    expect(settings(blockUnder(JOB, 'concurrency:'))).toEqual(group)
    expect(JOB).toMatch(/^ {4}concurrency:$/m)
    expect(SWITCH).toMatch(/^concurrency:$/m)
    expect(settings(blockUnder(SWITCH, 'concurrency:'))).toEqual(group)
  })

  it('counts a refresh that published or is on its way, at least 150 minutes old', () => {
    expect(CHECK).toContain('const MIN_MINUTES = 150')
    expect(CHECK).toContain('const due = minutes >= MIN_MINUTES')
    expect(CHECK).toContain('"/workflows/refresh-site.yml/runs?branch=main&per_page=20"')
    expect(CHECK).toContain(`const PUBLISH = "${PUBLISH}"`)
    expect(CHECK).toContain('step.name === PUBLISH && step.conclusion === "success"')
    expect(CHECK).toContain('if (process.env.GITHUB_EVENT_NAME !== "schedule") {')
    // One deadline for every request, inside the job's 5 minutes.
    expect(CHECK).toContain('const deadline = AbortSignal.timeout(180000)')
    expect(CHECK).toContain('signal: deadline,')
    // The step the check looks for is the refresh's upload, and the step that fails a refused
    // trade switch comes after it.
    const publish = stepOf(JOB, PUBLISH)
    expect(publish).toContain('wrangler pages deploy apps/web/dist-static')
    expect(JOB.indexOf('- name: Fail on a refused trade switch')).toBeGreaterThan(
      JOB.indexOf(`- name: ${PUBLISH}`),
    )
  })
})

describe('the check, against a GitHub API on 127.0.0.1', () => {
  /**
   * How a run's refresh job went: skipped (the check said not due), published and passed,
   * published and then failed (a refused trade switch), failed before publishing, still running,
   * or waiting to run; each as GitHub lists the job, with its steps.
   */
  const step = (name: string, conclusion: string) => ({ name, status: 'completed', conclusion })
  const snapshot = step('Snapshot', 'success')
  const REFRESH_JOBS = {
    skipped: { status: 'completed', conclusion: 'skipped', steps: [] },
    published: {
      status: 'completed',
      conclusion: 'success',
      steps: [snapshot, step(PUBLISH, 'success')],
    },
    'published-then-failed': {
      status: 'completed',
      conclusion: 'failure',
      steps: [
        snapshot,
        step(PUBLISH, 'success'),
        step('Fail on a refused trade switch', 'failure'),
      ],
    },
    failed: {
      status: 'completed',
      conclusion: 'failure',
      steps: [snapshot, step('Score', 'failure'), step(PUBLISH, 'skipped')],
    },
    running: { status: 'in_progress', conclusion: null, steps: [] },
    waiting: { status: 'queued', conclusion: null, steps: [] },
  }
  /** A run of the workflow: when its refresh job started, how it went, and whether its check is done. */
  interface Run {
    id: number
    minutesAgo: number
    refresh: keyof typeof REFRESH_JOBS
    checking?: boolean
  }
  let runs: Run[] = []
  let requests: IncomingMessage[] = []
  /** Overrides the answer to the requests whose path matches. */
  let failing: { path: RegExp; status: number; body: string } | undefined
  const ago = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
  const server = createServer((request, response) => {
    requests.push(request)
    const path = request.url ?? ''
    const answer = (status: number, body: string) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(body)
    }
    if (failing?.path.test(path)) return answer(failing.status, failing.body)
    if (path.startsWith('/repos/acme/depthwatch/actions/workflows/refresh-site.yml/runs?')) {
      const listed = runs.map(({ id }) => ({ id, html_url: `https://github.test/runs/${id}` }))
      return answer(200, JSON.stringify({ total_count: runs.length, workflow_runs: listed }))
    }
    const run = runs.find(({ id }) => path === `/repos/acme/depthwatch/actions/runs/${id}/jobs`)
    if (run === undefined) return answer(404, '{"message":"Not Found"}')
    const started = ago(run.minutesAgo)
    const due = run.checking
      ? { name: 'due', status: 'in_progress', conclusion: null, started_at: started }
      : { name: 'due', status: 'completed', conclusion: 'success', started_at: started }
    const jobs = [due, { name: 'refresh', started_at: started, ...REFRESH_JOBS[run.refresh] }]
    return answer(200, JSON.stringify({ total_count: 2, jobs }))
  })
  let api = ''
  const dir = mkdtempSync(join(tmpdir(), 'depthwatch-due-'))
  const output = join(dir, 'output')

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })
  beforeEach(() => {
    runs = []
    requests = []
    failing = undefined
    writeFileSync(output, '')
  })

  /** Runs the script as the step does; what it printed and the `due` it wrote. */
  const check = (event: string, url = api) =>
    new Promise<{ code: number | null; out: string; due: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', CHECK], {
        env: {
          ...process.env,
          NO_PROXY: '127.0.0.1',
          no_proxy: '127.0.0.1',
          GITHUB_EVENT_NAME: event,
          GITHUB_API_URL: url,
          GITHUB_REPOSITORY: 'acme/depthwatch',
          GITHUB_TOKEN: 'token-for-tests',
          GITHUB_OUTPUT: output,
        },
      })
      let out = ''
      child.stdout.on('data', (chunk) => {
        out += chunk
      })
      child.stderr.on('data', (chunk) => {
        out += chunk
      })
      child.on('error', reject)
      child.on('close', (code) => {
        const due = readFileSync(output, 'utf8')
        resolve({ code, out, due })
      })
    })

  it('always refreshes a run by hand, without asking the API', async () => {
    runs = [{ id: 1, minutesAgo: 5, refresh: 'published' }]
    expect(await check('workflow_dispatch')).toEqual({
      code: 0,
      out: 'A run by hand always refreshes.\n',
      due: 'due=true\n',
    })
    expect(requests).toEqual([])
  })

  it('refreshes a scheduled run from 150 minutes after the last refresh started', async () => {
    runs = [{ id: 7, minutesAgo: 149, refresh: 'published' }]
    const early = await check('schedule')
    expect(early.due).toBe('due=false\n')
    expect(early.out).toBe(
      'The last refresh that published started 149 minutes ago (https://github.test/runs/7): not due before 150 minutes; the next hourly check asks again.\n',
    )
    runs = [{ id: 7, minutesAgo: 150, refresh: 'published' }]
    writeFileSync(output, '')
    const due = await check('schedule')
    expect(due.due).toBe('due=true\n')
    expect(due.out).toBe(
      'The last refresh that published started 150 minutes ago (https://github.test/runs/7): due.\n',
    )
  })

  it('passes over this run and the runs that were not due, whose refresh was skipped', async () => {
    runs = [
      { id: 10, minutesAgo: 0, refresh: 'waiting', checking: true },
      { id: 9, minutesAgo: 30, refresh: 'skipped' },
      { id: 8, minutesAgo: 90, refresh: 'skipped' },
      { id: 7, minutesAgo: 151, refresh: 'published' },
      { id: 6, minutesAgo: 330, refresh: 'published' },
    ]
    const result = await check('schedule')
    expect(result.due).toBe('due=true\n')
    expect(result.out).toContain('started 151 minutes ago (https://github.test/runs/7)')
    expect(requests.map((request) => request.url)).toEqual([
      '/repos/acme/depthwatch/actions/workflows/refresh-site.yml/runs?branch=main&per_page=20',
      '/repos/acme/depthwatch/actions/runs/10/jobs',
      '/repos/acme/depthwatch/actions/runs/9/jobs',
      '/repos/acme/depthwatch/actions/runs/8/jobs',
      '/repos/acme/depthwatch/actions/runs/7/jobs',
    ])
    for (const request of requests) {
      expect(request.headers.authorization).toBe('Bearer token-for-tests')
      expect(request.headers.accept).toBe('application/vnd.github+json')
    }
    runs[3] = { id: 7, minutesAgo: 120, refresh: 'published' }
    writeFileSync(output, '')
    expect((await check('schedule')).due).toBe('due=false\n')
  })

  it('counts a refresh that published and then failed, as on a refused trade switch', async () => {
    runs = [
      { id: 6, minutesAgo: 30, refresh: 'published-then-failed' },
      { id: 5, minutesAgo: 180, refresh: 'published' },
    ]
    expect(await check('schedule')).toMatchObject({
      due: 'due=false\n',
      out: expect.stringContaining('started 30 minutes ago (https://github.test/runs/6): not due'),
    })
  })

  it('does not count a refresh that failed before publishing, so the next check tries again', async () => {
    runs = [
      { id: 6, minutesAgo: 30, refresh: 'failed' },
      { id: 5, minutesAgo: 151, refresh: 'published' },
    ]
    expect(await check('schedule')).toMatchObject({
      due: 'due=true\n',
      out: expect.stringContaining('started 151 minutes ago (https://github.test/runs/5): due.'),
    })
  })

  it('does not start a second refresh while one runs or waits to run', async () => {
    for (const refresh of ['running', 'waiting'] as const) {
      runs = [
        { id: 10, minutesAgo: 0, refresh: 'waiting', checking: true },
        { id: 9, minutesAgo: 2, refresh },
        { id: 8, minutesAgo: 200, refresh: 'published' },
      ]
      writeFileSync(output, '')
      expect(await check('schedule'), refresh).toEqual({
        code: 0,
        out: 'A refresh is running or waiting to run (https://github.test/runs/9): not due.\n',
        due: 'due=false\n',
      })
    }
    // A run whose own check has not finished yet may still decide not to refresh.
    runs = [
      { id: 9, minutesAgo: 1, refresh: 'waiting', checking: true },
      { id: 8, minutesAgo: 200, refresh: 'published' },
    ]
    writeFileSync(output, '')
    expect((await check('schedule')).due).toBe('due=true\n')
  })

  it('refreshes when no listed run has a refresh that published', async () => {
    runs = [
      { id: 4, minutesAgo: 20, refresh: 'skipped' },
      { id: 3, minutesAgo: 80, refresh: 'failed' },
    ]
    expect(await check('schedule')).toMatchObject({
      code: 0,
      out: 'None of the last 2 runs on main has a refresh that published: due.\n',
      due: 'due=true\n',
    })
  })

  it('refreshes, with a warning, when the API fails or answers something else', async () => {
    runs = [{ id: 7, minutesAgo: 10, refresh: 'published' }]
    const cases: Array<[NonNullable<typeof failing>, string]> = [
      [{ path: /\/runs\?/, status: 500, body: '{}' }, 'answered HTTP 500'],
      [{ path: /\/jobs$/, status: 403, body: '{}' }, 'answered HTTP 403'],
      [{ path: /\/runs\?/, status: 200, body: 'not json' }, 'not valid JSON'],
      [{ path: /\/runs\?/, status: 200, body: '{}' }, 'the list of runs holds no workflow_runs'],
      [{ path: /\/jobs$/, status: 200, body: '{"jobs":null}' }, 'run 7 lists no jobs'],
    ]
    for (const [answer, reason] of cases) {
      failing = answer
      writeFileSync(output, '')
      const result = await check('schedule')
      expect(result, reason).toMatchObject({ code: 0, due: 'due=true\n' })
      expect(result.out, reason).toMatch(
        /^::warning::Could not read the last refresh \(.*\); refreshing anyway\.\n$/,
      )
      expect(result.out, reason).toContain(reason)
    }
  })

  it('refreshes, with a warning, when the API does not answer at all', async () => {
    const closed = createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`
    await new Promise((resolve) => closed.close(resolve))
    const result = await check('schedule', url)
    expect(result).toMatchObject({ code: 0, due: 'due=true\n' })
    expect(result.out).toMatch(
      /^::warning::Could not read the last refresh \(.+\); refreshing anyway\.\n$/,
    )
  })
})

describe('the refresh in README.md and docs/DEPLOY.md', () => {
  const flat = (...path: string[]) => read(...path).replace(/\s+/g, ' ')

  it('says it checks every hour and refreshes once the last refresh is 2.5 hours old', () => {
    for (const path of [['README.md'], ['docs', 'DEPLOY.md'], ['AGENTS.md']]) {
      const text = flat(...path)
      const name = path.join('/')
      expect(text, name).toContain('every hour')
      expect(text, name).toContain('at least 2.5 hours old')
      expect(text, name).not.toMatch(
        /(publishes|replaced by) (a new copy|a new one|a static copy)[^.]* about every three hours/,
      )
    }
    const deploy = flat('docs', 'DEPLOY.md')
    expect(deploy).toContain('GitHub can start scheduled runs late or skip them')
    expect(deploy).toContain('median gap of 7.3 hours')
    expect(deploy).not.toContain('every third hour (UTC)')
  })

  it('says which refresh counts, what a failed one costs, and how a waiting switch is replaced', () => {
    const deploy = flat('docs', 'DEPLOY.md')
    expect(deploy).toContain(
      'A refresh counts once its publish step has succeeded, even if a later step fails, as on a refused trade switch; one that fails before publishing does not count, so the next hourly check tries again.',
    )
    expect(deploy).toContain(
      'Only the refresh job joins the concurrency group it shares with Trade switch, so a check that is not due never takes the place of a run waiting there.',
    )
    // The ceiling holds only while refreshes publish; a failure after the snapshot repeats hourly.
    expect(deploy).not.toContain('at most about 4 M, since refreshes are')
    expect(deploy).toContain('While refreshes publish, they are at least 2.5 hours apart')
    expect(deploy).toContain('is tried again at every hourly check: up to about 10 M units a month')
    expect(deploy).toContain(
      "Trade switch shares the concurrency group of Refresh site's refresh job",
    )
    expect(deploy).toContain('A run shown as cancelled was replaced while it waited')
    expect(deploy).toContain(
      'Until a refused value is corrected, every refresh of Refresh site also publishes the switch off and fails.',
    )
    expect(flat('.github', 'workflows', 'trade-switch.yml')).toContain(
      '# its next refresh publishes the same switch.',
    )
  })

  it('wraps the paragraphs on the refresh and on the shared group at 100 columns', () => {
    const lines = read('docs', 'DEPLOY.md').split('\n')
    for (const opening of [
      '**When it runs.**',
      'Without step 3, the next refresh of Refresh site',
    ]) {
      const start = lines.findIndex((line) => line.startsWith(opening))
      expect(start, opening).toBeGreaterThan(0)
      const end = lines.indexOf('', start)
      const paragraph = lines.slice(start, end)
      expect(paragraph.length, opening).toBeGreaterThan(3)
      expect(paragraph.filter((line) => line.length > 100)).toEqual([])
    }
  })
})
