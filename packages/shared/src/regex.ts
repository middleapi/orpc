/**
 * Matches a single trailing `/`, e.g. to remove it before appending a path.
 */
export const TRAILING_SLASH_REGEX = /\/$/

/**
 * Matches a canonical array index: a non-negative integer without a sign or leading zeros,
 * e.g. `0` or `12`, but not `-1`, `01` or `1.0`.
 */
export const ARRAY_INDEX_REGEX = /^(?:0|[1-9]\d*)$/

/**
 * Matches a canonical integer: an optional `-` followed by digits without leading zeros,
 * e.g. `0`, `12` or `-12`, but not `+1`, `01` or `1.0`. This is also the output of `bigint.toString()`.
 */
export const INTEGER_REGEX = /^-?(?:0|[1-9]\d*)$/
