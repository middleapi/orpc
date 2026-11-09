/**
 * Matches an integer string: an optional `-`, then digits without leading zeros (`007` is rejected).
 * Note that `-0` is accepted.
 */
export const INTEGER_REGEX: RegExp = /^-?(?:0|[1-9]\d*)$/

/**
 * Matches a non-negative integer string without leading zeros, such as an array index.
 */
export const NON_NEGATIVE_INTEGER_REGEX: RegExp = /^(?:0|[1-9]\d*)$/
