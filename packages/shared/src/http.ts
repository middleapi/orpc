import { safeDecodeURIComponent, safeEncodeURIComponent } from '@standard-server/shared'

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
  return (
    charAfterPrefix === '/' ||
    charAfterPrefix === '?' ||
    charAfterPrefix === '#' ||
    charAfterPrefix === undefined ||
    prefix[prefix.length - 1] === '/'
  )
}

/**
 * Removes `prefix` from `pathname`, or returns `undefined` when `pathname` is not under `prefix`.
 * The rest of the path must start at a segment boundary, so `/apis` is not under `/api`.
 */
export function stripHttpPathPrefix(
  pathname: `/${string}`,
  prefix: `/${string}`,
): `/${string}` | undefined {
  if (!pathname.startsWith(prefix)) {
    return undefined
  }

  const charAfterPrefix = pathname[prefix.length]

  if (charAfterPrefix === '/') {
    return pathname.slice(prefix.length) as `/${string}`
  }

  if (charAfterPrefix === undefined) {
    return '/'
  }

  if (prefix[prefix.length - 1] === '/') {
    return pathname.slice(prefix.length - 1) as `/${string}`
  }

  return undefined
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
  return charAfterPrefix === undefined || charAfterPrefix === '?' || charAfterPrefix === '#'
}

/**
 * Content codings that oRPC compression plugins can encode and decode.
 */
const COMPRESSION_ENCODINGS = ['gzip', 'deflate', 'deflate-raw'] as const

export type CompressionEncoding = (typeof COMPRESSION_ENCODINGS)[number]

export function isCompressionEncoding(encoding: string): encoding is CompressionEncoding {
  return (COMPRESSION_ENCODINGS as readonly string[]).includes(encoding)
}

/**
 * Parse Content-Encoding into ordered codings (order applied), ignoring empty list elements.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-content-encoding
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#name-lists-rule-abnf-extension
 */
export function parseContentEncodings(header: string | undefined): string[] {
  const codings: string[] = []

  for (const part of header?.split(',') ?? []) {
    const coding = part.trim().toLowerCase()

    if (coding !== '') {
      codings.push(coding)
    }
  }

  return codings
}

// Rough UTF-8 estimate. Mostly ASCII text stays close to 1 byte/char;
// occasional multi-byte characters increase the average.
const AVG_UTF8_BYTES_PER_CHAR = 1.2

/**
 * Roughly estimates the UTF-8 byte length of a string without encoding it.
 */
export function estimateUtf8ByteLength(value: string): number {
  return value.length * AVG_UTF8_BYTES_PER_CHAR
}

// approx bytes for boundary + Content-Disposition/Content-Type headers per part
const FORM_DATA_PART_OVERHEAD = 64

/**
 * Estimates how many bytes of a FormData body are worth compressing. Non-compressible blobs count
 * against the total. Returns `Infinity` when a compressible blob has an unknown size, and
 * `-Infinity` when a non-compressible one does, since the estimate is then unreliable.
 */
export function estimateCompressibleFormDataSize(
  formData: FormData,
  isCompressible: (contentType: string) => boolean,
): number {
  let size = 0

  for (const [key, value] of formData) {
    size += FORM_DATA_PART_OVERHEAD + key.length

    if (value instanceof Blob) {
      if (!Number.isFinite(value.size)) {
        // Bun-s3 can use NaN for size
        if (!isCompressible(value.type)) {
          return -Infinity
        }

        // Unknown size for compressible content - still apply compression
        size = Infinity
      } else {
        size += isCompressible(value.type) ? value.size : -value.size
      }
    } else {
      size += estimateUtf8ByteLength(value)
    }
  }

  return size
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

    const quality = params
      .map((param) => ACCEPT_ENCODING_QUALITY_REGEX.exec(param)?.[1])
      .find((value) => value !== undefined)

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

  const fields = vary.split(',').map((field) => field.trim().toLowerCase())

  // `*` already forbids reuse across requests, so narrowing it would be a downgrade
  return fields.includes('accept-encoding') || fields.includes('*')
    ? vary
    : `${vary}, accept-encoding`
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
const COMPRESSIBLE_CONTENT_TYPE_REGEX =
  /^\s*(?:text\/(?!event-stream(?:[;\s]|$))[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i
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
