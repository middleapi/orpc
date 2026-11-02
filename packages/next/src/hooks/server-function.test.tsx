import { ORPCError, os } from '@orpc/server'
import { act, renderHook, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { createServerFunction } from '../server-function'
import { useServerFunction } from './server-function'

export const inputSchema = z.object({ input: z.number().transform(n => `${n}`) })

export const outputSchema = z.object({ output: z.number().transform(n => `${n}`) })

export const baseErrorMap = {
  BASE: {
    data: outputSchema,
  },
  OVERRIDE: {},
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useServerFunction', () => {
  const handler = vi.fn(async ({ input }) => {
    return { output: Number(input?.input ?? 0) }
  })

  const fn = createServerFunction(
    os
      .input(inputSchema.optional())
      .errors(baseErrorMap)
      .output(outputSchema)
      .handler(handler),
  )

  it('on success', async () => {
    const { result } = renderHook(() => useServerFunction(fn))

    expect(result.current.status).toBe('idle')
    expect(result.current.isIdle).toBe(true)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toBe(undefined)
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)

    act(() => {
      result.current.execute({ input: 123 })
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.isIdle).toBe(false)
    expect(result.current.isPending).toBe(true)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual({ input: 123 })
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.isIdle).toBe(false)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(true)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual({ input: 123 })
    expect(result.current.data).toEqual({ output: '123' })
    expect(result.current.error).toBe(null)

    act(() => {
      result.current.reset()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.isIdle).toBe(true)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toBe(undefined)
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)
  })

  it('on error', async () => {
    const { result } = renderHook(() => useServerFunction(fn))

    expect(result.current.status).toBe('idle')
    expect(result.current.isIdle).toBe(true)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toBe(undefined)
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)

    act(() => {
      // @ts-expect-error --- invalid input
      result.current.execute({ input: 'invalid' })
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.isIdle).toBe(false)
    expect(result.current.isPending).toBe(true)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual({ input: 'invalid' })
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.isIdle).toBe(false)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.input).toEqual({ input: 'invalid' })
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBeInstanceOf(ORPCError)

    act(() => {
      result.current.reset()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.isIdle).toBe(true)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toBe(undefined)
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)
  })

  it('on action calling error', async () => {
    const { result } = renderHook(() => useServerFunction(() => {
      throw new Error('failed to call')
    }))

    expect(result.current.status).toBe('idle')
    expect(result.current.isIdle).toBe(true)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toBe(undefined)
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)

    act(() => {
      result.current.execute({ input: 123 })
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.isIdle).toBe(false)
    expect(result.current.isPending).toBe(true)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual({ input: 123 })
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.isIdle).toBe(false)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.input).toEqual({ input: 123 })
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error!.message).toBe('failed to call')

    act(() => {
      result.current.reset()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.isIdle).toBe(true)
    expect(result.current.isPending).toBe(false)
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toBe(undefined)
    expect(result.current.data).toBe(undefined)
    expect(result.current.error).toBe(null)
  })

  it('interceptors', async () => {
    const interceptor = vi.fn(({ next }) => next())
    const executeInterceptor = vi.fn(({ next }) => next())

    const { result } = renderHook(() => useServerFunction(fn, {
      interceptors: [
        interceptor,
      ],
    }))

    expect(interceptor).toHaveBeenCalledTimes(0)
    expect(executeInterceptor).toHaveBeenCalledTimes(0)

    act(() => {
      result.current.execute({ input: 123 }, {
        interceptors: [
          executeInterceptor,
        ],
      })
    })

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(executeInterceptor).toHaveBeenCalledTimes(1)

    expect(interceptor).toHaveBeenCalledWith({
      input: { input: 123 },
      next: expect.any(Function),
    })

    expect(executeInterceptor).toHaveBeenCalledWith({
      input: { input: 123 },
      next: expect.any(Function),
    })

    // Wrap the expectations in act() to properly handle state updates
    await act(async () => {
      expect(await interceptor.mock.results[0]!.value).toEqual({ output: '123' })
      expect(await executeInterceptor.mock.results[0]!.value).toEqual({ output: '123' })
    })
  })

  describe('interceptors change between renders', () => {
    const a = vi.fn(({ next }) => next())
    const b = vi.fn(({ next }) => next())

    function setup(initialInterceptors: any[] | undefined) {
      return renderHook(
        ({ interceptors }) => useServerFunction(fn, { interceptors }),
        { initialProps: { interceptors: initialInterceptors } },
      )
    }

    async function execute(result: { current: ReturnType<typeof useServerFunction<any, any, any>> }) {
      await act(async () => {
        await result.current.execute({ input: 123 })
      })
    }

    it('[a] -> [a, b]', async () => {
      const { result, rerender } = setup([a])

      rerender({ interceptors: [a, b] })
      await execute(result)

      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(1)
    })

    it('undefined -> [a]', async () => {
      const { result, rerender } = setup(undefined)

      rerender({ interceptors: [a] })
      await execute(result)

      expect(a).toHaveBeenCalledTimes(1)
    })

    it('[a, b] -> [a]', async () => {
      const { result, rerender } = setup([a, b])

      rerender({ interceptors: [a] })
      await execute(result)

      expect(a).toHaveBeenCalledTimes(1)
      expect(b).toHaveBeenCalledTimes(0)
    })

    it('[a] -> undefined', async () => {
      const { result, rerender } = setup([a])

      rerender({ interceptors: undefined })
      await execute(result)

      expect(a).toHaveBeenCalledTimes(0)
    })

    it('keeps execute stable across renders', () => {
      const { result, rerender } = setup([a])
      const execute = result.current.execute

      rerender({ interceptors: [a, b] })
      expect(result.current.execute).toBe(execute)

      rerender({ interceptors: [vi.fn(({ next }) => next())] })
      expect(result.current.execute).toBe(execute)

      rerender({ interceptors: undefined })
      expect(result.current.execute).toBe(execute)
    })
  })

  it('multiple execute calls', async () => {
    const { result } = renderHook(() => useServerFunction(fn))

    expect(result.current.status).toBe('idle')

    handler.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      return { output: 123 }
    })

    let promise: Promise<any>

    act(() => {
      promise = result.current.execute({ input: 123 })
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.executedAt).toBeDefined()
    expect(result.current.input).toEqual({ input: 123 })
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeNull()

    handler.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 40))
      return { output: 456 }
    })

    let promise2: Promise<any>

    act(() => {
      promise2 = result.current.execute({ input: 456 })
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.executedAt).toBeDefined()
    expect(result.current.input).toEqual({ input: 456 })
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeNull()

    await act(async () => {
      expect((await promise!)[1]).toEqual({ output: '123' })
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.executedAt).toBeDefined()
    expect(result.current.input).toEqual({ input: 456 })
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeNull()

    await act(async () => {
      expect((await promise2!)[1]).toEqual({ output: '456' })
    })

    expect(result.current.status).toBe('success')
    expect(result.current.executedAt).toBeDefined()
    expect(result.current.input).toEqual({ input: 456 })
    expect(result.current.data).toEqual({ output: '456' })
    expect(result.current.error).toBeNull()
  })

  it('reset while executing', async () => {
    const { result } = renderHook(() => useServerFunction(fn))

    expect(result.current.status).toBe('idle')

    handler.mockImplementationOnce(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      return { output: 123 }
    })

    let promise: Promise<any>

    act(() => {
      promise = result.current.execute({ input: 123 })
    })

    expect(result.current.status).toBe('pending')
    expect(result.current.executedAt).toBeDefined()
    expect(result.current.input).toEqual({ input: 123 })
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeNull()

    act(() => {
      result.current.reset()
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.executedAt).toBeUndefined()
    expect(result.current.input).toBeUndefined()
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeNull()

    await act(async () => {
      expect((await promise!)[1]).toEqual({ output: '123' })
    })

    expect(result.current.status).toBe('idle')
    expect(result.current.executedAt).toBeUndefined()
    expect(result.current.input).toBeUndefined()
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toBeNull()
  })
})
