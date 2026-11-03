/**
 * The Builder Code suffix: decoded by hand (ERC-8021 schema 0, read backwards), equal to what ox
 * 0.14.57 `Attribution.toDataSuffix` builds for `bc_j6obesn8` and read back by its `fromData`,
 * read only at the end of the data, and never appended twice. Bundles: readBack.test.ts.
 */
import { Attribution } from 'ox/erc8021'
import { concat, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  BUILDER_CODE,
  BUILDER_SUFFIX,
  decodeBuilderCodes,
  withBuilderSuffix,
} from './builderCode.js'

const CALLDATA: Hex = '0x095ea7b3000000000000000000000000000000000000000000000000000000000000002a'

describe('BUILDER_SUFFIX', () => {
  it('is the code in ASCII, its length, schema 0 and the 16-byte marker: 29 bytes', () => {
    const hex = BUILDER_SUFFIX.slice(2)
    expect(hex.length / 2).toBe(29)
    expect(hex.slice(-32)).toBe('8021'.repeat(8))
    expect(hex.slice(-34, -32)).toBe('00')
    expect(Number.parseInt(hex.slice(-36, -34), 16)).toBe(BUILDER_CODE.length)
    const ascii = hex
      .slice(0, -36)
      .match(/../g)
      ?.map((b) => String.fromCharCode(Number.parseInt(b, 16)))
      .join('')
    expect(ascii).toBe('bc_j6obesn8')
  })

  it('equals ox 0.14.57 Attribution.toDataSuffix, and ox reads our calldata back', () => {
    expect(Attribution.toDataSuffix({ codes: [BUILDER_CODE] })).toBe(BUILDER_SUFFIX)
    expect(Attribution.fromData(withBuilderSuffix(CALLDATA))).toEqual({
      codes: [BUILDER_CODE],
      id: 0,
    })
  })
})

describe('decoding', () => {
  it('reads the codes at the end of calldata, and nothing from calldata without a suffix', () => {
    expect(decodeBuilderCodes(withBuilderSuffix(CALLDATA))).toEqual([BUILDER_CODE])
    expect(decodeBuilderCodes(CALLDATA)).toBeNull()
    expect(decodeBuilderCodes('0x')).toBeNull()
    expect(decodeBuilderCodes('not hex')).toBeNull()
  })

  it('reads several codes a wallet may have put in one suffix', () => {
    const both = Attribution.toDataSuffix({ codes: ['bc_wallet', BUILDER_CODE] })
    expect(decodeBuilderCodes(concat([CALLDATA, both]))).toEqual(['bc_wallet', BUILDER_CODE])
  })

  it('reads only the end: a suffix inside the data attributes nothing', () => {
    const inside = concat([withBuilderSuffix(CALLDATA), '0x0000'])
    expect(decodeBuilderCodes(inside)).toBeNull()
  })

  it('never appends the suffix twice', () => {
    const once = withBuilderSuffix(CALLDATA)
    expect(once.split(BUILDER_SUFFIX.slice(2))).toHaveLength(2)
    expect(() => withBuilderSuffix(once)).toThrow(/already carries/)
  })
})
