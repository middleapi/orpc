import type { Interceptor } from './interceptor'
import {
  onAsyncIteratorObjectError,
  onError,
  onFinish,
  onReadableStreamError,
  onStart,
  onSuccess,
} from './interceptor'
import type { PromiseWithError } from './types'

it('onStart, onSuccess, onError, onFinish, onAsyncIteratorObjectError, onReadableStreamError can be used as an interceptor', () => {
  const interceptors: Interceptor<{ foo: string }, PromiseWithError<'success', 'error'>>[] = []

  interceptors.push(
    onStart((options) => {
      expectTypeOf(options.foo).toEqualTypeOf<string>()
      expectTypeOf(options.next).toBeCallableWith<[options?: { foo: string }]>()
      expectTypeOf(options.next()).toEqualTypeOf<PromiseWithError<'success', 'error'>>()
    }),
  )

  interceptors.push(
    onSuccess((result, options) => {
      expectTypeOf(result).toEqualTypeOf<'success'>()

      expectTypeOf(options.foo).toEqualTypeOf<string>()
      expectTypeOf(options.next).toBeCallableWith<[options?: { foo: string }]>()
      expectTypeOf(options.next()).toEqualTypeOf<PromiseWithError<'success', 'error'>>()
    }),
  )

  interceptors.push(
    onError((error, options) => {
      expectTypeOf(error).toEqualTypeOf<'error'>()

      expectTypeOf(options.foo).toEqualTypeOf<string>()
      expectTypeOf(options.next).toBeCallableWith<[options?: { foo: string }]>()
      expectTypeOf(options.next()).toEqualTypeOf<PromiseWithError<'success', 'error'>>()
    }),
  )

  interceptors.push(
    onFinish(([error, data, isSuccess], options) => {
      if (error || !isSuccess) {
        expectTypeOf(error).toEqualTypeOf<'error'>()
        expectTypeOf(data).toEqualTypeOf<undefined>()
      } else {
        expectTypeOf(error).toEqualTypeOf<null>()
        expectTypeOf(data).toEqualTypeOf<'success'>()
      }

      expectTypeOf(options.foo).toEqualTypeOf<string>()
      expectTypeOf(options.next).toBeCallableWith<[options?: { foo: string }]>()
      expectTypeOf(options.next()).toEqualTypeOf<PromiseWithError<'success', 'error'>>()
    }),
  )

  interceptors.push(
    onAsyncIteratorObjectError((error, options) => {
      expectTypeOf(error).toEqualTypeOf<'error' | Error>()

      expectTypeOf(options.foo).toEqualTypeOf<string>()
      expectTypeOf(options.next).toBeCallableWith<[options?: { foo: string }]>()
      expectTypeOf(options.next()).toEqualTypeOf<PromiseWithError<'success', 'error'>>()
    }),
  )

  interceptors.push(
    onReadableStreamError((error, options) => {
      expectTypeOf(error).toEqualTypeOf<'error' | Error>()

      expectTypeOf(options.foo).toEqualTypeOf<string>()
      expectTypeOf(options.next).toBeCallableWith<[options?: { foo: string }]>()
      expectTypeOf(options.next()).toEqualTypeOf<PromiseWithError<'success', 'error'>>()
    }),
  )
})

it('falls back to ThrowableError when next returns a plain Promise', () => {
  const interceptors: Interceptor<{ foo: string }, Promise<'success'>>[] = []

  interceptors.push(
    onError((error) => {
      expectTypeOf(error).toEqualTypeOf<Error>()
    }),
  )

  interceptors.push(
    onFinish(([error, data, isSuccess]) => {
      if (error || !isSuccess) {
        expectTypeOf(error).toEqualTypeOf<Error>()
        expectTypeOf(data).toEqualTypeOf<undefined>()
      } else {
        expectTypeOf(error).toEqualTypeOf<null>()
        expectTypeOf(data).toEqualTypeOf<'success'>()
      }
    }),
  )

  interceptors.push(
    onAsyncIteratorObjectError((error) => {
      expectTypeOf(error).toEqualTypeOf<Error>()
    }),
  )

  interceptors.push(
    onReadableStreamError((error) => {
      expectTypeOf(error).toEqualTypeOf<Error>()
    }),
  )
})
