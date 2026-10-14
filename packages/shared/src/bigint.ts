/**
 * Default maximum number of digits, excluding a leading `-`, accepted when parsing a `bigint` from a string.
 *
 * Matches Python's `int_max_str_digits` default: values this long parse in microseconds,
 * and it still covers IDs and 4096-bit numbers.
 */
export const DEFAULT_MAX_BIGINT_DIGITS = 4300

/**
 * Matches `bigint.toString()` exactly, so whitespace, `0x`/`0o`/`0b` prefixes and the empty string,
 * which `BigInt()` would accept, are rejected.
 */
const BIGINT_PATTERN = /^-?(?:0|[1-9]\d*)$/

/**
 * Parses a decimal integer string, as `bigint.toString()` produces it, into a `bigint`.
 * Returns `undefined` for any other string, or one with more than `maxDigits` digits, excluding a leading `-`.
 *
 * The length is checked first because converting a decimal string to `BigInt` takes super-linear time,
 * so untrusted strings must be bounded before parsing.
 */
export function parseBigIntString(value: string, maxDigits: number): bigint | undefined {
  const digits = value.startsWith('-') ? value.length - 1 : value.length

  if (digits > maxDigits || !BIGINT_PATTERN.test(value)) {
    return undefined
  }

  return BigInt(value)
}
