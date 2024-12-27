import { os } from '@orpc/server'
import { renderHook } from '@testing-library/react'
import { z } from 'zod'
import { createSafeAction } from '../action-safe'
import { useSafeAction } from './action-safe-hooks'

describe('useSafeAction', () => {
  const procedure = os.input(z.object({ value: z.string() })).handler(async ({ value }) => {
    await new Promise(resolve => setTimeout(resolve, 100))
    return value
  })

  const safeAction = createSafeAction({ procedure })

  it('should work - on success', async () => {
    const { result } = renderHook(() => useSafeAction(safeAction))

    expect(result.current.status).toBe('idle')
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBe(undefined)
    expect(result.current.output).toBe(undefined)
    expect(result.current.input).toBe(undefined)

    result.current.execute({ value: 'hello' })

    await vi.waitFor(() => expect(result.current.status).toBe('pending'))
    expect(result.current.isPending).toBe(true)
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBe(undefined)
    expect(result.current.output).toBe(undefined)
    expect(result.current.input).toEqual({ value: 'hello' })

    await vi.waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBe(undefined)
    expect(result.current.output).toBe('hello')
    expect(result.current.input).toEqual({ value: 'hello' })

    result.current.reset()

    await vi.waitFor(() => expect(result.current.status).toBe('idle'))
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBe(undefined)
    expect(result.current.output).toBe(undefined)
    expect(result.current.input).toBe(undefined)
  })

  it('should work - on error', async () => {
    const { result } = renderHook(() => useSafeAction(safeAction))

    expect(result.current.status).toBe('idle')
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(result.current.error).toBe(undefined)
    expect(result.current.output).toBe(undefined)
    expect(result.current.input).toBe(undefined)

    // @ts-expect-error - invalid input
    result.current.execute({ value: 12334 })

    await vi.waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(true)
    expect(result.current.output).toBe(undefined)
    expect(result.current.error?.message).toEqual('Input validation failed')
    expect(result.current.input).toEqual({ value: 12334 })
  })

  it('hooks', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()

    const { result } = renderHook(() => useSafeAction(safeAction, { onSuccess, onError }))

    result.current.execute({ value: 'hello' }, { onSuccess, onError })

    await vi.waitFor(() => expect(result.current.status).toBe('success'))

    expect(onSuccess).toHaveBeenCalledTimes(2)
    expect(onSuccess).toHaveBeenNthCalledWith(1, { input: { value: 'hello' }, output: 'hello', status: 'success' }, undefined, undefined)
    expect(onSuccess).toHaveBeenNthCalledWith(2, { input: { value: 'hello' }, output: 'hello', status: 'success' }, undefined, undefined)

    expect(onError).not.toHaveBeenCalled()
  })
})
