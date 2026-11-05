import { os } from '../builder.ts'
import { Procedure } from '../procedure.ts'
import './callable.ts'

it('adds .callable into decorated procedure', async () => {
  const callable = os
    .$context<{ auth: boolean }>()
    .handler(({ context }) => ({ output: true, auth: context.auth }))
    .callable({ context: { auth: false } })

  expect(callable).toBeInstanceOf(Procedure)
  await expect(callable(undefined)).resolves.toEqual({ output: true, auth: false })
})
