/**
 * The Trade preview workflow (docs/DEPLOY.md, "Trade preview (the live test)"): it publishes the
 * static copy to the Cloudflare Pages branch `trade-preview` with the trade switch from its
 * `venues` input, and never the production site, which only Refresh site and Trade switch publish
 * (`--branch main`). Its headers, the noindex one it adds and the security headers it checks
 * after the upload, are in `tradePreviewHeaders.test.ts`.
 */
import { tradeOff } from '@depthwatch/core'
import { describe, expect, it } from 'vitest'
import {
  actionsOf,
  blockUnder,
  choiceOptions,
  deployBranches,
  nonBlank,
  PRODUCTION_PUBLISHERS,
  read,
  runScripts,
  stepOf,
  WORKFLOWS,
  workflow,
} from './testing/workflowText.js'
import { parseTradeSwitch, switchableVenues } from './tradeSwitch.js'

const PREVIEW = workflow('trade-preview.yml')
const at = (text: string) => PREVIEW.indexOf(text)

/** The steps that stop the run when they fail: none may be skipped or softened. */
const GUARDS = [
  'Check settings',
  'Set the trade switch',
  'Check the bundle',
  'Check the production branch',
  'Publish to the preview',
  'Check it is a preview',
  "Check the preview's switch",
  'Delete the earlier previews',
]

/** An `if (…) {` block of a script that ends the process with code 1. */
const exitsIn = (condition: string) =>
  new RegExp(`if \\(${condition}\\) \\{\\n[^}]*process\\.exit\\(1\\)\\n\\s*\\}`)

describe('the Trade preview workflow', () => {
  it('offers off, each venue the switch can turn on, and all of them, defaulting to off', () => {
    const options = choiceOptions(PREVIEW)
    expect(options).toEqual([
      'off',
      'uniswap-v3',
      'aerodrome-slipstream',
      'uniswap-v3,aerodrome-slipstream',
    ])
    expect(options).toEqual(['off', ...switchableVenues(), switchableVenues().join(',')])
    expect(parseTradeSwitch(options[0])).toEqual(tradeOff())
    for (const option of options.slice(1))
      expect(parseTradeSwitch(option)).toMatchObject({ enabled: true, venues: option.split(',') })
    const input = nonBlank(blockUnder(PREVIEW, 'venues:'))
    expect(input).toContain('type: choice')
    expect(input).toContain('default: "off"')
  })

  it('takes the switch from its input, through the environment of the export step only', () => {
    expect(PREVIEW).not.toContain('vars.')
    expect(PREVIEW).not.toContain('DEPTHWATCH_TRADE }}')
    expect(PREVIEW).not.toContain('github.event.inputs')
    const uses = PREVIEW.split('\n').filter((line) => line.includes('inputs.venues'))
    expect(uses).toHaveLength(2)
    expect(uses[0]).toMatch(/^run-name: Trade preview \(\$\{\{ inputs\.venues \}\}\)$/)
    const exports = runScripts(PREVIEW).filter((script) => script.includes('depthwatch export'))
    expect(exports).toHaveLength(1)
    expect(PREVIEW).not.toContain('trade_refused')
    expect(at('name: Set the trade switch')).toBeLessThan(at('wrangler pages deploy'))
    expect(PREVIEW).toContain('"$SITE_URL/data/bundle.json"')
    // The whole step, so the input can neither move to another step nor a refusal publish.
    expect(stepOf(PREVIEW, 'Set the trade switch').split('\n')).toEqual([
      '      - name: Set the trade switch',
      '        env:',
      `          DEPTHWATCH_TRADE: $\{{ inputs.venues }}`,
      '        run: |',
      '          code=0',
      '          pnpm depthwatch export --bundle "$RUNNER_TEMP/published.json" \\',
      '            --out apps/web/static-data/bundle.json || code=$?',
      '          if [ "$code" = 3 ]; then',
      '            echo "::error::The trade switch \\"$DEPTHWATCH_TRADE\\" was refused (the line above says why); nothing was published."',
      '          fi',
      '          exit "$code"',
    ])
  })

  it('never expands an expression inside a script, in any workflow', () => {
    expect(WORKFLOWS).toContain('trade-preview.yml')
    for (const file of WORKFLOWS)
      for (const script of runScripts(workflow(file))) expect(script, file).not.toMatch(/\$\{\{/)
    // Every block style is read.
    const echo = `          echo $\{{ x }}\n`
    for (const style of ['|', '|-', '>', '>+', ''])
      expect(runScripts(`      - run:${style && ` ${style}`}\n${echo}`)).toEqual([echo])
  })

  it('publishes only the branch trade-preview; Refresh site and Trade switch only main', () => {
    expect(deployBranches(PREVIEW)).toEqual(['trade-preview'])
    expect(PREVIEW).not.toMatch(/--branch[= ]"?main/)
    expect(PREVIEW).not.toContain('project create')
    expect(PREVIEW).not.toContain('--production-branch')
    for (const file of PRODUCTION_PUBLISHERS) {
      expect(deployBranches(workflow(file)), file).toEqual(['main'])
      expect(workflow(file), file).not.toContain('trade-preview')
    }
    // No other workflow publishes.
    const publishers = WORKFLOWS.filter((file) => workflow(file).includes('wrangler'))
    expect(publishers.sort()).toEqual([...PRODUCTION_PUBLISHERS, 'trade-preview.yml'].sort())
    for (const upload of ['pages deploy', 'pages publish', 'pages project upload'])
      expect(deployBranches(`    run: wrangler ${upload} dist --branch "$X"`)).toEqual(['"$X"'])
  })

  it('runs by hand from main only, as Trade switch does, with the same pinned actions', () => {
    expect(nonBlank(blockUnder(PREVIEW, 'on:'))[0]).toBe('workflow_dispatch:')
    const triggers = blockUnder(PREVIEW, 'on:').filter((line) => /^ {2}\S/.test(line))
    expect(triggers).toEqual(['  workflow_dispatch:'])
    expect(PREVIEW).toMatch(/^ {4}if: github\.ref == 'refs\/heads\/main'$/m)
    expect(PREVIEW.match(/^[ \t]*permissions:/gm)).toEqual(['permissions:'])
    expect(nonBlank(blockUnder(PREVIEW, 'permissions:'))).toEqual(['contents: read'])
    expect(nonBlank(blockUnder(PREVIEW, 'concurrency:'))).toEqual([
      'group: trade-preview',
      'cancel-in-progress: false',
    ])
    expect(PREVIEW).toContain('timeout-minutes: 15')
    const pinned = actionsOf(workflow('trade-switch.yml'))
    expect(actionsOf(PREVIEW)).toEqual(pinned)
    expect(pinned.every((action) => /@[0-9a-f]{40} # v\d/.test(action))).toBe(true)
    for (const tool of ['node-version: "24"', 'pnpm@10.28.0', 'wrangler@4.150.0'])
      expect(PREVIEW, tool).toContain(tool)
  })

  it('fails the run on every guard, none of which can be skipped or softened', () => {
    expect(PREVIEW).not.toContain('continue-on-error')
    for (const guard of GUARDS) expect(stepOf(PREVIEW, guard), guard).not.toMatch(/^\s+if:/m)
    const branch = stepOf(PREVIEW, 'Check the production branch')
    expect(branch).toMatch(exitsIn('!response\\.ok \\|\\| typeof branch !== "string"'))
    expect(branch).toMatch(exitsIn('branch !== "main"'))
    const preview = stepOf(PREVIEW, 'Check it is a preview')
    expect(preview).toMatch(exitsIn('deploy === undefined'))
    expect(preview).toMatch(exitsIn('deploy\\.environment !== "preview"'))
    expect(preview).toMatch(
      exitsIn('host\\(deploy\\.alias\\) !== host\\(process\\.env\\.PREVIEW_URL\\)'),
    )
    const production = stepOf(PREVIEW, 'Check the production switch is off')
    expect(production).toMatch(/the production switch is unknown\."\n\s*exit 1\n\s*\}/)
    expect(production).toMatch(/does not serve the trade switch off\.[^\n]*"\n\s*exit 1\n\s*fi/)
    const poll = stepOf(PREVIEW, "Check the preview's switch")
    expect(poll).toMatch(/after 2 minutes\."\n\s*exit 1$/)
  })

  it('checks the production branch before publishing, and the production switch after', () => {
    const publish = at('wrangler pages deploy')
    expect(at('name: Check the production branch')).toBeLessThan(publish)
    expect(PREVIEW).toContain('body?.result?.production_branch')
    expect(at('name: Check it is a preview')).toBeGreaterThan(publish)
    expect(PREVIEW).toContain('WRANGLER_OUTPUT_FILE_PATH="$RUNNER_TEMP/wrangler-output.json"')
    expect(at('name: Check the production switch is off')).toBeGreaterThan(publish)
    expect(PREVIEW).toContain('SITE_URL: https://depthwatch.pages.dev')
    expect(PREVIEW).toContain('"$SITE_URL/data/flags.json"')
    expect(PREVIEW).toContain('f?.trade?.enabled === false ? 0 : 1')
    // Whatever failed before it, once something may have been published.
    expect(PREVIEW).toContain("if: always() && steps.publish.outcome != 'skipped'")
  })

  it('polls the preview until it serves this build, and writes a summary', () => {
    expect(PREVIEW).toContain('PREVIEW_URL: https://trade-preview.depthwatch.pages.dev')
    const poll = stepOf(PREVIEW, "Check the preview's switch")
    expect(poll).toContain('want=$(cat apps/web/dist-static/data/flags.json)')
    expect(poll).toContain('"$PREVIEW_URL/data/flags.json"')
    expect(poll).toContain('--output "$RUNNER_TEMP/preview-index.html" "$PREVIEW_URL/"')
    expect(poll).toContain(
      'cmp --silent "$RUNNER_TEMP/preview-index.html" apps/web/dist-static/index.html',
    )
    expect(poll).toContain(`if [ "$got" = "$want" ] && [ "$page" = "this build's" ]; then`)
    expect(PREVIEW).toContain('>> "$GITHUB_STEP_SUMMARY"')
    expect(PREVIEW).toContain('echo "## Trade preview: $switch"')
    expect(PREVIEW).toContain('none is left ($DELETED deleted)')
  })

  it('deletes every earlier trade-preview deployment once the preview serves this build', () => {
    expect(at('name: Delete the earlier previews')).toBeGreaterThan(
      at("name: Check the preview's switch"),
    )
    expect(at('name: Delete the earlier previews')).toBeLessThan(
      at('name: Check the production switch is off'),
    )
    expect(stepOf(PREVIEW, 'Check it is a preview')).toContain('"\\nid=" + deploy.deployment_id')
    const cleanup = stepOf(PREVIEW, 'Delete the earlier previews')
    expect(cleanup).toContain(`DEPLOYMENT_ID: $\{{ steps.deployment.outputs.id }}`)
    expect(cleanup).toContain('"?env=preview&per_page=25&page=" + page')
    expect(cleanup).toContain(
      'deployment.environment === "preview" && branch === "trade-preview" && deployment.id !== own',
    )
    expect(cleanup).toContain('{ method: "DELETE", headers }')
    // Without force, Cloudflare keeps the deployment an alias points to.
    expect(cleanup).not.toContain('force')
    expect(cleanup).toMatch(/const fail = \(message\) => \{\n[^}]*process\.exit\(1\)\n\s*\}/)
    expect(cleanup).toMatch(/if \(!\/\^\[0-9a-f-\]\{36\}\$\/\.test\(own \?\? ""\)\) \{\n\s*fail\(/)
    expect(cleanup).toMatch(
      /if \(!response\.ok \|\| !Array\.isArray\(body\?\.result\)\) \{\n\s*fail\(/,
    )
    expect(cleanup).toMatch(/if \(!response\.ok\) \{\n\s*fail\("Could not delete/)
    expect(cleanup).toMatch(/if \(left\.length > 0\) \{\n\s*fail\(/)
  })
})

describe('docs/DEPLOY.md: Trade preview (the live test)', () => {
  const deploy = read('docs', 'DEPLOY.md')
  const flat = (text: string) => text.replace(/\s+/g, ' ')
  const start = deploy.indexOf('### Trade preview (the live test)')
  const section = flat(deploy.slice(start, deploy.indexOf('## Upgrading')))

  it('follows Changing the switch, and Before switching on links to it', () => {
    expect(start).toBeGreaterThan(deploy.indexOf('### Changing the switch'))
    expect(start).toBeLessThan(deploy.indexOf('## Upgrading'))
    const gates = flat(
      deploy.slice(deploy.indexOf('### Before switching on'), deploy.indexOf('### Changing')),
    )
    expect(gates).toContain('[Trade preview (the live test)](#trade-preview-the-live-test)')
  })

  it('says what it publishes and where, and that production is untouched', () => {
    for (const text of [
      '`.github/workflows/trade-preview.yml`',
      '<https://trade-preview.depthwatch.pages.dev>',
      'It never reads the repository variable `DEPTHWATCH_TRADE`',
      'always with `--branch trade-preview`',
      'the production site, <https://depthwatch.pages.dev>, is untouched',
      'Refresh site and Trade switch publish only `--branch main`',
      'stops unless it is `main`',
      'does not serve `"enabled":false`',
      'A refused value publishes nothing',
      '`X-Robots-Tag: noindex, nofollow`',
      "the run deletes every earlier `trade-preview` deployment through Cloudflare's API and fails if one is left",
    ])
      expect(section, text).toContain(text)
    for (const option of choiceOptions(PREVIEW)) expect(section, option).toContain(`\`${option}\``)
  })

  it('gives the steps, from a phone where it can, and switches off right after the test', () => {
    const label = /^ {8}description: (.+)$/m.exec(PREVIEW)?.[1]
    expect(label).toBe('Trade switch of the preview; off switches it off again')
    for (const text of [
      'Steps 1, 2 and 4 work from a phone',
      'the extension-wallet half of step 3 needs a computer',
      `Actions, Trade preview, Run workflow on \`main\`; under "${label}", pick the venues`,
      'Right after the test, run Trade preview again with `off`',
      'anyone with its address can use its swap panel',
      'deletes the deployment that had it on',
      'Each deployment also has an address of its own',
      "the run's own deployment address",
    ])
      expect(section, text).toContain(text)
  })

  it('says what to do when a run fails, step by step, and how to delete by hand', () => {
    expect(section).toContain('If the run fails, its log says why')
    for (const step of [
      'Check settings',
      'Build the static site',
      ...GUARDS.slice(3),
      'Check the production switch is off',
    ]) {
      expect(PREVIEW, step).toContain(`- name: ${step}`)
      expect(section, step).toContain(`**${step}**`)
    }
    for (const text of [
      '{"production_branch": "main"}',
      'Run Trade switch at once with `DEPTHWATCH_TRADE` unset',
      '`wrangler pages deployment delete <id> --project-name depthwatch`, which asks first',
      'Keep the latest `trade-preview` deployment, which the preview address points to',
    ])
      expect(section, text).toContain(text)
    expect(section).not.toContain('depthwatch --force')
  })

  it('lists the checks of the live test, with the Builder Code suffix the code sends', () => {
    const code = read('apps', 'web', 'src', 'trade', 'builderCode.ts')
    const suffix = /BUILDER_SUFFIX: Hex = '(0x[0-9a-f]+)'/.exec(code)?.[1] ?? ''
    expect(suffix).toBe('0x62635f6a366f6265736e380b0080218021802180218021802180218021')
    expect(section).toContain(`ends with \`${suffix}\``)
    expect(section).toContain(`its last ${suffix.length - 2} hex digits`)
    for (const text of [
      'a swap with ETH in and a swap with ETH out, the two directions of one pool',
      'an ERC-20 approve path',
      'from a browser-extension wallet and from a smart wallet (Base App)',
      'checked on Basescan',
      'the router that `TRADE_ROUTES`',
      "for exactly the swap's input amount",
      'More details, Input Data, Decode Input Data',
      'the fourth field of the user operation, after `sender`, `nonce` and `initCode`, is its `callData`',
      'the `callData` of its user operation',
    ])
      expect(section, text).toContain(text)
  })

  it('says what the first run showed and what is unverified', () => {
    for (const text of [
      'Seen on the first run (4 November 2026): Pages serves the alias `trade-preview.depthwatch.pages.dev` for this project',
      "Cloudflare's API gives `main` as the project's `result.production_branch` (the upload went ahead, which it does only then)",
      "Still unverified: the other answers the run's checks read",
      'the `environment` and `alias` wrangler records for the deployment',
      'the listing and deletion of deployments',
      'whether a preview serves `index.html` as built',
      'how long a run takes',
      'how Basescan shows a user operation',
      'these steps on a phone',
    ])
      expect(section, text).toContain(text)
  })
})
