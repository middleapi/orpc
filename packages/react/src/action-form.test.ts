import { ORPCError, os } from '@orpc/server'
import * as z from 'zod'
import { createFormAction } from './action-form'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createFormAction', () => {
  const handler = vi.fn(({ input }) => ({ output: input }))

  const client = os
    .input(z.object({ user: z.object({ age: z.coerce.number().max(100) }) }))
    .handler(handler)
    .callable()

  const action = createFormAction(client)

  it('on success', async () => {
    const form = new FormData()
    form.append('user[age]', '18')

    const result = await action(form)

    expect(result).toEqual(undefined)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ input: { user: { age: 18 } } }))
  })

  it('on error', async () => {
    const form = new FormData()
    form.append('user[age]', '1000')

    expect(action(form)).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(ORPCError)
      expect(error.status).toBe(400)
      expect(error.digest).toBeUndefined()

      return true
    })

    expect(handler).toHaveBeenCalledTimes(0)
  })

  it.each([
    [undefined],
    [null],
    ['user[age]=18'],
    [{ user: { age: '18' } }],
    [[['user[age]', '18']]],
    [new URLSearchParams('user[age]=18')],
  ])('on non-FormData input (%o)', async (input) => {
    await expect((action as any)(input)).rejects.toThrow(TypeError)

    expect(handler).toHaveBeenCalledTimes(0)
  })

  it('on fallback-able http next error', async () => {
    const form = new FormData()
    form.append('user[age]', '18')

    handler.mockRejectedValueOnce(new ORPCError('NOT_FOUND', { message: 'Not found' }))

    expect(action(form)).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(ORPCError)
      expect(error.status).toBe(404)
      expect(error.digest).toBe('NEXT_HTTP_ERROR_FALLBACK;404')
      expect(error.cause).toBeInstanceOf(ORPCError)

      return true
    })

    expect(handler).toHaveBeenCalledTimes(0)
  })

  it('interceptor', async () => {
    const interceptor = vi.fn(({ next }) => next())
    const action = createFormAction(client, {
      interceptors: [
        interceptor,
      ],
    })

    const form = new FormData()
    form.append('user[age]', '18')

    await action(form)

    expect(interceptor).toHaveBeenCalledTimes(1)
    expect(interceptor).toHaveBeenCalledWith(expect.objectContaining({
      input: { user: { age: '18' } },
      next: expect.any(Function),
    }))
    expect(await interceptor.mock.results[0]!.value).toEqual({ output: { user: { age: 18 } } })
  })
})
