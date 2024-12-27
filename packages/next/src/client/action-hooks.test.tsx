import { os } from '@orpc/server'
import { renderHook } from '@testing-library/react'
import { z } from 'zod'
import { useAction } from './action-hooks'

describe('useAction', () => {
  const procedure = os.input(z.object({ value: z.string() })).handler(async ({ value }) => {
    await new Promise(resolve => setTimeout(resolve, 100))
    return value
  })

  it('should work - on success', async () => {
    const { result } = renderHook(() => useAction(procedure))

    expect(result.current.status).toBe('idle')
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toBe(undefined)
    expect(result.current.error).toBe(undefined)
    expect(result.current.output).toBe(undefined)

    result.current.execute({ value: 'hello' })

    await vi.waitFor(() => expect(result.current.status).toBe('pending'))
    expect(result.current.isPending).toBe(true)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual({ value: 'hello' })
    expect(result.current.error).toEqual(undefined)
    expect(result.current.output).toEqual(undefined)

    await vi.waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual({ value: 'hello' })
    expect(result.current.output).toEqual('hello')
    expect(result.current.error).toEqual(undefined)

    result.current.reset()

    await vi.waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual(undefined)
    expect(result.current.output).toEqual(undefined)
    expect(result.current.error).toEqual(undefined)
  })

  it('should work - on error', async () => {
    const { result } = renderHook(() => useAction(procedure))

    expect(result.current.status).toBe('idle')
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual(undefined)
    expect(result.current.output).toEqual(undefined)
    expect(result.current.error).toEqual(undefined)

    // @ts-expect-error - invalid input
    result.current.execute({ value: 12334 })

    await vi.waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.input).toEqual({ value: 12334 })
    expect(result.current.output).toEqual(undefined)
    expect(result.current.error?.message).toEqual('Input validation failed')
  })

  it('return result on execute', async () => {
    const { result } = renderHook(() => useAction(procedure))

    const [output, error, status] = await result.current.execute({ value: 'hello' })

    expect(output).toBe('hello')
    expect(error).toBe(undefined)
    expect(status).toBe('success')

    await vi.waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.input).toEqual({ value: 'hello' })
    expect(result.current.output).toEqual('hello')
    expect(result.current.error).toEqual(undefined)

    // @ts-expect-error - invalid input
    const [output2, error2, status2] = await result.current.execute({ value: 123 })

    expect(output2).toBe(undefined)
    expect(error2?.message).toBe('Input validation failed')
    expect(status2).toBe('error')

    await vi.waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.input).toEqual({ value: 123 })
    expect(result.current.output).toEqual(undefined)
    expect(result.current.error?.message).toBe('Input validation failed')
  })

  it('hooks', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()

    const { result } = renderHook(() => useAction(procedure, { onSuccess, onError }))

    result.current.execute({ value: 'hello' }, { onSuccess, onError })

    await vi.waitFor(() => expect(result.current.status).toBe('success'))

    expect(onSuccess).toHaveBeenCalledTimes(2)
    expect(onSuccess).toHaveBeenNthCalledWith(1, {
      input: { value: 'hello' },
      output: 'hello',
      error: undefined,
      status: 'success',
    }, undefined, undefined)
    expect(onSuccess).toHaveBeenNthCalledWith(2, {
      input: { value: 'hello' },
      output: 'hello',
      error: undefined,
      status: 'success',
    }, undefined, undefined)

    expect(onError).not.toHaveBeenCalled()
  })
})
