/**
 * docs/ARCHITECTURE.md for the tests that pin its prose to the code
 * (`pipeline/architecture*.test.ts`): a heading's body and the numbers a pattern captures in it.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const doc = readFileSync(join(HERE, '..', '..', '..', '..', 'docs', 'ARCHITECTURE.md'), 'utf8')

/** One heading's body up to the next heading, with line wraps collapsed to single spaces. */
export function section(heading: string): string {
  const start = doc.indexOf(`\n${heading}\n`)
  if (start < 0) throw new Error(`${heading} not found in ARCHITECTURE.md`)
  const body = doc.slice(start + heading.length + 2)
  const end = body.search(/\n#{1,3} /)
  return (end < 0 ? body : body.slice(0, end)).replace(/\s+/g, ' ')
}

/** The capture groups of `re` in `text` as bigints (digit-group commas stripped). */
export function numbers(text: string, re: RegExp): bigint[] {
  const match = text.match(re)
  if (!match) throw new Error(`expected ${re} in:\n${text}`)
  return match.slice(1).map((n) => BigInt(n.replaceAll(',', '')))
}
