import type { SetSpanErrorOptions } from '@orpc/shared'
import { AbortError, AsyncIteratorClass, isTypescriptObject, parseEmptyableJSON, runInSpanContext, setSpanError, startSpan, stringifyJSON } from '@orpc/shared'
import { encodeEventMessage, ErrorEvent, EventDecoderStream, getEventMeta, withEventMeta } from '@orpc/standard-server'

export interface ToEventIteratorOptions extends SetSpanErrorOptions {}

export function toEventIterator(
  stream: ReadableStream<Uint8Array> | null,
  options: ToEventIteratorOptions = {},
): AsyncIteratorClass<unknown> {
  const eventStream = stream
    ?.pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventDecoderStream())

  const reader = eventStream?.getReader()
  let span: ReturnType<typeof startSpan> | undefined
  let isCancelled = false

  return new AsyncIteratorClass(async () => {
    span ??= startSpan('consume_event_iterator_stream')

    try {
      while (true) {
        if (reader === undefined) {
          return { done: true, value: undefined }
        }

        const { done, value } = await runInSpanContext(span, () => reader.read())

        /**
         * Handle stream completion scenarios:
         *
         * 1. If the reader is cancelled while waiting for the next value,
         *    reader.read() will resolve as { done: true, value: undefined }.
         *    However, this behavior is unreliable and we should only resolve
         *    a value when the sender explicitly indicates completion.
         *
         * 2. The only implicit behavior we allow is when the sender successfully
         *    closes the stream without sending a 'done' event - in this case,
         *    we resolve with { done: true, value: undefined }.
         */
        if (done) {
          if (isCancelled) {
            throw new AbortError('Stream was cancelled')
          }

          return { done: true, value: undefined }
        }

        switch (value.event) {
          case 'message': {
            let message = parseEmptyableJSON(value.data)

            if (isTypescriptObject(message)) {
              message = withEventMeta(message, value)
            }

            span?.addEvent('message')
            return { done: false, value: message }
          }

          case 'error': {
            let error = new ErrorEvent({
              data: parseEmptyableJSON(value.data),
            })

            error = withEventMeta(error, value)

            span?.addEvent('error')
            throw error
          }

          case 'done': {
            let done = parseEmptyableJSON(value.data)

            if (isTypescriptObject(done)) {
              done = withEventMeta(done, value)
            }

            span?.addEvent('done')
            return { done: true, value: done }
          }
          default: {
            span?.addEvent('maybe_keepalive')
          }
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
        isCancelled = true
        span?.addEvent('cancelled')
      }

      await runInSpanContext(span, () => reader?.cancel())
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

export interface ToEventStreamOptions {
  /**
   * If true, a ping comment is sent periodically to keep the connection alive.
   *
   * @default true
   */
  eventIteratorKeepAliveEnabled?: boolean

  /**
   * Interval (in milliseconds) between ping comments sent after the last event.
   *
   * @default 5000
   */
  eventIteratorKeepAliveInterval?: number

  /**
   * The content of the ping comment. Must not include newline characters.
   *
   * @default ''
   */
  eventIteratorKeepAliveComment?: string

  /**
   * If true, an initial comment is sent immediately upon stream start to flush headers.
   * This allows the receiving side to establish the connection without waiting for the first event.
   *
   * @default true
   */
  eventIteratorInitialCommentEnabled?: boolean

  /**
   * The content of the initial comment sent upon stream start. Must not include newline characters.
   *
   * @default ''
   */
  eventIteratorInitialComment?: string
}

export function toEventStream(
  iterator: AsyncIterator<unknown | void, unknown | void, void>,
  options: ToEventStreamOptions = {},
): ReadableStream<Uint8Array> {
  const keepAliveEnabled = options.eventIteratorKeepAliveEnabled ?? true
  const keepAliveInterval = options.eventIteratorKeepAliveInterval ?? 5000
  const keepAliveComment = options.eventIteratorKeepAliveComment ?? ''
  const initialCommentEnabled = options.eventIteratorInitialCommentEnabled ?? true
  const initialComment = options.eventIteratorInitialComment ?? ''

  let cancelled = false
  let timeout: ReturnType<typeof setInterval> | undefined
  let span: ReturnType<typeof startSpan> | undefined

  const stream = new ReadableStream<string>({
    start(controller) {
      span = startSpan('stream_event_iterator')

      if (initialCommentEnabled) {
        controller.enqueue(encodeEventMessage({
          comments: [initialComment],
        }))
      }
    },
    async pull(controller) {
      try {
        if (keepAliveEnabled) {
          timeout = setInterval(() => {
            controller.enqueue(encodeEventMessage({
              comments: [keepAliveComment],
            }))
            span?.addEvent('keepalive')
          }, keepAliveInterval)
        }

        const value = await runInSpanContext(span, () => iterator.next())

        clearInterval(timeout)

        if (cancelled) {
          return
        }

        const meta = getEventMeta(value.value)

        if (!value.done || value.value !== undefined || meta !== undefined) {
          const event = value.done ? 'done' : 'message'
          controller.enqueue(encodeEventMessage({
            ...meta,
            event,
            data: stringifyJSON(value.value),
          }))
          span?.addEvent(event)
        }

        if (value.done) {
          controller.close()
          span?.end()
        }
      }
      catch (err) {
        clearInterval(timeout)

        if (cancelled) {
          return
        }

        if (err instanceof ErrorEvent) {
          controller.enqueue(encodeEventMessage({
            ...getEventMeta(err),
            event: 'error',
            data: stringifyJSON(err.data),
          }))
          span?.addEvent('error')
          controller.close()
        }
        else {
          /**
           * Should treat a non-ErrorEvent as an error.
           */
          setSpanError(span, err)
          controller.error(err)
        }

        span?.end()
      }
    },
    async cancel() {
      try {
        cancelled = true
        clearInterval(timeout)
        span?.addEvent('cancelled')

        await runInSpanContext(span, () => iterator.return?.())
      }
      catch (e) {
        setSpanError(span, e)
        throw e
      }
      finally {
        span?.end()
      }
    },
  }).pipeThrough(new TextEncoderStream())

  return stream
}
