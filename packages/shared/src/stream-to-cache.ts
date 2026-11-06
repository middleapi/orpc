import { throwIfAborted } from '@standard-server/shared'

import { limitArraySize } from './array.ts'

export interface PipeStreamToCacheOptions<TChunk, TData> {
  /** Once aborted, nothing more is written; the stream is closed and `signal.reason` is thrown. */
  signal: AbortSignal
  /** Applies `updater` to the cached value synchronously. */
  update: (updater: (current: TData | undefined) => TData) => void
  /** One write made when the stream connects, before the first chunk. Omit it to write nothing at connect. */
  onConnect?: ((current: TData | undefined) => TData) | undefined
  onChunk: (current: TData | undefined, chunk: TChunk) => TData
  /** Called right after the first write only. `true` closes the stream and resolves with the data so far. */
  settle?: (() => boolean) | undefined
}

/**
 * The shared core of streamed and live queries: writes nothing before the stream connects, then each write reads the cache live.
 * @returns the last written data, or `undefined` if nothing was written
 */
export async function pipeStreamToCache<TChunk, TData>(
  stream: AsyncIterable<TChunk>,
  { signal, update, onConnect, onChunk, settle }: PipeStreamToCacheOptions<TChunk, TData>,
): Promise<{ data: TData } | undefined> {
  let last: { data: TData } | undefined

  // true = stop
  const write = (updater: (current: TData | undefined) => TData): boolean => {
    const isFirst = last === undefined
    update((current) => {
      const data = updater(current)
      last = { data }
      return data
    })
    return (isFirst && settle?.() === true) || signal.aborted
  }

  const iterator = stream[Symbol.asyncIterator]()
  // a stream that fails to close must not hide the result or the original error
  const close = async (): Promise<void> => {
    try {
      await iterator.return?.()
    } catch {}
  }

  try {
    if (signal.aborted || (onConnect !== undefined && write(onConnect))) {
      await close()
    } else {
      while (true) {
        const result = await iterator.next()

        if (result.done) {
          break
        }

        if (signal.aborted || write((current) => onChunk(current, result.value))) {
          await close()
          break
        }
      }
    }
  } catch (error) {
    await close()
    throwIfAborted(signal)
    throw error
  }

  throwIfAborted(signal)
  return last
}

export interface StreamedArrayOptions {
  /**
   * What a fetch does with data already in the cache once its stream connects.
   * Until then the data stays, so a query with data never returns to `pending`.
   *
   * - `'reset'`: replaced by `[]`, then each chunk is appended.
   * - `'append'`: kept (trimmed to `maxChunks`), and each chunk is appended.
   *
   * @default 'reset'
   */
  refetchMode?: 'reset' | 'append' | undefined

  /**
   * Limits the number of data chunks stored in the query result.
   * Older chunks are removed when the limit is reached.
   *
   * @default Number.POSITIVE_INFINITY (unlimited)
   */
  maxChunks?: number | undefined
}

/**
 * The `onConnect` and `onChunk` writes of a streamed query, which collects chunks into an array.
 */
export function streamedArrayWrites<T>({
  refetchMode = 'reset',
  maxChunks = Number.POSITIVE_INFINITY,
}: StreamedArrayOptions = {}): Required<
  Pick<PipeStreamToCacheOptions<T, T[]>, 'onConnect' | 'onChunk'>
> {
  return {
    onConnect: (current) =>
      refetchMode === 'append' ? limitArraySize(current ?? [], maxChunks) : [],
    onChunk: (current, chunk) => limitArraySize([...(current ?? []), chunk], maxChunks),
  }
}

/**
 * The part of `StreamedArrayOptions` that belongs in the query key, so queries with different options get separate entries.
 * Defaults are left out, so default options produce the same key as no options.
 */
export function streamedArrayKeyOptions(
  options: StreamedArrayOptions | undefined,
): StreamedArrayOptions | undefined {
  const { refetchMode = 'reset', maxChunks = Number.POSITIVE_INFINITY } = options ?? {}

  const keyOptions: StreamedArrayOptions = {
    ...(refetchMode !== 'reset' ? { refetchMode } : {}),
    ...(maxChunks !== Number.POSITIVE_INFINITY ? { maxChunks } : {}),
  }

  return Object.keys(keyOptions).length > 0 ? keyOptions : undefined
}

/**
 * Runs `fn` with a signal that follows `signal` and is also aborted once `fn` ends,
 * so the call that opened a stream is told to stop as soon as the stream is no longer read.
 */
export async function runWithOwnSignal<T>(
  signal: AbortSignal,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()

  if (signal.aborted) {
    controller.abort(signal.reason)
  } else {
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
      signal: controller.signal,
    })
  }

  try {
    return await fn(controller.signal)
  } finally {
    controller.abort()
  }
}
