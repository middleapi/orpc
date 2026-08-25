import type { Context } from '@orpc/server'
import type { StandardHandlerOptions, StandardHandlerPlugin, StandardHandlerRoutingInterceptor, StandardHandlerRoutingInterceptorOptions } from '@orpc/server/standard'
import type { Promisable, Value } from '@orpc/shared'
import type { StandardBody, StandardBodyHint, StandardHeaders, StandardLazyRequest } from '@standardserver/core'
import type { FilePropertyBag } from 'node:buffer'
import { Buffer } from 'node:buffer'
import { openAsBlob } from 'node:fs'
import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ORPCError } from '@orpc/server'
import { isAsyncIteratorObject, override, toArray, value, wrapAsyncIterator, wrapReadableStream } from '@orpc/shared'
import { flattenStandardHeader, getFilenameFromContentDisposition, resolveStandardBodyHint } from '@standardserver/core'
import { toFetchHeaders, toStandardBody } from '@standardserver/fetch'
import { parseHeaderParameters, parseMultipart } from './multipart'

export interface TmpFileUploadHandlerPluginMaxBodySize {
  /**
   * The maximum total size in bytes of request body content that is parsed
   * into memory: JSON, URL-encoded forms, and the plain fields of a multipart
   * body. A larger body rejects the request with `PAYLOAD_TOO_LARGE`. Usually
   * the lowest of the three limits, because this content cannot stream anywhere.
   */
  memory: number

  /**
   * The maximum total size in bytes of upload content a request streams into
   * temporary files: file bodies and the file parts of a multipart body
   * combined. A larger body rejects the request with `PAYLOAD_TOO_LARGE`.
   */
  file: number

  /**
   * The maximum total size in bytes of a request body that is consumed as a
   * stream: event streams and raw binary streams. Enforced while the stream is
   * consumed, so an oversized stream fails at the reader. Usually the highest
   * of the three limits, because this content is consumed on the fly.
   */
  stream: number
}

export interface TmpFileUploadHandlerPluginOptions<T extends Context> {
  /**
   * The directory temporary files are created under. Each request that spools
   * an upload gets its own subdirectory inside it, removed when the request
   * finishes.
   *
   * @default os.tmpdir()
   */
  tmpDir?: string

  /**
   * The size limit for each kind of request body, either fixed or resolved
   * per request, so limits can follow the request itself, such as a larger
   * allowance for an authenticated user than for a guest. Every kind is
   * required when the option is given, so none is left unbounded by accident;
   * set a kind to `Number.POSITIVE_INFINITY` to deliberately leave it
   * unlimited.
   *
   * A resolver runs only when a body is parsed, so a request without one never
   * pays for it, and it receives the request as it arrived, before this plugin
   * wraps its body resolution.
   *
   * @default unlimited for every kind
   */
  maxBodySize?: Value<Promisable<TmpFileUploadHandlerPluginMaxBodySize>, [options: StandardHandlerRoutingInterceptorOptions<T>]>
}

/**
 * A `File` whose content lives in a temporary file on disk and is read lazily,
 * so it can represent an upload far larger than available memory.
 *
 * @remarks
 * Node's `fs.openAsBlob`, which backs this class, has known bugs with files
 * over 2 GiB ({@link https://github.com/nodejs/node/issues/52585}): `size` is
 * truncated above 4 GiB and `slice()` is unreliable above 2 GiB, while
 * whole-file reads like `stream()` stay correct. When size or random access
 * matters for such a file, stat or read {@link path} directly.
 *
 * @see {@link https://orpc.dev/docs/plugins/tmp-file-upload | Tmp File Upload Plugin}
 */
export class TmpFile extends File {
  constructor(
    blob: Blob,
    /**
     * Absolute path of the temporary file holding this file's content.
     * The file is removed when the request finishes, so move or copy it
     * to keep the content. The `File` reads from this path, so it must
     * not be read after the file is moved or removed.
     */
    readonly path: string,
    name: string,
    options?: FilePropertyBag,
  ) {
    super([blob], name, options)
  }
}

/**
 * Parses file uploads into temporary files instead of memory. Bodies the standard
 * body parser would buffer into an in-memory `File`, and multipart file parts, are
 * streamed to disk and surfaced as lazily read {@link TmpFile} instances, so requests
 * far larger than available memory parse in constant memory. Every other body is left
 * to the standard parser.
 *
 * Request body sizes are limited per content category: memory-parsed, spooled to
 * disk, and streamed, each limit fixed or resolved per request. This subsumes the
 * request limit plugin while sizing each kind of body to what it actually costs.
 *
 * @remarks
 * Temporary files are removed when the request finishes. A streaming response body,
 * an event iterator or a raw stream, keeps them alive until it completes, so
 * responses that read the upload while streaming work. Any other response is
 * transmitted after removal, so one that embeds the upload itself, as a `File` or
 * inside `FormData`, needs the content copied or the file moved first.
 *
 * @see {@link https://orpc.dev/docs/plugins/tmp-file-upload | Tmp File Upload Plugin}
 */
export class TmpFileUploadHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  name = '~tmp-file-upload'

  /**
   * Should parse the original request body instead of batched sub-requests.
   */
  after = ['~batch']

  /**
   * Should run inside the limit and compression plugins, so spooling receives
   * the size-checked, decompressed bytes.
   */
  before = ['~request-limit', '~request-compression']

  private readonly tmpDir: string
  private readonly maxBodySize: Exclude<TmpFileUploadHandlerPluginOptions<T>['maxBodySize'], undefined>

  constructor(options: TmpFileUploadHandlerPluginOptions<T> = {}) {
    this.tmpDir = options.tmpDir ?? tmpdir()
    this.maxBodySize = options.maxBodySize ?? {
      memory: Number.POSITIVE_INFINITY,
      file: Number.POSITIVE_INFINITY,
      stream: Number.POSITIVE_INFINITY,
    }
  }

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    const routingInterceptor: StandardHandlerRoutingInterceptor<T> = async ({ next, ...interceptorOptions }) => {
      const tmpFiles = new RequestTmpFiles(this.tmpDir)
      let cleanupDeferred = false

      try {
        const result = await next({
          ...interceptorOptions,
          request: {
            ...interceptorOptions.request,
            resolveBody: hint => this.resolveBody(interceptorOptions, hint, tmpFiles),
          },
        })

        /**
         * A streaming response body transmits after this interceptor returns and
         * may read the uploaded tmp files while doing so, so their removal rides
         * on the body finishing instead. That covers abandoned transfers too: the
         * adapter cancels the body, which reaches the same finish hook only after
         * any in-flight procedure logic has completed.
         */
        if (result.matched && tmpFiles.inUse) {
          const body = result.response.body

          if (isAsyncIteratorObject(body)) {
            cleanupDeferred = true

            return {
              matched: true,
              response: {
                ...result.response,
                /**
                 * @warning
                 * Remember use `override` for AsyncIteratorObject to remain other special properties
                 */
                body: override(body, wrapAsyncIterator(body, { onFinish: () => tmpFiles.cleanup() })),
              },
            }
          }

          if (body instanceof ReadableStream) {
            cleanupDeferred = true

            return {
              matched: true,
              response: {
                ...result.response,
                body: wrapReadableStream(body, { onFinish: () => tmpFiles.cleanup() }),
              },
            }
          }
        }

        return result
      }
      finally {
        if (!cleanupDeferred) {
          await tmpFiles.cleanup()
        }
      }
    }

    return {
      ...options,
      routingInterceptors: [routingInterceptor, ...toArray(options.routingInterceptors)],
    }
  }

  private async resolveBody(
    interceptorOptions: StandardHandlerRoutingInterceptorOptions<T>,
    hint: StandardBodyHint | undefined,
    tmpFiles: RequestTmpFiles,
  ): Promise<StandardBody> {
    const { request } = interceptorOptions

    // The same resolution order the standard body parsers apply
    const resolvedHint = hint ?? resolveStandardBodyHint(request.headers)

    // A body-less request has nothing to limit or spool
    if (resolvedHint === 'none') {
      return request.resolveBody(hint)
    }

    const maxBodySize = await value(this.maxBodySize, interceptorOptions)

    /**
     * A form-data hint always means multipart here, even though it can also
     * arrive explicitly or through the standard-server header on a body that
     * is not. Such a body fails the multipart parse, unlike the standard
     * parser, which would fall back to urlencoded form data.
     */
    if (resolvedHint === 'form-data') {
      return this.parseMultipartBody(request, tmpFiles, maxBodySize)
    }

    if (resolvedHint === 'file') {
      return this.spoolFileBody(request, tmpFiles, maxBodySize.file)
    }

    if (resolvedHint === 'json' || resolvedHint === 'url-search-params') {
      return this.parseLimitedBody(request, hint, resolvedHint, maxBodySize.memory)
    }

    // Event streams and raw binary streams, the kinds consumed on the fly
    return this.parseLimitedBody(request, hint, resolvedHint, maxBodySize.stream)
  }

  /**
   * Enforces a size limit on a body the standard parser handles, counting the
   * raw bytes before handing them back for regular parsing.
   */
  private async parseLimitedBody(
    request: StandardLazyRequest,
    hint: StandardBodyHint | undefined,
    resolvedHint: StandardBodyHint,
    limit: number,
  ): Promise<StandardBody> {
    if (limit === Number.POSITIVE_INFINITY) {
      return request.resolveBody(hint)
    }

    assertContentLengthWithin(request.headers, limit)

    const stream = await request.resolveBody('octet-stream')

    // adapter might not support hint (e.g. peer adapter)
    if (!(stream instanceof ReadableStream)) {
      return stream
    }

    const response = new Response(limitStream(stream, limit), {
      headers: toFetchHeaders(request.headers),
    })

    return toStandardBody(response, { hint: resolvedHint })
  }

  private async spoolFileBody(request: StandardLazyRequest, tmpFiles: RequestTmpFiles, fileLimit: number): Promise<StandardBody> {
    assertContentLengthWithin(request.headers, fileLimit)

    const stream = await request.resolveBody('octet-stream')

    // adapter might not support hint (e.g. peer adapter)
    if (!(stream instanceof ReadableStream)) {
      return stream
    }

    const contentDisposition = flattenStandardHeader(request.headers['content-disposition'])
    const fileName = contentDisposition !== undefined ? getFilenameFromContentDisposition(contentDisposition) : undefined
    const contentType = flattenStandardHeader(request.headers['content-type'])

    const limited = limitStream(stream, fileLimit)

    const tmpPath = await tmpFiles.allocate()

    for await (const chunk of limited) {
      await tmpFiles.append(tmpPath, chunk)
    }

    return tmpFiles.seal(tmpPath, fileName ?? 'blob', contentType ?? '')
  }

  private async parseMultipartBody(request: StandardLazyRequest, tmpFiles: RequestTmpFiles, maxBodySize: TmpFileUploadHandlerPluginMaxBodySize): Promise<StandardBody> {
    const contentType = flattenStandardHeader(request.headers['content-type'])
    const boundary = contentType === undefined ? undefined : parseHeaderParameters(contentType).get('boundary')

    if (boundary === undefined || boundary === '') {
      throw new TypeError('Invalid multipart body: content-type header is missing the boundary parameter')
    }

    /**
     * The whole multipart body, framing included, can never exceed what its two
     * content categories allow together, which also bounds bodies that hide
     * their size in part headers rather than part content.
     */
    const totalLimit = maxBodySize.memory + maxBodySize.file

    assertContentLengthWithin(request.headers, totalLimit)

    const stream = await request.resolveBody('octet-stream')

    // adapter might not support hint (e.g. peer adapter)
    if (!(stream instanceof ReadableStream)) {
      return stream
    }

    const limited = limitStream(stream, totalLimit)

    const form = new FormData()
    let memoryUsed = 0
    let fileUsed = 0

    await parseMultipart(limited, boundary, (part) => {
      const name = part.name

      if (part.filename === undefined) {
        const chunks: Buffer[] = []

        return {
          write: (chunk) => {
            memoryUsed += chunk.length

            if (memoryUsed > maxBodySize.memory) {
              throw new ORPCError('PAYLOAD_TOO_LARGE')
            }

            // The parser only guarantees the chunk until write returns, so retaining it requires a copy
            chunks.push(Buffer.from(chunk))
          },
          end: () => {
            form.append(name, Buffer.concat(chunks).toString())
          },
        }
      }

      const filename = part.filename
      // A part without a content-type defaults to text/plain, matching the standard parser
      const type = part.type ?? 'text/plain'
      let tmpPath: string | undefined

      return {
        write: async (chunk) => {
          fileUsed += chunk.length

          if (fileUsed > maxBodySize.file) {
            throw new ORPCError('PAYLOAD_TOO_LARGE')
          }

          tmpPath ??= await tmpFiles.allocate()
          await tmpFiles.append(tmpPath, chunk)
        },
        end: async () => {
          tmpPath ??= await tmpFiles.allocate()
          form.append(name, await tmpFiles.seal(tmpPath, filename, type))
        },
      }
    })

    return form
  }
}

/**
 * Rejects early when the declared length already exceeds the limit. The length
 * can lie, so the streaming enforcement stays either way.
 */
function assertContentLengthWithin(headers: StandardHeaders, limit: number): void {
  const contentLength = Number(flattenStandardHeader(headers['content-length']))

  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new ORPCError('PAYLOAD_TOO_LARGE')
  }
}

function limitStream(stream: ReadableStream<Uint8Array>, limit: number): ReadableStream<Uint8Array> {
  let total = 0

  async function* generate(): AsyncGenerator<Uint8Array> {
    try {
      for await (const chunk of stream.values({ preventCancel: true })) {
        total += chunk.byteLength

        if (total > limit) {
          throw new ORPCError('PAYLOAD_TOO_LARGE')
        }

        yield chunk
      }
    }
    finally {
      void stream.pipeTo(new WritableStream()).catch(() => {})
    }
  }

  return ReadableStream.from(generate())
}

const EMPTY_CHUNK = new Uint8Array(0)

/**
 * Owns every temporary file a request creates: allocates them inside one lazily
 * created per-request directory and guarantees removal. Content lands through
 * self-contained appends rather than long-lived handles, so a request holds at
 * most one transient file descriptor per in-flight write no matter how many
 * files it carries, and removal never contends with an open handle on platforms
 * that cannot delete open files.
 *
 * Filesystem failures surface as `INTERNAL_SERVER_ERROR`, keeping them distinct
 * from the malformed-body errors the handler reports as `BAD_REQUEST`. Their
 * details ride only on `cause`, which is never serialized to the client.
 */
class RequestTmpFiles {
  private dir: Promise<string> | undefined
  private count = 0

  constructor(private readonly tmpDir: string) {}

  get inUse(): boolean {
    return this.dir !== undefined
  }

  async allocate(): Promise<string> {
    try {
      this.dir ??= mkdtemp(path.join(this.tmpDir, 'orpc-upload-'))
      return path.join(await this.dir, String(this.count++))
    }
    catch (cause) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { cause })
    }
  }

  async append(tmpPath: string, chunk: Uint8Array): Promise<void> {
    try {
      await appendFile(tmpPath, chunk)
    }
    catch (cause) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { cause })
    }
  }

  async seal(tmpPath: string, name: string, type: string): Promise<TmpFile> {
    try {
      // An empty upload never appended, so the backing file may not exist yet
      await appendFile(tmpPath, EMPTY_CHUNK)
      return new TmpFile(await openAsBlob(tmpPath), tmpPath, name, { type })
    }
    catch (cause) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', { cause })
    }
  }

  async cleanup(): Promise<void> {
    if (this.dir !== undefined) {
      try {
        await rm(await this.dir, { recursive: true, force: true })
      }
      catch {
        // The request outcome must not change because removal failed
      }
    }
  }
}
