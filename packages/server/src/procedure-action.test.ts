import { ORPCError } from '@orpc/client'
import * as tanstackRouter from '@tanstack/router-core'
import * as next from 'next/navigation'
import { createActionableClient } from './procedure-action'

describe('createActionableClient', () => {
  const client = vi.fn()
  const action = createActionableClient(client)

  it('on success', async () => {
    client.mockResolvedValueOnce('__mocked__')
    const result = await action('input')
    expect(result).toEqual([null, '__mocked__'])
    expect(client).toHaveBeenCalledWith('input')
  })

  it('on throw ORPCError', async () => {
    client.mockRejectedValueOnce(new ORPCError('CODE', { message: 'message', data: { foo: 'bar' } }))
    const result = await action('input')
    expect(result).toEqual([{ code: 'CODE', message: 'message', data: { foo: 'bar' }, defined: false, status: 500 }, undefined])
    expect(client).toHaveBeenCalledWith('input')
  })

  it('on throw non-ORPCError', async () => {
    client.mockRejectedValueOnce(new Error('Some error'))
    const result = await action('input')
    expect(result).toEqual([{ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error', data: undefined, defined: false, status: 500 }, undefined])
    expect(client).toHaveBeenCalledWith('input')
  })

  it('ignore second argument', async () => {
    /** This important because second argument is not validate so we should prevent user from passing it */

    client.mockResolvedValueOnce('__mocked__')
    const result = await (action as any)('input', 'second')
    expect(result).toEqual([null, '__mocked__'])
    expect(client).toHaveBeenCalledWith('input')
  })

  it.each([
    [() => next.redirect('/foo')],
    [() => next.forbidden()],
    [() => next.unauthorized()],
    [() => next.notFound()],
    [() => tanstackRouter.redirect({ to: '.login' })],
    [() => tanstackRouter.notFound()],
  ])('should rethrow next.js or tanstack router error', async (createError) => {
    (process as any).env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = true

    let error

    client.mockImplementationOnce(() => {
      try {
        throw createError()
      }
      catch (e) {
        error = e
        throw e
      }
    })

    await expect(action('input')).rejects.toBe(error)
  })
})
