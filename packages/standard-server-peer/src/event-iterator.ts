import type { AsyncIteratorClassCleanupFn, SetSpanErrorOptions } from '@orpc/shared'
import type { AsyncIdQueue } from '../../shared/src/queue'
import type { EventIteratorPayload } from './codec'
import { AsyncIteratorClass, isInSentryContext, isTypescriptObject, runInSpanContext, runWithSpan, setSpanError, startSpan } from '@orpc/shared'
import { ErrorEvent, getEventMeta, withEventMeta } from '@orpc/standard-server'

export interface ToEventIteratorOptions extends SetSpanErrorOptions { }

export function toEventIterator(
  queue: AsyncIdQueue<EventIteratorPayload>,
  id: string,
  cleanup: AsyncIteratorClassCleanupFn,
  options: ToEventIteratorOptions = {},
): AsyncIteratorClass<unknown> {
  let span: ReturnType<typeof startSpan> | undefined

  return new AsyncIteratorClass(async () => {
    span ??= startSpan('consume_event_iterator_stream')

    try {
      const item = await runInSpanContext(span, () => queue.pull(id))

      switch (item.event) {
        case 'message': {
          let data = item.data

          if (item.meta && isTypescriptObject(data)) {
            data = withEventMeta(data, item.meta)
          }

          span?.addEvent('message')

          return { value: data, done: false }
        }

        case 'error': {
          let error = new ErrorEvent({
            data: item.data,
          })

          if (item.meta) {
            error = withEventMeta(error, item.meta)
          }

          span?.addEvent('error')

          throw error
        }

        case 'done': {
          let data = item.data

          if (item.meta && isTypescriptObject(data)) {
            data = withEventMeta(data, item.meta)
          }

          span?.addEvent('done')

          return { value: data, done: true }
        }
      }
    }
    catch (e) {
      /**
       * Shouldn't treat an error event as an error.
       */
      if (!(e instanceof ErrorEvent)) {
        setSpanError(span, e, options)
      }

      throw e
    }
  }, async (reason) => {
    try {
      if (reason !== 'next') {
        span?.addEvent('cancelled')
      }

      await runInSpanContext(span, () => cleanup(reason))
    }
    catch (e) {
      setSpanError(span, e, options)
      throw e
    }
    finally {
      span?.end()
    }
  })
}

export function resolveEventIterator(
  iterator: AsyncIterator<any>,
  callback: (payload: EventIteratorPayload) => Promise<'next' | 'abort'>,
): Promise<void> {
  return runWithSpan(
    { name: 'stream_event_iterator' },
    async (span) => {
      if (isInSentryContext()) {
        span?.setAttribute('sentry.op', 'orpc')
      }
      while (true) {
        const payload: EventIteratorPayload = await (async () => {
          try {
            const { value, done } = await iterator.next()

            if (done) {
              span?.addEvent('done')
              return { event: 'done', data: value, meta: getEventMeta(value) }
            }

            span?.addEvent('message')
            return { event: 'message', data: value, meta: getEventMeta(value) }
          }
          catch (err) {
            /**
             * Shouldn't treat an error event as an error.
             */
            if (err instanceof ErrorEvent) {
              span?.addEvent('error')
              return {
                event: 'error',
                data: err.data,
                meta: getEventMeta(err),
              }
            }
            else {
              /**
               * Unlike HTTP/fetch streams where the server/client can detect unexpected stream termination,
               * in this custom implementation (long-lived connection), we must manually send error messages
               * to indicate that the iterator has ended with an error, even for non-ErrorEvent errors.
               * This prevents the server/client from hanging while waiting for the next event.
               *
               * @todo we should have a dedicated event for unexpected errors
               * to prevent deserialize errors (because data is always undefined)
               */
              try {
                await callback({ event: 'error', data: undefined })
              }
              catch (err2) {
                /**
                 * Record error in the span
                 * err2 will be captured later after throw
                 */
                setSpanError(span, err)
                throw err2
              }

              throw err
            }
          }
        })()

        let isInvokeCleanupFn = false

        try {
          const direction = await callback(payload)

          if (payload.event === 'done' || payload.event === 'error') {
            return
          }

          if (direction === 'abort') {
            isInvokeCleanupFn = true
            await iterator.return?.()
            return
          }
        }
        catch (err) {
          if (!isInvokeCleanupFn) {
            try {
              await iterator.return?.()
            }
            catch (err2) {
              /**
               * Record original error in the span
               * err2 will be captured later after throw
               */
              setSpanError(span, err)
              throw err2
            }
          }
          throw err
        }
      }
    },
  )
}
