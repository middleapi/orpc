import type { StandardLazyRequest } from '@standard-server/core'
import type { Stats } from 'node:fs'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { Readable } from 'node:stream'
import { StaticFileHandlerPlugin } from '@orpc/node'
import { RPCHandlerCodec, StandardHandler } from '@orpc/server/standard'
import { bench } from 'vitest'

/**
 * CodSpeed measures a single call, so files are served from memory: real fs calls hop through the
 * libuv thread pool and the event loop, which lets thread scheduling and unrelated callbacks
 * (like vitest's worker IPC) land in the measurement and flip results between runs.
 * The shared payloads are not imported either, since building them changes how much V8 compilation
 * lands in the first measured call.
 */
vi.mock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), createReadStream }))
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), stat, realpath }))

const rootDir = path.resolve('/static')
const mtime = new Date('2024-01-01T00:00:00.000Z')

const files = new Map([
  [path.join(rootDir, 'file.txt'), Buffer.alloc(10 * 1024, 'a')],
  [path.join(rootDir, 'deeply', 'nested', 'dir', 'file.txt'), Buffer.alloc(10 * 1024, 'a')],
])

function notFound(filePath: string): Error {
  return Object.assign(new Error(`ENOENT: no such file or directory, '${filePath}'`), { code: 'ENOENT' })
}

async function stat(filePath: string): Promise<Stats> {
  const content = files.get(filePath)

  if (content === undefined) {
    throw notFound(filePath)
  }

  return { size: content.length, mtime, isFile: () => true, isDirectory: () => false } as Stats
}

async function realpath(filePath: string): Promise<string> {
  if (filePath !== rootDir && !files.has(filePath)) {
    throw notFound(filePath)
  }

  return filePath
}

function createReadStream(filePath: string, { start = 0, end = Infinity }: { start?: number, end?: number } = {}): Readable {
  const chunk = files.get(filePath)!.subarray(start, end + 1)

  return new Readable({
    read() {
      this.push(chunk)
      this.push(null)
    },
  })
}

const handler = new StandardHandler(new RPCHandlerCodec({}, {}), {
  plugins: [new StaticFileHandlerPlugin({ rootDir })],
})

function createRequest(url: `/${string}`, headers: Record<string, string> = {}): StandardLazyRequest {
  return {
    url,
    method: 'GET',
    headers,
    resolveBody: () => Promise.resolve(undefined),
  }
}

async function drainBody(body: unknown): Promise<void> {
  const reader = (body as ReadableStream<Uint8Array>).getReader()

  while (!(await reader.read()).done) {
    // discard the chunk
  }
}

const { response } = await handler.handle(createRequest('/file.txt'), { context: {} })
await drainBody(response!.body)
const etag = response!.headers.etag as string

describe('static file handler plugin', () => {
  bench('serve file', async () => {
    const { response } = await handler.handle(createRequest('/file.txt'), { context: {} })
    await drainBody(response!.body)
  })

  bench('serve deeply nested encoded path', async () => {
    const { response } = await handler.handle(createRequest('/deeply/nested/dir/file%2etxt'), { context: {} })
    await drainBody(response!.body)
  })

  bench('range request', async () => {
    const { response } = await handler.handle(createRequest('/file.txt', { range: 'bytes=0-1023' }), { context: {} })
    await drainBody(response!.body)
  })

  bench('not modified (304)', async () => {
    await handler.handle(createRequest('/file.txt', { 'if-none-match': etag }), { context: {} })
  })

  bench('not found fall through', async () => {
    await handler.handle(createRequest('/missing/file.txt'), { context: {} })
  })
})
