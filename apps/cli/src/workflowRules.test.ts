/**
 * Two rules of the GitHub workflows that the docs state. CI's audit of production dependencies
 * fails the job on a high or critical advisory and only warns on a lower one (AGENTS.md,
 * CONTRIBUTING.md). The static copy's not-found page comes from the build
 * (`apps/web/public/404.html`), so no workflow writes one of its own.
 */
import { describe, expect, it } from 'vitest'
import { nonBlank, read, runScripts, stepOf, WORKFLOWS, workflow } from './testing/workflowText.js'

const flat = (...path: string[]) => read(...path).replace(/\s+/g, ' ')

describe('the audit step of CI', () => {
  const CI = workflow('ci.yml')
  const STEP = stepOf(CI, 'Audit production dependencies')
  const script = runScripts(STEP)[0] ?? ''

  it('fails on a high or critical advisory in production dependencies, and warns on any', () => {
    expect(runScripts(STEP)).toHaveLength(1)
    expect(STEP).not.toContain('continue-on-error')
    expect(nonBlank(script.split('\n'))).toEqual([
      'if ! pnpm audit --prod; then',
      'echo "::warning::pnpm audit lists advisories in production dependencies (above)."',
      'fi',
      'pnpm audit --prod --audit-level=high',
    ])
    // The failing audit is the script's last command, outside the warning's branch.
    const lines = script.split('\n').filter((line) => line.trim() !== '')
    const indent = (line: string) => line.search(/\S/)
    expect(indent(lines.at(-1) ?? '')).toBe(indent(lines[0] ?? ''))
    // It runs once the builds have passed.
    expect(CI.indexOf('- name: Audit production dependencies')).toBeGreaterThan(
      CI.indexOf('- run: pnpm build:static'),
    )
  })

  it('is described as failing on high or critical advisories', () => {
    expect(flat('AGENTS.md')).toContain(
      '`pnpm audit --prod` step then fails the job on a high or critical advisory in a production dependency and leaves a warning for a moderate or low one.',
    )
    expect(flat('CONTRIBUTING.md')).toContain(
      'CI also runs `pnpm audit --prod`, which fails on a high or critical advisory in a production dependency and leaves a warning for a moderate or low one.',
    )
  })
})

describe('the not-found page of the static copy', () => {
  it('comes from the build: no workflow writes a 404.html of its own', () => {
    const publishers = WORKFLOWS.filter((file) => workflow(file).includes('wrangler pages deploy'))
    expect(publishers.sort()).toEqual(['refresh-site.yml', 'trade-preview.yml', 'trade-switch.yml'])
    for (const file of WORKFLOWS) {
      const commands = nonBlank(runScripts(workflow(file)).join('\n').split('\n')).filter(
        (line) => !line.startsWith('#'),
      )
      expect(commands.length, file).toBeGreaterThan(0)
      expect(
        commands.filter((line) => line.includes('404.html')),
        file,
      ).toEqual([])
    }
    for (const file of publishers)
      expect(workflow(file), file).toContain('pnpm --filter @depthwatch/web build:static')
  })
})
