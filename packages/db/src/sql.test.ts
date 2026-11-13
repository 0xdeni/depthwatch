import { describe, expect, it } from 'vitest'
import {
  bind,
  colBigint,
  colBool,
  colJsonOrNull,
  colNumber,
  colNumberOrNull,
  colText,
  colTextOrNull,
  likeContains,
  likePrefix,
  normalizeAddress,
  page,
  type Row,
  toSqlValue,
} from './sql.js'

describe('parameter binding', () => {
  it('converts bigints to decimal text, booleans to 0/1 and undefined to null', () => {
    expect(toSqlValue(2n ** 100n)).toBe('1267650600228229401496703205376')
    expect(toSqlValue(-5n)).toBe('-5')
    expect(toSqlValue(true)).toBe(1)
    expect(toSqlValue(false)).toBe(0)
    expect(toSqlValue(undefined)).toBeNull()
    expect(toSqlValue(null)).toBeNull()
    expect(toSqlValue(1.5)).toBe(1.5)
    expect(toSqlValue('x')).toBe('x')
    expect(bind([1n, true, undefined, 'a'])).toEqual(['1', 1, null, 'a'])
  })
})

describe('column readers', () => {
  const row: Row = Object.assign(Object.create(null), {
    text: 'hello',
    big: '1267650600228229401496703205376',
    int: 7,
    flag: 1,
    nothing: null,
    json: '{"a":[1,2]}',
  })

  it('reads typed values and rejects mismatches', () => {
    expect(colText(row, 'text')).toBe('hello')
    expect(colTextOrNull(row, 'nothing')).toBeNull()
    expect(colNumber(row, 'int')).toBe(7)
    expect(colNumberOrNull(row, 'nothing')).toBeNull()
    expect(colBigint(row, 'big')).toBe(2n ** 100n)
    expect(colBigint(row, 'int')).toBe(7n)
    expect(colBool(row, 'flag')).toBe(true)
    expect(colJsonOrNull(row, 'json')).toEqual({ a: [1, 2] })
    expect(colJsonOrNull(row, 'nothing')).toBeNull()
    expect(() => colText(row, 'int')).toThrow(/not text/)
    expect(() => colNumber(row, 'text')).toThrow(/not a number/)
    expect(() => colBigint(row, 'text')).toThrow(/not an integer/)
    expect(() => colText(row, 'missing')).toThrow(/missing column/)
  })
})

describe('helpers', () => {
  it('lowercases addresses', () => {
    expect(normalizeAddress('0xABCDEF')).toBe('0xabcdef')
  })

  it('escapes LIKE metacharacters', () => {
    expect(likeContains('we_th%\\')).toBe('%we\\_th\\%\\\\%')
    expect(likeContains('usdc')).toBe('%usdc%')
    expect(likePrefix('0xd0b5')).toBe('0xd0b5%')
    expect(likePrefix('a_b%')).toBe('a\\_b\\%%')
  })

  it('validates pagination', () => {
    expect(page(undefined, undefined)).toEqual([-1, 0])
    expect(page(undefined, undefined, 50)).toEqual([50, 0])
    expect(page(10, 20)).toEqual([10, 20])
    expect(() => page(-2, 0)).toThrow(RangeError)
    expect(() => page(-1, 0)).toThrow(RangeError)
    expect(() => page(1.5, 0)).toThrow(RangeError)
    expect(() => page(1, -1)).toThrow(RangeError)
  })
})
