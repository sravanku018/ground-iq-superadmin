import { describe, expect, it } from 'vitest'
import { digits10, formatInMobile, isValidInMobile, toE164In } from '../src/phoneIn.js'

// Phone numbers reach the database from two directions — surveyor login and
// subject intake — so these are the two rules worth pinning: +91 is optional,
// and exactly ten digits survive.
describe('digits10', () => {
  it('strips formatting from a bare ten-digit number', () => {
    expect(digits10('9876543210')).toBe('9876543210')
    expect(digits10('98765 43210')).toBe('9876543210')
    expect(digits10('98765-43210')).toBe('9876543210')
  })

  it('accepts +91, 91 and a leading 0 as the same number', () => {
    expect(digits10('+919876543210')).toBe('9876543210')
    expect(digits10('+91 98765 43210')).toBe('9876543210')
    expect(digits10('919876543210')).toBe('9876543210')
    expect(digits10('09876543210')).toBe('9876543210')
  })

  it('is empty for empty and nullish input', () => {
    expect(digits10('')).toBe('')
    expect(digits10('   ')).toBe('')
    expect(digits10(null)).toBe('')
    expect(digits10(undefined)).toBe('')
  })

  it('drops non-digits instead of failing', () => {
    expect(digits10('abc')).toBe('')
    expect(digits10('98a76b54c3210')).toBe('9876543210')
  })

  it('truncates anything longer than ten digits', () => {
    expect(digits10('98765432109')).toBe('9876543210')
    expect(digits10('987654321012345')).toBe('9876543210')
  })
})

describe('toE164In', () => {
  it('prefixes the country code', () => {
    expect(toE164In('9876543210')).toBe('+919876543210')
    expect(toE164In('+91 98765 43210')).toBe('+919876543210')
    expect(toE164In('98765 43210')).toBe('+919876543210')
  })

  it('returns empty rather than a bare +91 when there is no number', () => {
    expect(toE164In('')).toBe('')
    expect(toE164In('not a phone')).toBe('')
  })
})

describe('isValidInMobile', () => {
  it('requires ten digits', () => {
    expect(isValidInMobile('9876543210')).toBe(true)
    expect(isValidInMobile('+91 98765 43210')).toBe(true)
    expect(isValidInMobile('987654321')).toBe(false)
    expect(isValidInMobile('')).toBe(false)
    expect(isValidInMobile(null)).toBe(false)
  })

  // Documents today's behaviour rather than endorsing it: because the digit
  // extractor truncates, an eleven-digit typo validates and gets stored as its
  // first ten digits.
  it('accepts over-long input by truncating it', () => {
    expect(isValidInMobile('98765432109')).toBe(true)
    expect(toE164In('98765432109')).toBe('+919876543210')
  })
})

describe('formatInMobile', () => {
  it('renders a display form with the country code', () => {
    expect(formatInMobile('9876543210')).toBe('+91 9876543210')
    expect(formatInMobile('+91 98765 43210')).toBe('+91 9876543210')
  })

  it('is empty when there is nothing to show', () => {
    expect(formatInMobile('')).toBe('')
    expect(formatInMobile(null)).toBe('')
  })
})
