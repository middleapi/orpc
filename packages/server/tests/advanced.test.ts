import z from 'zod'
import { os } from '../src'

it('support disable output validation by setting initialOutputValidationIndex to NaN', async () => {
  // docs: apps/content/docs/openapi/advanced/disabling-output-validation.md

  const procedure = os.$config({
    initialOutputValidationIndex: Number.NaN,
  })
    .use(({ next }) => next())
    .output(z.number())
    .use(({ next }) => next())
    // @ts-expect-error invalid output type
    .handler(() => {
      return 'invalid'
    })
    .callable()

  await expect(procedure()).resolves.toBe('invalid')
})
