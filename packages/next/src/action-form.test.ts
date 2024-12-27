import { os } from '@orpc/server'
import { ZodCoercer } from '@orpc/zod'
import { z } from 'zod'
import { createFormAction } from './action-form'

describe('createFormAction', () => {
  const procedure = os.input(z.object({
    big: z.bigint(),
  })).handler(async ({ big }) => big)

  it('should accept form data and auto-convert types', async () => {
    const onSuccess = vi.fn()
    const formAction = createFormAction({
      procedure,
      path: ['name'],
      onSuccess,
      schemaCoercers: [
        new ZodCoercer(),
      ],
    })

    const form = new FormData()
    form.append('big', '19992')

    await expect(formAction(form)).resolves.toEqual(undefined)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith({
      input: { big: BigInt('19992') },
      output: BigInt('19992'),
      status: 'success',
    }, undefined, {
      path: [
        'name',
      ],
      procedure,
    })

    expect(formAction(new FormData())).rejects.toThrowError('Input validation failed')
  })

  it('hooks', async () => {
    const onSuccess = vi.fn()
    const onError = vi.fn()

    const formAction = createFormAction({
      procedure,
      path: ['name'],
      onSuccess,
      onError,
      schemaCoercers: [
        new ZodCoercer(),
      ],
    })

    const form = new FormData()
    form.append('big', '19992')

    await expect(formAction(form)).resolves.toEqual(undefined)

    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledWith({
      input: { big: BigInt('19992') },
      output: BigInt('19992'),
      status: 'success',
    }, undefined, {
      path: [
        'name',
      ],
      procedure,
    })
    expect(onError).not.toHaveBeenCalled()
  })
})
