import { tryDecodeURIComponent } from './uri'

export function pathToHttpPath(path: readonly string[]): `/${string}` {
  return `/${path.map(encodeURIComponent).join('/')}`
}

export function normalizeHttpPath(path: string): `/${string}` {
  const paths = path.split('/')

  if (paths.at(0) === '') {
    paths.shift()
  }

  return pathToHttpPath(paths.map(tryDecodeURIComponent))
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
 * unacceptable. The `*` wildcard is kept under its own key, so a caller can honour it while
 * still letting a specific coding take precedence over it.
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

/**
 * Characters a cache tag cannot carry literally: `%` and `,` because they are
 * the encoding's own syntax, `A-Z` because caches like Cloudflare Workers
 * Caching fold case, and anything outside printable ASCII because it cannot
 * appear in a header value.
 *
 * Safe to share across calls: `String.prototype.replace` resets `lastIndex`
 * on a global regex before it matches.
 */
const UNSAFE_CACHE_TAG_CHARS = /[^\x21-\x7E]|[%,A-Z]/gu

/**
 * Percent-encodes only {@link UNSAFE_CACHE_TAG_CHARS} in a cache tag, so
 * typical tags stay readable. Uppercase letters are encoded because caches
 * like Cloudflare Workers Caching match tags case-insensitively; the encoded
 * form stays unambiguous under case folding. Reach for this where tags travel
 * one at a time, such as a purge API.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export function encodeCacheTag(tag: string): string {
  // encodeURIComponent emits the UTF-8 bytes a percent escape needs, but leaves
  // the URI unreserved set alone, so the uppercase letters in it are escaped by
  // hand. Those are single-byte ASCII, so the code point is the byte.
  return tag.replace(
    UNSAFE_CACHE_TAG_CHARS,
    char => char >= 'A' && char <= 'Z'
      ? `%${char.charCodeAt(0).toString(16).toUpperCase()}`
      : encodeURIComponent(char),
  )
}

/**
 * Joins {@link encodeCacheTag}-encoded tags with commas into a header value.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export function encodeCacheTagHeader(tags: readonly string[]): string {
  return tags.map(tag => encodeCacheTag(tag)).join(',')
}

/**
 * Decodes a header value produced by {@link encodeCacheTagHeader} back into
 * tags, empty ones included. Every non-empty tag list round-trips exactly.
 *
 * @see {@link https://orpc.dev/docs/helpers/cache#handler-plugin | Cache Helpers - Handler Plugin}
 */
export function decodeCacheTagHeader(header: string): string[] {
  return header.split(',').map(tryDecodeURIComponent)
}
