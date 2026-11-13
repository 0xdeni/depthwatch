/**
 * Readers of the GitHub workflows for the tests that pin them (`tradePreview.test.ts`,
 * `tradePreviewHeaders.test.ts`, `refreshSchedule.test.ts`, `workflowRules.test.ts`). The
 * workflows are read as text: the repository has no YAML parser, so these read only the simple
 * shapes the files use.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
export const read = (...path: string[]) => readFileSync(join(ROOT, ...path), 'utf8')
export const WORKFLOWS = readdirSync(join(ROOT, '.github', 'workflows')).filter((file) =>
  file.endsWith('.yml'),
)
export const workflow = (file: string) => read('.github', 'workflows', file)
/** The workflows that publish the production site (`--branch main`). */
export const PRODUCTION_PUBLISHERS = ['refresh-site.yml', 'trade-switch.yml']

const indentOf = (line: string) => line.search(/\S/)
export const nonBlank = (lines: string[]) =>
  lines.filter((line) => line.trim() !== '').map((l) => l.trim())

/** The lines indented under the first line that is exactly `key` once trimmed. */
export function blockUnder(text: string, key: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === key)
  if (start < 0) throw new Error(`no line ${key}`)
  const level = indentOf(lines[start] ?? '')
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== '' && indentOf(line) <= level) break
    block.push(line)
  }
  return block
}

/**
 * The shell of every `run:` step: a one-line `run: …`, or the lines indented under `run:` and any
 * block scalar header (`|`, `|-`, `>`, `>+` and so on).
 */
export function runScripts(text: string): string[] {
  const lines = text.split('\n')
  const scripts: string[] = []
  lines.forEach((line, index) => {
    const match = /^(\s*)(?:- )?run:(?: (.*))?$/.exec(line)
    if (match === null) return
    const value = (match[2] ?? '').trim()
    if (!/^([|>][-+]?)?$/.test(value)) {
      scripts.push(value)
      return
    }
    const level = (match[1] ?? '').length
    const body: string[] = []
    for (const next of lines.slice(index + 1)) {
      if (next.trim() !== '' && indentOf(next) <= level) break
      body.push(next)
    }
    scripts.push(body.join('\n'))
  })
  return scripts
}

/** The `--branch` of every upload by wrangler (`pages deploy`, `publish`, `project upload`). */
export function deployBranches(text: string): string[] {
  return runScripts(text)
    .flatMap((script) => script.replace(/\\\n\s*/g, ' ').split('\n'))
    .filter((line) => /wrangler\S* pages (deploy|publish|project upload)\b/.test(line))
    .map((line) => /--branch[= ](\S+)/.exec(line)?.[1] ?? 'none')
}

/** The ids of the workflow's jobs, in file order: the keys two spaces in under `jobs:`. */
export function jobIds(text: string): string[] {
  const lines = text.split('\n')
  return lines
    .slice(lines.indexOf('jobs:') + 1)
    .flatMap((line) => /^ {2}([A-Za-z0-9_-]+):$/.exec(line)?.[1] ?? [])
}

/** The text of the job `id`, from its key under `jobs:` to the next job or comment at its level. */
export function jobOf(text: string, id: string): string {
  const lines = text.split('\n')
  const jobs = lines.indexOf('jobs:')
  const start = lines.findIndex((line, i) => jobs >= 0 && i > jobs && line === `  ${id}:`)
  if (start < 0) throw new Error(`no job ${id}`)
  const end = lines.findIndex((line, i) => i > start && line.trim() !== '' && indentOf(line) <= 2)
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}

/** The schedule of the workflow: the value of every `- cron:` line, unquoted. */
export const cronsOf = (text: string) =>
  [...text.matchAll(/^\s*- cron: "([^"]*)"$/gm)].map((match) => match[1] ?? '')

/** The text of the step named `name`, from its `- name:` line to the next step or comment. */
export function stepOf(text: string, name: string): string {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`)
  if (start < 0) throw new Error(`no step ${name}`)
  const level = indentOf(lines[start] ?? '')
  const end = lines.findIndex(
    (line, i) => i > start && line.trim() !== '' && indentOf(line) <= level,
  )
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}

/**
 * The scripts of every `node -e '…' <args>` in `text`, each with the arguments after it: the
 * shell keeps the single-quoted text as is, and these scripts hold no single quote.
 */
export function nodeScripts(text: string): Array<{ script: string; args: string }> {
  return [...text.matchAll(/node -e '([^']*)'([^\n;]*)/g)].map((match) => ({
    script: match[1] ?? '',
    args: (match[2] ?? '').trim(),
  }))
}

/** The `options:` of the choice input, each quoted (a bare `off` is a boolean in YAML 1.1). */
export function choiceOptions(text: string): string[] {
  return nonBlank(blockUnder(text, 'options:')).map((line) => {
    const option = /^- "([^"]+)"$/.exec(line)?.[1]
    if (option === undefined) throw new Error(`not a quoted option: ${line}`)
    return option
  })
}

/** Every `uses:` of the workflow, with its pinned SHA and the release it names. */
export const actionsOf = (text: string) =>
  text
    .split('\n')
    .filter((line) => /^\s*(- )?uses: /.test(line))
    .map((line) => line.replace(/^\s*(- )?uses: /, ''))
