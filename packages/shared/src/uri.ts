const LONE_SURROGATE_REGEX = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * `encodeURIComponent` that never throws, lone surrogates become U+FFFD.
 */
export function safeEncodeURIComponent(value: string): string {
  try {
    // eslint-disable-next-line no-restricted-globals
    return encodeURIComponent(value)
  }
  catch {
    // eslint-disable-next-line no-restricted-globals
    return encodeURIComponent(value.replace(LONE_SURROGATE_REGEX, '�'))
  }
}

/**
 * `decodeURIComponent` that never throws, malformed input is returned unchanged.
 */
export function safeDecodeURIComponent(value: string): string {
  if (!value.includes('%')) {
    return value
  }

  try {
    // eslint-disable-next-line no-restricted-globals
    return decodeURIComponent(value)
  }
  catch {
    return value
  }
}
