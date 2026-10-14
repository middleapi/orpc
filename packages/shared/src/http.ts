/**
 * Longest pathname a matcher normalizes. Normalization decodes and re-encodes every segment, so
 * its cost grows with the pathname, and peer messages and batch sub-requests carry URLs of any
 * length. Matching longer pathnames only as given keeps that cost bounded. 16 KiB is Node's
 * default `maxHeaderSize`, so any URL default Node HTTP accepts is still normalized.
 */
export const MAX_NORMALIZABLE_PATHNAME_LENGTH = 16 * 1024

// with the `u` flag a valid surrogate pair is one code point and never matches
const LONE_SURROGATE_REGEX = /[\uD800-\uDFFF]/gu

/**
 * `encodeURIComponent` that replaces lone surrogates with U+FFFD instead of throwing.
 */
export function safeEncodeURIComponent(value: string): string {
  // eslint-disable-next-line no-restricted-globals -- cannot throw once lone surrogates are replaced
  return encodeURIComponent(value.replace(LONE_SURROGATE_REGEX, '\uFFFD'))
}

/**
 * `decodeURIComponent` that returns the value unchanged instead of throwing when it is malformed.
 * Validity is checked up front, since a throw captures a stack trace and callers decode values
 * (such as path segments) whose count the client controls.
 */
export function safeDecodeURIComponent(value: string): string {
  if (!value.includes('%')) {
    return value
  }

  // eslint-disable-next-line no-restricted-globals -- cannot throw once the value is validated
  return isDecodableURIComponent(value) ? decodeURIComponent(value) : value
}

/**
 * Whether `decodeURIComponent` accepts the value: every `%` starts a `%XX` escape, and the escaped
 * bytes form strict UTF-8, with each continuation byte in the very next escape.
 *
 * @see https://tc39.es/ecma262/#sec-decode
 */
function isDecodableURIComponent(value: string): boolean {
  let index = value.indexOf('%')

  while (index !== -1) {
    const lead = readEscapedByte(value, index)

    if (lead === -1) {
      return false
    }

    let continuations: number
    // range of the first continuation byte, narrowed for some leads to reject overlong forms,
    // surrogates and code points above U+10FFFF
    let min = 0x80
    let max = 0xBF

    if (lead < 0x80) {
      continuations = 0
    }
    else if (lead < 0xC2) {
      return false
    }
    else if (lead < 0xE0) {
      continuations = 1
    }
    else if (lead < 0xF0) {
      continuations = 2

      if (lead === 0xE0) {
        min = 0xA0
      }
      else if (lead === 0xED) {
        max = 0x9F
      }
    }
    else if (lead < 0xF5) {
      continuations = 3

      if (lead === 0xF0) {
        min = 0x90
      }
      else if (lead === 0xF4) {
        max = 0x8F
      }
    }
    else {
      return false
    }

    for (let i = 0; i < continuations; i++) {
      index += 3
      const byte = readEscapedByte(value, index)

      if (byte < min || byte > max) {
        return false
      }

      min = 0x80
      max = 0xBF
    }

    index = value.indexOf('%', index + 3)
  }

  return true
}

/**
 * The byte of the `%XX` escape at `index`, or `-1` when there is none.
 */
function readEscapedByte(value: string, index: number): number {
  if (value.charCodeAt(index) !== 0x25 /* % */) {
    return -1
  }

  const high = hexDigitValue(value.charCodeAt(index + 1))
  const low = hexDigitValue(value.charCodeAt(index + 2))

  return high === -1 || low === -1 ? -1 : high * 16 + low
}

function hexDigitValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) { // 0-9
    return code - 0x30
  }

  if (code >= 0x41 && code <= 0x46) { // A-F
    return code - 0x37
  }

  if (code >= 0x61 && code <= 0x66) { // a-f
    return code - 0x57
  }

  return -1
}

export function pathToHttpPath(path: readonly string[]): `/${string}` {
  return `/${path.map(safeEncodeURIComponent).join('/')}`
}

export function normalizeHttpPath(path: string): `/${string}` {
  const paths = path.split('/')

  if (paths.at(0) === '') {
    paths.shift()
  }

  return pathToHttpPath(paths.map(safeDecodeURIComponent))
}

export function mergeHttpPath(a: `/${string}`, b: `/${string}`): `/${string}` {
  return `${a.endsWith('/') ? a.slice(0, -1) : a}${b}` as `/${string}`
}

export function matchesHttpPathPrefix(url: `/${string}`, prefix: `/${string}`): boolean {
  if (!url.startsWith(prefix)) {
    return false
  }

  const charAfterPrefix = url[prefix.length]

  // order by most common cases for better performance
  return charAfterPrefix === '/'
    || charAfterPrefix === '?'
    || charAfterPrefix === '#'
    || charAfterPrefix === undefined
    || prefix[prefix.length - 1] === '/'
}

export function matchesHttpPath(url: `/${string}`, path: `/${string}`): boolean {
  const pathWithoutEndSlash = path.endsWith('/') ? path.slice(0, path.length - 1) : path

  if (!url.startsWith(pathWithoutEndSlash)) {
    return false
  }

  let charAfterPrefix = url[pathWithoutEndSlash.length]

  if (charAfterPrefix === '/') {
    charAfterPrefix = url[pathWithoutEndSlash.length + 1]
  }

  // order by most common cases for better performance
  return charAfterPrefix === undefined
    || charAfterPrefix === '?'
    || charAfterPrefix === '#'
}

const ACCEPT_ENCODING_QUALITY_REGEX = /^\s*q=([\d.]+)\s*$/i

/**
 * Parse Accept-Encoding into each coding's q-value, where `0` means the coding is explicitly
 * unacceptable. The `*` wildcard is kept under its own key; use {@link isAcceptableEncoding}
 * to decide whether a coding is acceptable.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-accept-encoding
 */
export function parseAcceptEncodingQualities(header: string | undefined): Map<string, number> {
  const qualities = new Map<string, number>()

  for (const part of header?.split(',') ?? []) {
    const [rawCoding, ...params] = part.split(';')
    const coding = rawCoding!.trim().toLowerCase()

    if (coding === '') {
      continue
    }

    const quality = params.map(param => ACCEPT_ENCODING_QUALITY_REGEX.exec(param)?.[1]).find(value => value !== undefined)

    qualities.set(coding, quality === undefined ? 1 : Number(quality))
  }

  return qualities
}

/**
 * Whether the client accepts a coding, given qualities from {@link parseAcceptEncodingQualities}.
 * An explicit q-value takes precedence over the `*` wildcard, so `gzip;q=0, *` never accepts gzip.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-accept-encoding
 */
export function isAcceptableEncoding(qualities: Map<string, number>, coding: string): boolean {
  return (qualities.get(coding) ?? qualities.get('*') ?? 0) > 0
}

/**
 * Add `accept-encoding` to a Vary header value. The encoding is chosen from the request, so a
 * shared cache must key on it or it will hand a compressed body to a client that cannot decode it.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-vary
 */
export function varyByAcceptEncoding(vary: string | undefined): string {
  if (vary === undefined) {
    return 'accept-encoding'
  }

  const fields = vary.split(',').map(field => field.trim().toLowerCase())

  // `*` already forbids reuse across requests, so narrowing it would be a downgrade
  return fields.includes('accept-encoding') || fields.includes('*') ? vary : `${vary}, accept-encoding`
}

/**
 * Whether Cache-Control includes the no-transform directive, which forbids transforming the body.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9111.html#name-no-transform
 */
const CACHE_CONTROL_NO_TRANSFORM_REGEX = /(?:^|,)\s*no-transform\s*(?:,|$)/i
export function isNoTransformCacheControl(cacheControl: string | undefined): boolean {
  if (cacheControl === undefined) {
    return false
  }

  return CACHE_CONTROL_NO_TRANSFORM_REGEX.test(cacheControl)
}

/**
 * inspired from Hono Compression Plugin
 */
const COMPRESSIBLE_CONTENT_TYPE_REGEX = /^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i
// Cap length to skip the regex on pathological inputs.
const MAX_COMPRESSIBLE_CONTENT_TYPE_LENGTH = 1024

export function isCompressibleContentType(contentType: string | null | undefined): boolean {
  if (contentType === null || contentType === undefined) {
    return false
  }

  if (contentType.length > MAX_COMPRESSIBLE_CONTENT_TYPE_LENGTH) {
    return false
  }

  return COMPRESSIBLE_CONTENT_TYPE_REGEX.test(contentType)
}
