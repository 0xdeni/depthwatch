/**
 * Depthwatch's Base Builder Code and its ERC-8021 data suffix (schema 0), attached to every
 * transaction the swap panel sends (DESIGN.md, "Dashboard (apps/web)"). The suffix is a
 * constant, not computed at run time: `Attribution.toDataSuffix({ codes: [BUILDER_CODE] })` of ox
 * 0.14.57, which builderCode.test.ts checks. Read backwards it is the 16-byte marker
 * `0x8021…8021`, the schema id `0x00`, the length of the codes (`0x0b`, 11) and the codes in ASCII.
 *
 * Lives in the lazy trade chunk only: tradeBundle.test.ts fails when the marker reaches a chunk
 * the site loads at boot.
 */
import type { Hex } from 'viem'

export const BUILDER_CODE = 'bc_j6obesn8'

/** `bc_j6obesn8` ‖ 0x0b ‖ 0x00 ‖ 0x8021…8021: 29 bytes. */
export const BUILDER_SUFFIX: Hex = '0x62635f6a366f6265736e380b0080218021802180218021802180218021'

/** The ERC-8021 marker, as hex without its 0x. */
const MARKER = '80218021802180218021802180218021'

/** The codes of a schema-0 suffix whose marker ends at hex offset `end` of `hex`, or null. */
function codesEndingAt(hex: string, end: number): string[] | null {
  if (end % 2 !== 0 || hex.slice(end - MARKER.length, end) !== MARKER) return null
  let at = end - MARKER.length
  if (at < 4 || hex.slice(at - 2, at) !== '00') return null
  at -= 2
  const length = Number.parseInt(hex.slice(at - 2, at), 16)
  at -= 2
  if (!(length > 0) || at - 2 * length < 0) return null
  let text = ''
  for (let i = at - 2 * length; i < at; i += 2) {
    const code = Number.parseInt(hex.slice(i, i + 2), 16)
    if (!(code >= 0x20 && code <= 0x7e)) return null
    text += String.fromCharCode(code)
  }
  return text.split(',')
}

function bareHex(data: string): string | null {
  const hex = data.toLowerCase()
  return /^0x(?:[0-9a-f]{2})*$/.test(hex) ? hex.slice(2) : null
}

/**
 * The Builder Codes of calldata that ends with an ERC-8021 schema-0 suffix, else null. Only the
 * end counts, as for ERC-8021's own parser: a suffix inside the data (our calldata wrapped in a
 * smart account's `execute(…)`) attributes nothing (readBack.ts).
 */
export function decodeBuilderCodes(data: string): string[] | null {
  const hex = bareHex(data)
  return hex === null ? null : codesEndingAt(hex, hex.length)
}

/**
 * `data` with the suffix appended, for simulating exactly the bytes an EOA signs. Throws when
 * `data` already ends with a suffix: the suffix is never appended twice.
 */
export function withBuilderSuffix(data: Hex): Hex {
  if (decodeBuilderCodes(data) !== null) throw new Error('calldata already carries a data suffix')
  return `${data}${BUILDER_SUFFIX.slice(2)}` as Hex
}
