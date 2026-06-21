import type { Promisable } from 'type-fest'
import type { StartSpanOptions } from './opentelemetry'
import { AsyncIteratorClass } from '@standardserver/shared'
import { once } from './function'
import { recordSpanError, runInSpanContext, startSpan } from './opentelemetry'
import { AsyncIdQueue } from './queue'

export interface WrapAsyncIteratorOptions<TYield, TReturn, TMappedYield, TMappedReturn> {
  /**
   * Any call to the original iterator will be executed inside this function.
   * Useful when you want execution to happen within a specific context,
   * such as AsyncLocalStorage.
   */
  runWith?: <T>(run: () => Promise<T>) => Promise<T>
  mapResult?: (result: IteratorResult<TYield, TReturn>) => Promisable<IteratorResult<TMappedYield, TMappedReturn>>
  mapError?: (error: unknown) => Promisable<unknown>
  onError?: (error: unknown) => Promisable<void>

  /**
   * Execute after the stream finishes or is cancelled.
   */
  onFinish?: () => Promisable<void>
}

export function wrapAsyncIterator<TYield, TReturn, TMappedYield = TYield, TMappedReturn = TReturn>(
  iterator: AsyncIterator<TYield, TReturn>,
  { runWith, mapResult, mapError, onError, onFinish }: WrapAsyncIteratorOptions<TYield, TReturn, TMappedYield, TMappedReturn>,
): NoInfer<AsyncIteratorClass<TMappedYield, TMappedReturn>> {
  runWith ??= run => run()

  let isDone: boolean | undefined

  return new AsyncIteratorClass<TMappedYield, TMappedReturn>(async () => {
    try {
      let result
      try {
        result = await runWith(() => iterator.next())
        isDone = result.done
      }
      catch (error) {
        isDone = true
        throw error
      }

      return mapResult ? await mapResult(result) : result as any
    }
    catch (error) {
      await onError?.(error)
      throw mapError ? await mapError(error) : error
    }
  }, async (_state) => {
    try {
      // Only cancel the original iterator if it has not finished yet.
      // Do not rely on _state because the user's options may throw errors.
      if (!isDone) {
        try {
          await runWith(async () => iterator.return?.())
        }
        catch (error) {
          await onError?.(error)
          throw error
        }
      }
    }
    finally {
      await onFinish?.()
    }
  })
}

export function traceAsyncIterator<T, TReturn, TNext>(
  options: StartSpanOptions | string,
  iterator: AsyncIterator<T, TReturn, TNext>,
): AsyncIteratorClass<T, TReturn, TNext> {
  const getSpan = once(() => startSpan(options))

  return wrapAsyncIterator(iterator, {
    runWith: run => runInSpanContext(getSpan(), run),
    mapResult(result) {
      getSpan()?.addEvent(result.done ? 'completed' : 'yielded')
      return result
    },
    onError(error) {
      recordSpanError(getSpan(), error)
    },
    onFinish() {
      getSpan()?.end()
    },
  })
}

export function replicateAsyncIterator<T, TReturn, TNext>(
  source: AsyncIterator<T, TReturn, TNext>,
  count: number,
): (AsyncIteratorClass<T, TReturn, TNext>)[] {
  const queue = new AsyncIdQueue<
    { next: IteratorResult<T, TReturn> } | { next?: never, error: unknown }
  >()

  const ids = Array.from({ length: count }, (_, i) => i.toString())
  let isSourceFinished = false

  const start = once(async () => {
    try {
      while (true) {
        const item = await source.next()

        ids.forEach((id) => {
          if (queue.isOpen(id)) {
            queue.push(id, { next: item })
          }
        })

        if (item.done) {
          break
        }
      }
    }
    catch (error) {
      ids.forEach((id) => {
        if (queue.isOpen(id)) {
          queue.push(id, { error })
        }
      })
    }
    finally {
      isSourceFinished = true
    }
  })

  const replicated: AsyncIteratorClass<T, TReturn, TNext>[] = ids.map((id) => {
    queue.open(id)

    return new AsyncIteratorClass(
      async () => {
        start()

        const item = await queue.pull(id)

        if (item.next) {
          return item.next
        }

        throw item.error
      },
      async ({ kind, error }) => {
        queue.close({ id, reason: error })

        if (kind === 'cancelled' && !queue.size && !isSourceFinished) {
          isSourceFinished = true
          await source?.return?.()
        }
      },
    )
  })

  return replicated
}
