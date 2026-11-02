import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor } from '@orpc/server/standard'
import type { StandardHeaders, StandardLazyRequest, StandardResponse } from '@standard-server/core'
import type { Stats } from 'node:fs'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { getTracer, isAcceptableEncoding, isCompressibleContentType, matchesHttpPathPrefix, mergeHttpPath, parseAcceptEncodingQualities, safeDecodeURIComponent, toArray } from '@orpc/shared'
import { flattenStandardHeader, parseStandardUrl } from '@standard-server/core'
import { toWebReadableStream } from '@standard-server/node'
import mime from 'mime'

/**
 * Null bytes and `..` segments, after decoding. Refusing them up front means
 * the joined path can never leave `rootDir`.
 */
const UNSAFE_PATH_REGEX = /\0|(?:^|[/\\])\.\.(?:[/\\]|$)/

/**
 * Any segment starting with a dot, like `.env` or `.git/config`.
 */
const DOTFILE_PATH_REGEX = /(?:^|[/\\])\./

const PRECOMPRESSED_ENCODINGS = [
  ['br', '.br'],
  ['zstd', '.zst'],
  ['gzip', '.gz'],
] as const

export interface StaticFileHandlerPluginOptions {
  /**
   * The directory files are served from. Resolved against the working
   * directory when relative.
   */
  rootDir: string

  /**
   * The URL path files are served under, appended to the handler prefix
   * when one is set.
   *
   * @default '/'
   */
  path?: `/${string}` | undefined

  /**
   * The file served when the request path resolves to a directory.
   * Set to `false` to disable directory index files.
   *
   * @default 'index.html'
   */
  indexFile?: string | false | undefined

  /**
   * A file served with status 200 when no file matches the request path,
   * relative to `rootDir`. Useful for single-page application routing.
   *
   * @default undefined
   */
  fallbackFile?: string | undefined

  /**
   * The `Cache-Control` response header value. Set to `false` to omit the header.
   *
   * @default 'public, max-age=0'
   */
  cacheControl?: string | false | undefined

  /**
   * Whether files and directories whose name starts with a dot can be served.
   *
   * @default false
   */
  dotfiles?: boolean | undefined

  /**
   * Whether precompressed sidecar files (`.br`, `.zst`, `.gz`) can be served
   * when the client accepts their encoding and the content type is compressible.
   *
   * @default false
   */
  precompressed?: boolean | undefined

  /**
   * Content types keyed by lowercase file extension without the dot, taking precedence over
   * the type detected from the extension. Values are sent verbatim, so a text type needs its
   * own charset. Extensions that neither this nor the detection recognises are served as
   * `application/octet-stream`.
   */
  mimeTypes?: Record<string, string> | undefined
}

/**
 * Serves static files from a directory: index files, `ETag`/`Last-Modified`
 * revalidation, range requests, and precompressed sidecars. Files are served
 * as a fallback, so matched procedures always win.
 *
 * @see {@link https://orpc.dev/docs/plugins/static-file | Static File Plugin}
 */
export class StaticFileHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~static-file'

  /**
   * Ensure the request span is available when the interceptor renames it.
   */
  after: string[] = ['~tracing']

  /**
   * Should run outside the HEAD method plugin's `GET` fallback, so files keep answering `HEAD`
   * themselves and procedures routed as `GET` still take precedence over them.
   */
  before: string[] = ['~head-method']

  private readonly rootDir: string
  private readonly path: `/${string}`
  private readonly indexFile: string | false
  private readonly fallbackFile: string | undefined
  private readonly cacheControl: string | false
  private readonly dotfiles: boolean
  private readonly precompressed: boolean
  private readonly mimeTypes: Record<string, string>

  constructor(options: StaticFileHandlerPluginOptions) {
    this.rootDir = path.resolve(options.rootDir)
    this.path = stripTrailingSlash(options.path ?? '/')
    this.indexFile = options.indexFile ?? 'index.html'
    this.fallbackFile = options.fallbackFile
    this.cacheControl = options.cacheControl ?? 'public, max-age=0'
    this.dotfiles = options.dotfiles ?? false
    this.precompressed = options.precompressed ?? false
    // A null prototype prevents extensions like "constructor" from resolving through the prototype chain
    this.mimeTypes = Object.assign(Object.create(null) as Record<string, string>, options.mimeTypes)
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, request, prefix }) => {
      const result = await next()

      if (result.matched || (request.method !== 'GET' && request.method !== 'HEAD')) {
        return result
      }

      const base = prefix === undefined ? this.path : stripTrailingSlash(mergeHttpPath(prefix, this.path))
      const response = await this.serve(request, base)

      if (response === undefined) {
        return result
      }

      // Named after the base path rather than the url, so span names keep a low cardinality
      getTracer()?.getActiveSpan()?.updateName(`${request.method} ${base === '/' ? '' : base}/* (static file)`)

      return { matched: true, response }
    }

    return {
      ...options,
      // Run after user-provided routing interceptors so they can capture file responses
      routingInterceptors: [...toArray(options.routingInterceptors), routingInterceptor],
    }
  }

  private async serve(request: StandardLazyRequest, base: `/${string}`): Promise<StandardResponse | undefined> {
    const [pathname] = parseStandardUrl(request.url)

    if (base !== '/' && !matchesHttpPathPrefix(pathname, base)) {
      return undefined
    }

    const filename = safeDecodeURIComponent(pathname.slice(base.length))

    if (UNSAFE_PATH_REGEX.test(filename) || (!this.dotfiles && DOTFILE_PATH_REGEX.test(filename))) {
      return undefined
    }

    let filePath = path.join(this.rootDir, filename)
    let stats = await getStats(filePath)

    if (stats?.isDirectory()) {
      stats = undefined

      if (this.indexFile !== false) {
        filePath = path.join(filePath, this.indexFile)
        stats = await getStats(filePath)
      }
    }

    if (!stats?.isFile() && this.fallbackFile !== undefined) {
      filePath = path.join(this.rootDir, this.fallbackFile)
      stats = await getStats(filePath)
    }

    if (!stats?.isFile()) {
      return undefined
    }

    const contentType = this.resolveContentType(filePath)
    const headers: StandardHeaders = {}
    let contentEncoding: string | undefined

    if (this.precompressed && isCompressibleContentType(contentType)) {
      // Sent even for the identity variant, so caches key on the encoding
      headers.vary = 'accept-encoding'

      const qualities = parseAcceptEncodingQualities(flattenStandardHeader(request.headers['accept-encoding']))

      for (const [encoding, extension] of PRECOMPRESSED_ENCODINGS) {
        if (!isAcceptableEncoding(qualities, encoding)) {
          continue
        }

        const variantStats = await getStats(filePath + extension)

        if (variantStats?.isFile()) {
          filePath += extension
          stats = variantStats
          contentEncoding = encoding
          break
        }
      }
    }

    const size = stats.size
    const etag = `"${size.toString(16)}-${stats.mtime.getTime().toString(16)}"`
    // Truncated to seconds, matching the precision of http dates
    const lastModifiedTime = Math.floor(stats.mtime.getTime() / 1000) * 1000

    headers.etag = etag
    headers['last-modified'] = stats.mtime.toUTCString()
    headers['accept-ranges'] = 'bytes'

    if (this.cacheControl !== false) {
      headers['cache-control'] = this.cacheControl
    }

    if (isNotModified(request.headers, etag, lastModifiedTime)) {
      return { status: 304, headers }
    }

    let status = 200
    let start = 0
    let end = size - 1

    const range = request.method === 'GET' ? flattenStandardHeader(request.headers.range) : undefined
    const ifRange = flattenStandardHeader(request.headers['if-range'])

    // If-Range uses the strong comparison function, so a weak tag never matches
    if (range !== undefined && (ifRange === undefined || ifRange === etag || Date.parse(ifRange) === lastModifiedTime)) {
      const parsed = parseByteRange(range, size)

      if (parsed === 'unsatisfiable') {
        return { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } }
      }

      if (parsed !== undefined) {
        status = 206
        ;[start, end] = parsed
        headers['content-range'] = `bytes ${start}-${end}/${size}`
      }
    }

    if (contentEncoding !== undefined) {
      headers['content-encoding'] = contentEncoding
    }

    headers['content-type'] = contentType
    headers['content-length'] = `${end - start + 1}`

    /**
     * A HEAD response uses an empty stream instead of no body, because
     * the adapters drop `content-type` and `content-length` when the body is `undefined`.
     */
    const body: ReadableStream<Uint8Array<ArrayBuffer>> = request.method === 'HEAD'
      ? new ReadableStream({ start: controller => controller.close() })
      : toWebReadableStream(createReadStream(filePath, status === 206 ? { start, end } : undefined))

    return { status, headers, body }
  }

  private resolveContentType(filePath: string): string {
    const extension = path.extname(filePath).slice(1).toLowerCase()
    const configured = this.mimeTypes[extension]

    if (configured !== undefined) {
      return configured
    }

    const contentType = mime.getType(extension)

    if (contentType === null) {
      return 'application/octet-stream'
    }

    // Http defines no default charset, so text is pinned to utf-8 instead of left to browser sniffing
    return contentType.startsWith('text/') ? `${contentType}; charset=utf-8` : contentType
  }
}

function getStats(filePath: string): Promise<Stats | undefined> {
  return stat(filePath).catch(() => undefined)
}

function stripTrailingSlash(path: `/${string}`): `/${string}` {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) as `/${string}` : path
}

/**
 * If-None-Match takes precedence over If-Modified-Since and uses the weak comparison function.
 * A request `Cache-Control: no-cache` is deliberately ignored: a `304` is a successful
 * revalidation, and `fetch` sends it alongside its conditional headers.
 */
function isNotModified(requestHeaders: StandardHeaders, etag: string, lastModifiedTime: number): boolean {
  const ifNoneMatch = flattenStandardHeader(requestHeaders['if-none-match'])

  if (ifNoneMatch !== undefined) {
    return ifNoneMatch.trim() === '*' || ifNoneMatch.split(',').some((tag) => {
      tag = tag.trim()
      return (tag.startsWith('W/') ? tag.slice(2) : tag) === etag
    })
  }

  const ifModifiedSince = flattenStandardHeader(requestHeaders['if-modified-since'])

  // An unparsable date is NaN, which never compares true
  return ifModifiedSince !== undefined && lastModifiedTime <= Date.parse(ifModifiedSince)
}

/**
 * Supports a single `bytes` range. Malformed and multi-range headers return `undefined`,
 * so the full file is served instead.
 */
function parseByteRange(range: string, size: number): [start: number, end: number] | 'unsatisfiable' | undefined {
  const match = range.match(/^bytes=\s*(\d*)-(\d*)$/i)

  if (match === null || (match[1] === '' && match[2] === '')) {
    return undefined
  }

  if (match[1] === '') {
    const suffixLength = Number(match[2])
    return suffixLength === 0 || size === 0 ? 'unsatisfiable' : [Math.max(0, size - suffixLength), size - 1]
  }

  const start = Number(match[1])

  if (start >= size) {
    return 'unsatisfiable'
  }

  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)

  return end < start ? undefined : [start, end]
}
