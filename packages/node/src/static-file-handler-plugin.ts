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

const UNSAFE_SEGMENT_REGEX = /^[. ]+$|[\0/\\]/

const UNSAFE_OR_DOTFILE_SEGMENT_REGEX = /^[. ]+$|^\.|^[^.]{0,6}~\d|[\0/\\]/

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
   * This is a request path policy, so it does not apply to a configured `indexFile`
   * or `fallbackFile`, nor to the target of a symbolic link.
   * When disabled, names shaped like 8.3 short names, such as `ENV~1`, are refused too,
   * since NTFS and FAT resolve them to dotfiles.
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

  after: string[] = ['~tracing']

  before: string[] = ['~head-method']

  private readonly rootDir: string
  private readonly path: `/${string}`
  private readonly indexFile: string | false
  private readonly fallbackFilePath: string | undefined
  private readonly cacheControl: string | false
  private readonly unsafeSegmentRegex: RegExp
  private readonly precompressed: boolean
  private readonly mimeTypes: Record<string, string>

  constructor(options: StaticFileHandlerPluginOptions) {
    this.rootDir = path.resolve(options.rootDir)
    this.path = stripTrailingSlash(options.path ?? '/')
    this.indexFile = options.indexFile ?? 'index.html'
    this.fallbackFilePath = options.fallbackFile === undefined ? undefined : path.join(this.rootDir, options.fallbackFile)
    this.cacheControl = options.cacheControl ?? 'public, max-age=0'
    this.unsafeSegmentRegex = options.dotfiles ? UNSAFE_SEGMENT_REGEX : UNSAFE_OR_DOTFILE_SEGMENT_REGEX
    this.precompressed = options.precompressed ?? false
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

      getTracer()?.getActiveSpan()?.updateName(`${request.method} ${base === '/' ? '' : base}/* (static file)`)

      return { matched: true, response }
    }

    return {
      ...options,
      routingInterceptors: [...toArray(options.routingInterceptors), routingInterceptor],
    }
  }

  private async serve(request: StandardLazyRequest, base: `/${string}`): Promise<StandardResponse | undefined> {
    const [pathname] = parseStandardUrl(request.url)

    if (base !== '/' && !matchesHttpPathPrefix(pathname, base)) {
      return undefined
    }

    const segments: string[] = []
    let isDirectoryUrl = false

    for (const rawSegment of pathname.slice(base.length).split('/')) {
      const segment = safeDecodeURIComponent(rawSegment)

      isDirectoryUrl = segment === '' || segment === '.'

      if (isDirectoryUrl) {
        continue
      }

      if (this.unsafeSegmentRegex.test(segment)) {
        return undefined
      }

      segments.push(segment)
    }

    let filePath = path.join(this.rootDir, ...segments)
    let stats = isDirectoryUrl ? undefined : await getStats(filePath)

    if (isDirectoryUrl || stats?.isDirectory()) {
      stats = undefined

      if (this.indexFile !== false) {
        filePath = path.join(filePath, this.indexFile)
        stats = await getStats(filePath)
      }
    }

    if (!stats?.isFile() && this.fallbackFilePath !== undefined) {
      filePath = this.fallbackFilePath
      stats = await getStats(filePath)
    }

    if (!stats?.isFile()) {
      return undefined
    }

    const contentType = this.resolveContentType(filePath)
    const headers: StandardHeaders = {}
    let contentEncoding: string | undefined

    if (this.precompressed && isCompressibleContentType(contentType)) {
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

    if (range !== undefined && isRangeApplicable(request.headers, etag, lastModifiedTime)) {
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

    return contentType.startsWith('text/') ? `${contentType}; charset=utf-8` : contentType
  }
}

function getStats(filePath: string): Promise<Stats | undefined> {
  return stat(filePath).catch(() => undefined)
}

function stripTrailingSlash(path: `/${string}`): `/${string}` {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) as `/${string}` : path
}

function isNotModified(requestHeaders: StandardHeaders, etag: string, lastModifiedTime: number): boolean {
  const ifNoneMatch = flattenStandardHeader(requestHeaders['if-none-match'])

  if (ifNoneMatch !== undefined) {
    return ifNoneMatch.trim() === '*' || ifNoneMatch.split(',').some((tag) => {
      tag = tag.trim()
      return (tag.startsWith('W/') ? tag.slice(2) : tag) === etag
    })
  }

  const ifModifiedSince = flattenStandardHeader(requestHeaders['if-modified-since'])

  return ifModifiedSince !== undefined && lastModifiedTime <= Date.parse(ifModifiedSince)
}

function isRangeApplicable(requestHeaders: StandardHeaders, etag: string, lastModifiedTime: number): boolean {
  const ifRange = flattenStandardHeader(requestHeaders['if-range'])

  if (ifRange === undefined) {
    return true
  }

  return ifRange.startsWith('"') || ifRange.startsWith('W/')
    ? ifRange === etag
    : Date.parse(ifRange) === lastModifiedTime
}

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
