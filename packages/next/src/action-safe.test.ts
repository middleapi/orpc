import { os } from '@orpc/server'
import { z } from 'zod'
import { createSafeAction } from './action-safe'

describe('createSafeAction', () => {
  const procedure = os.input(z.object({
    name: z.string(),
  })).handler(async ({ name }) => name)

  it('should work and catch error', () => {
    const safe = createSafeAction({ procedure, path: ['name'] })

    expect(safe({ name: 'hello' })).resolves.toEqual(['hello', undefined, 'success'])
    // @ts-expect-error - invalid input
    expect(safe({ name: 123 })).resolves.toEqual([undefined, {
      code: 'BAD_REQUEST',
      message: 'Input validation failed',
      issues: [
        {
          code: 'invalid_type',
          expected: 'string',
          message: 'Expected string, received number',
          path: [
            'name',
          ],
          received: 'number',
        },
      ],
      status: 400,
    }, 'error'])
  })

  it('hooks', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()

    const safe = createSafeAction({
      procedure,
      path: ['name'],
      onSuccess,
      onError,
      context: { val: 'context' },
    })

    await expect(safe({ name: 'hello' })).resolves.toEqual(['hello', undefined, 'success'])

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith(
      { output: 'hello', input: { name: 'hello' }, status: 'success' },
      { val: 'context' },
      {
        path: [
          'name',
        ],
        procedure,
      },
    )
    expect(onError).not.toHaveBeenCalled()
  })
})
