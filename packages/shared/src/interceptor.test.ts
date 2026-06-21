import { intercept, onError, onFinish, onStart, onSuccess } from './interceptor'

describe('intercept', () => {
  const interceptor1 = vi.fn(({ next }) => next())
  const interceptor2 = vi.fn(({ next }) => next())
  const asyncMain = vi.fn(() => Promise.resolve('__main__'))

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when an interceptor returns its own result', () => {
    it('should keep a synchronous interceptor result and defer main until next is called', async () => {
      const main = vi.fn(() => '__main__')
      interceptor2.mockReturnValueOnce('__interceptor2__')

      const result = await intercept(
        [
          interceptor1,
          interceptor2,
        ],
        {
          foo: 'bar',
        },
        main,
      )

      expect(result).toEqual('__interceptor2__')
      expect(interceptor1).toHaveBeenCalledTimes(1)
      expect(interceptor1).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(interceptor2).toHaveBeenCalledTimes(1)
      expect(interceptor2).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(main).toHaveBeenCalledTimes(0)

      expect(interceptor2.mock.calls[0]![0].next()).toEqual('__main__')
      expect(main).toHaveBeenCalledTimes(1)
      expect(main).toHaveBeenCalledWith({
        foo: 'bar',
      })
    })

    it('should keep an asynchronous interceptor result and defer main until next is called', async () => {
      interceptor2.mockReturnValueOnce(Promise.resolve('__interceptor2__'))

      const result = await intercept(
        [
          interceptor1,
          interceptor2,
        ],
        {
          foo: 'bar',
        },
        asyncMain,
      )

      expect(result).toEqual('__interceptor2__')
      expect(interceptor1).toHaveBeenCalledTimes(1)
      expect(interceptor1).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(interceptor2).toHaveBeenCalledTimes(1)
      expect(interceptor2).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(asyncMain).toHaveBeenCalledTimes(0)

      expect(await interceptor2.mock.calls[0]![0].next()).toEqual('__main__')
      expect(asyncMain).toHaveBeenCalledTimes(1)
      expect(asyncMain).toHaveBeenCalledWith({
        foo: 'bar',
      })
    })
  })

  describe('when forwarding execution', () => {
    it('should allow an interceptor to replace the forwarded options', async () => {
      interceptor1.mockImplementationOnce(({ next }) => next({ bar: 'foo' }))

      const result = await intercept(
        [
          interceptor1,
          interceptor2,
        ],
        {
          foo: 'bar',
        },
        asyncMain,
      )

      expect(result).toEqual('__main__')

      expect(interceptor1).toHaveBeenCalledTimes(1)
      expect(interceptor1).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(interceptor2).toHaveBeenCalledTimes(1)
      expect(interceptor2).toHaveBeenCalledWith({
        bar: 'foo',
        next: expect.any(Function),
      })

      expect(asyncMain).toHaveBeenCalledTimes(1)
      expect(asyncMain).toHaveBeenCalledWith({
        bar: 'foo',
      })
    })

    it('should keep a user-provided next field when forwarding custom options', async () => {
      interceptor2.mockImplementationOnce(({ next }) => next({ bar: 'foo', next: 'hello2' }))

      const result = await intercept(
        [
          interceptor1,
          interceptor2,
        ],
        {
          foo: 'bar',
          next: 'hello',
        },
        asyncMain,
      )

      expect(result).toEqual('__main__')

      expect(interceptor1).toHaveBeenCalledTimes(1)
      expect(interceptor1).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(interceptor2).toHaveBeenCalledTimes(1)
      expect(interceptor2).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(asyncMain).toHaveBeenCalledTimes(1)
      expect(asyncMain).toHaveBeenCalledWith({
        bar: 'foo',
        next: 'hello2',
      })
    })

    it('should allow calling next multiple times', async () => {
      interceptor2.mockReturnValueOnce(Promise.resolve('__interceptor2__'))

      const result = await intercept(
        [
          async ({ next }) => [await next(), await next(), await next()],
          interceptor1,
          interceptor2,
        ],
        {
          foo: 'bar',
        },
        asyncMain,
      )

      expect(result).toEqual(['__interceptor2__', '__main__', '__main__'])

      expect(interceptor1).toHaveBeenCalledTimes(3)
      expect(interceptor1).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(interceptor2).toHaveBeenCalledTimes(3)
      expect(interceptor2).toHaveBeenCalledWith({
        foo: 'bar',
        next: expect.any(Function),
      })

      expect(asyncMain).toHaveBeenCalledTimes(2)
      expect(asyncMain).toHaveBeenCalledWith({
        foo: 'bar',
      })
    })

    it('should allow overriding options independently for each next call', async () => {
      const main: any = vi.fn(async (options: { foo: string, requestId: number }) => `${options.foo}:${options.requestId}`)

      const result = await intercept(
        [
          async ({ next }) => [
            await next({ foo: 'first', requestId: 1 }),
            await next({ foo: 'second', requestId: 2 }),
            await next({ foo: 'third', requestId: 3 }),
          ],
          interceptor1,
          interceptor2,
        ],
        {
          foo: 'initial',
          requestId: 0,
        },
        main,
      )

      expect(result).toEqual(['first:1', 'second:2', 'third:3'])

      expect(interceptor1).toHaveBeenCalledTimes(3)
      expect(interceptor1).toHaveBeenNthCalledWith(1, {
        foo: 'first',
        requestId: 1,
        next: expect.any(Function),
      })
      expect(interceptor1).toHaveBeenNthCalledWith(2, {
        foo: 'second',
        requestId: 2,
        next: expect.any(Function),
      })
      expect(interceptor1).toHaveBeenNthCalledWith(3, {
        foo: 'third',
        requestId: 3,
        next: expect.any(Function),
      })

      expect(interceptor2).toHaveBeenCalledTimes(3)
      expect(interceptor2).toHaveBeenNthCalledWith(1, {
        foo: 'first',
        requestId: 1,
        next: expect.any(Function),
      })
      expect(interceptor2).toHaveBeenNthCalledWith(2, {
        foo: 'second',
        requestId: 2,
        next: expect.any(Function),
      })
      expect(interceptor2).toHaveBeenNthCalledWith(3, {
        foo: 'third',
        requestId: 3,
        next: expect.any(Function),
      })

      expect(main).toHaveBeenCalledTimes(3)
      expect(main).toHaveBeenNthCalledWith(1, {
        foo: 'first',
        requestId: 1,
      })
      expect(main).toHaveBeenNthCalledWith(2, {
        foo: 'second',
        requestId: 2,
      })
      expect(main).toHaveBeenNthCalledWith(3, {
        foo: 'third',
        requestId: 3,
      })
    })
  })

  describe('when interceptors are not provided', () => {
    it('should call the main handler directly', () => {
      const main = vi.fn(() => '__main__')

      const result = intercept(undefined, { foo: 'bar' }, main)

      expect(result).toEqual('__main__')
      expect(main).toHaveBeenCalledTimes(1)
      expect(main).toHaveBeenCalledWith({
        foo: 'bar',
      })

      const result2 = intercept([], { foo: 'bar' }, main)
      expect(result2).toEqual('__main__')

      expect(main).toHaveBeenCalledTimes(2)
      expect(main).toHaveBeenCalledWith({
        foo: 'bar',
      })
    })
  })
})

describe('lifecycle interceptors', () => {
  const onStartFn = vi.fn()
  const onSuccessFn = vi.fn()
  const onErrorFn = vi.fn()
  const onFinishFn = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should run start, success, and finish hooks for successful calls', async () => {
    const result = await intercept(
      [
        onStart(onStartFn),
        onSuccess(onSuccessFn),
        onError(onErrorFn),
        onFinish(onFinishFn),
      ],
      {
        foo: 'bar',
      },
      () => Promise.resolve('__main__'),
    )

    expect(result).toEqual('__main__')

    expect(onStartFn).toHaveBeenCalledTimes(1)
    expect(onStartFn).toHaveBeenCalledWith({
      foo: 'bar',
      next: expect.any(Function),
    })

    expect(onSuccessFn).toHaveBeenCalledTimes(1)
    expect(onSuccessFn).toHaveBeenCalledWith(
      '__main__',
      {
        foo: 'bar',
        next: expect.any(Function),
      },
    )

    expect(onFinishFn).toHaveBeenCalledTimes(1)
    expect(onFinishFn).toHaveBeenCalledWith(
      [null, '__main__', true],
      {
        foo: 'bar',
        next: expect.any(Function),
      },
    )

    expect(onErrorFn).toHaveBeenCalledTimes(0)
  })

  it('should run start, error, and finish hooks for failed calls', async () => {
    const error = new Error('__error__')

    await expect(intercept(
      [
        onStart(onStartFn),
        onSuccess(onSuccessFn),
        onError(onErrorFn),
        onFinish(onFinishFn),
      ],
      {
        foo: 'bar',
      },
      () => Promise.reject(error),
    )).rejects.toThrow('__error__')

    expect(onStartFn).toHaveBeenCalledTimes(1)
    expect(onStartFn).toHaveBeenCalledWith({
      foo: 'bar',
      next: expect.any(Function),
    })

    expect(onErrorFn).toHaveBeenCalledTimes(1)
    expect(onErrorFn).toHaveBeenCalledWith(
      error,
      {
        foo: 'bar',
        next: expect.any(Function),
      },
    )

    expect(onFinishFn).toHaveBeenCalledTimes(1)
    expect(onFinishFn).toHaveBeenCalledWith(
      [error, undefined, false],
      {
        foo: 'bar',
        next: expect.any(Function),
      },
    )

    expect(onSuccessFn).toHaveBeenCalledTimes(0)
  })
})
