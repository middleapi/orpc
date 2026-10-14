export const ORPC_NAME = 'orpc'

/**
 * Default maximum number of digits, excluding a leading `-`, accepted when parsing a `bigint` from a string.
 *
 * Converting a decimal string to `BigInt` takes super-linear time, so untrusted strings must be bounded before parsing.
 * Matches Python's `int_max_str_digits` default: values this long parse in microseconds,
 * and it still covers IDs and 4096-bit numbers.
 */
export const DEFAULT_MAX_BIGINT_DIGITS = 4300
